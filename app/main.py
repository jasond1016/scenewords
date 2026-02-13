from __future__ import annotations

from contextlib import asynccontextmanager
import hashlib
import random
from datetime import datetime
import mimetypes
from pathlib import Path
import shutil
from typing import Any
from uuid import uuid4

import httpx
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from app.capabilities import (
    CapabilityValidationError,
    apply_operation_defaults_and_validate,
    build_model_operations,
)
from app.config import AppConfig, ProviderConfig, load_app_config, load_provider_configs
from app.db import TaskStore
from app.pricing import PricingCatalog
from app.providers import PROVIDER_TYPE_REGISTRY
from app.providers.base import Provider
from app.schemas import (
    PricingCatalogResponse,
    PricingEntryResponse,
    PricingEstimateRequest,
    PricingEstimateResponse,
    ProviderCatalogResponse,
    ProviderInfo,
    ProviderModelInfo,
    ProviderModelOperationInfo,
    RetryTaskRequest,
    UploadedFileResponse,
    VideoGenerationRequest,
    VideoTaskDetail,
    VideoTaskResponse,
)
from app.worker import TaskWorker, build_provider_clients

try:
    from PIL import Image
except Exception:  # pragma: no cover - optional dependency at import time
    Image = None  # type: ignore[assignment]

STATIC_DIR = Path(__file__).parent / "static"
FRONTEND_BUILD_HINT = "Frontend assets not found. Run: pnpm --dir frontend build"
ALLOWED_IMAGE_MIME_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
}
MIME_TO_EXTENSION = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


def create_app() -> FastAPI:
    # `StaticFiles` requires the directory to exist at app creation time.
    STATIC_DIR.mkdir(parents=True, exist_ok=True)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app_config = load_app_config()
        app_config.output_dir.mkdir(parents=True, exist_ok=True)
        app_config.upload_dir.mkdir(parents=True, exist_ok=True)
        app_config.db_path.parent.mkdir(parents=True, exist_ok=True)
        app_config.pricing_config_path.parent.mkdir(parents=True, exist_ok=True)

        provider_configs = load_provider_configs(app_config.provider_config_path)
        pricing_catalog = PricingCatalog.load(app_config.pricing_config_path)
        store = TaskStore(app_config.db_path)
        http_client = httpx.AsyncClient()
        providers_by_type: dict[str, Provider] = {
            provider_type: provider_class(app_config=app_config, http_client=http_client)
            for provider_type, provider_class in PROVIDER_TYPE_REGISTRY.items()
        }
        providers_by_id = build_provider_clients(provider_configs, providers_by_type)
        worker = TaskWorker(
            store=store,
            provider_configs=provider_configs,
            providers=providers_by_id,
            worker_count=20,
        )
        await worker.start()

        app.state.config = app_config
        app.state.provider_configs = provider_configs
        app.state.pricing_catalog = pricing_catalog
        app.state.store = store
        app.state.http_client = http_client
        app.state.worker = worker
        try:
            yield
        finally:
            await worker.stop()
            await http_client.aclose()

    app = FastAPI(title="Video Gateway", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/", response_class=FileResponse)
    async def index() -> FileResponse:
        index_path = STATIC_DIR / "index.html"
        if not index_path.exists():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=FRONTEND_BUILD_HINT,
            )
        return FileResponse(str(index_path))

    @app.get("/v1/models", response_model=ProviderCatalogResponse)
    async def list_models(_: None = Depends(require_auth)) -> ProviderCatalogResponse:
        provider_configs: dict[str, ProviderConfig] = app.state.provider_configs
        providers = []
        for provider in provider_configs.values():
            if not provider.enabled:
                continue
            providers.append(
                ProviderInfo(
                    id=provider.provider_id,
                    display_name=provider.display_name,
                    type=provider.provider_type,
                    supports_custom_endpoint=provider.supports_custom_endpoint,
                    models=[
                        ProviderModelInfo(
                            name=model.name,
                            display_name=model.display_name,
                            is_default=model.is_default,
                            operations=build_model_operations(
                                provider_config=provider, model_name=model.name
                            ),
                        )
                        for model in provider.models
                    ],
                )
            )
        return ProviderCatalogResponse(providers=providers)

    def _build_queue_position_map(asset_type: str | None = None) -> dict[str, int]:
        active_tasks = app.state.store.list_active_tasks(asset_type=asset_type)
        running_tasks = [task for task in active_tasks if task["status"] == "running"]
        queued_tasks = [task for task in active_tasks if task["status"] == "queued"]

        queue_map: dict[str, int] = {}
        for task in running_tasks:
            queue_map[task["task_id"]] = 0
        for index, task in enumerate(queued_tasks, start=1):
            queue_map[task["task_id"]] = index
        return queue_map

    def _validate_generation_payload(
        payload: VideoGenerationRequest,
        *,
        allowed_provider_types: set[str] | None = None,
    ) -> tuple[ProviderConfig, ProviderModelOperationInfo]:
        provider_configs: dict[str, ProviderConfig] = app.state.provider_configs
        if payload.provider not in provider_configs:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown provider: {payload.provider}",
            )
        if not provider_configs[payload.provider].enabled:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Provider disabled: {payload.provider}",
            )
        provider_config = provider_configs[payload.provider]
        if (
            allowed_provider_types
            and provider_config.provider_type not in allowed_provider_types
        ):
            accepted = ", ".join(sorted(allowed_provider_types))
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Provider type {provider_config.provider_type} is not allowed for this route. "
                    f"Allowed: {accepted}"
                ),
            )
        model_config = next(
            (model for model in provider_config.models if model.name == payload.model),
            None,
        )
        if not model_config:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown model for provider {payload.provider}: {payload.model}",
            )
        operations = build_model_operations(
            provider_config=provider_config, model_name=model_config.name
        )
        try:
            apply_operation_defaults_and_validate(request=payload, operations=operations)
        except CapabilityValidationError as error:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(error),
            ) from error
        operation = next(
            (item for item in operations if item.id == payload.operation),
            None,
        )
        if not operation:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported operation: {payload.operation}",
            )
        return provider_config, operation

    def _estimate_cost_for_request(
        payload: VideoGenerationRequest,
    ) -> tuple[float | None, str | None, str]:
        pricing_catalog: PricingCatalog = app.state.pricing_catalog
        quality = payload.provider_options.get("quality")
        quality_text = quality.strip() if isinstance(quality, str) and quality.strip() else None
        return pricing_catalog.estimate(
            provider=payload.provider,
            model=payload.model,
            duration_sec=payload.duration_sec,
            resolution=payload.resolution,
            quality=quality_text,
        )

    async def _enqueue_task(
        payload: VideoGenerationRequest,
        *,
        asset_type: str,
        allowed_provider_types: set[str] | None = None,
    ) -> VideoTaskResponse:
        _, operation = _validate_generation_payload(
            payload,
            allowed_provider_types=allowed_provider_types,
        )
        _resolve_uploaded_files(
            request_payload=payload,
            operation=operation,
            store=app.state.store,
            app_config=app.state.config,
        )
        _apply_orientation_mode_to_resolution(payload)
        estimated_cost, currency, cost_source = _estimate_cost_for_request(payload)
        task_id = str(uuid4())
        prompt_text = payload.prompt or ""
        task = app.state.store.create_task(
            task_id=task_id,
            provider=payload.provider,
            model=payload.model,
            operation=payload.operation,
            prompt=prompt_text,
            request_payload=payload.model_dump(mode="json"),
            asset_type=asset_type,
            estimated_cost=estimated_cost,
            currency=currency,
            cost_source=cost_source,
        )
        await app.state.worker.submit(task_id)
        return _to_task_response(
            task,
            queue_map=_build_queue_position_map(asset_type=asset_type),
        )

    async def _enqueue_video_task(payload: VideoGenerationRequest) -> VideoTaskResponse:
        return await _enqueue_task(payload, asset_type="video")

    async def _enqueue_image_task(payload: VideoGenerationRequest) -> VideoTaskResponse:
        return await _enqueue_task(
            payload,
            asset_type="image",
            allowed_provider_types={"tuzi_image"},
        )

    @app.post("/v1/video/generations", response_model=VideoTaskResponse)
    async def create_video_task(
        payload: VideoGenerationRequest, _: None = Depends(require_auth)
    ) -> VideoTaskResponse:
        return await _enqueue_video_task(payload)

    @app.post("/v1/video/tasks/{task_id}/retry", response_model=VideoTaskResponse)
    async def retry_video_task(
        task_id: str,
        retry_payload: RetryTaskRequest,
        _: None = Depends(require_auth),
    ) -> VideoTaskResponse:
        try:
            task = app.state.store.get_task(task_id)
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Task not found") from error
        if task.get("asset_type", "video") != "video":
            raise HTTPException(status_code=404, detail="Task not found")

        source_request = VideoGenerationRequest.model_validate(task["request"])
        source_request.provider_options = _strip_internal_provider_options(
            source_request.provider_options
        )
        if retry_payload.prompt is not None:
            source_request.prompt = retry_payload.prompt
        if retry_payload.retry_mode == "new_seed":
            source_request.seed = random.SystemRandom().randint(1, 2_147_483_647)
        return await _enqueue_video_task(source_request)

    @app.delete(
        "/v1/video/tasks/{task_id}",
        status_code=status.HTTP_204_NO_CONTENT,
        response_class=Response,
    )
    async def delete_video_task(task_id: str, _: None = Depends(require_auth)) -> Response:
        try:
            task = app.state.store.get_task(task_id)
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Task not found") from error
        if task.get("asset_type", "video") != "video":
            raise HTTPException(status_code=404, detail="Task not found")
        app.state.worker.cancel(task_id)
        _delete_archived_assets(app.state.config.output_dir, task_id)
        app.state.store.delete_task(task_id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.get("/v1/video/tasks", response_model=list[VideoTaskDetail])
    async def list_video_tasks(
        limit: int = 20, _: None = Depends(require_auth)
    ) -> list[VideoTaskDetail]:
        max_limit = app.state.config.max_recent_tasks
        bounded_limit = min(max(limit, 1), max_limit)
        tasks = app.state.store.list_tasks(limit=bounded_limit, asset_type="video")
        queue_map = _build_queue_position_map(asset_type="video")
        return [_to_task_detail(task, queue_map=queue_map) for task in tasks]

    @app.get("/v1/video/tasks/{task_id}", response_model=VideoTaskDetail)
    async def get_video_task(
        task_id: str, _: None = Depends(require_auth)
    ) -> VideoTaskDetail:
        try:
            task = app.state.store.get_task(task_id)
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Task not found") from error
        if task.get("asset_type", "video") != "video":
            raise HTTPException(status_code=404, detail="Task not found")
        return _to_task_detail(task, queue_map=_build_queue_position_map(asset_type="video"))

    @app.get("/v1/pricing", response_model=PricingCatalogResponse)
    async def get_pricing(_: None = Depends(require_auth)) -> PricingCatalogResponse:
        pricing_catalog: PricingCatalog = app.state.pricing_catalog
        entries = [
            PricingEntryResponse(
                provider=entry.provider,
                model=entry.model,
                quality=entry.quality,
                resolution=entry.resolution,
                duration_sec=entry.duration_sec,
                fixed_cost=entry.fixed_cost,
                cost_per_second=entry.cost_per_second,
                currency=entry.currency,
                effective_from=entry.effective_from,
            )
            for entry in pricing_catalog.entries
        ]
        return PricingCatalogResponse(
            mode="local_config",
            currency=pricing_catalog.currency,
            pricing_version=pricing_catalog.pricing_version,
            entries=entries,
        )

    @app.post("/v1/pricing/estimate", response_model=PricingEstimateResponse)
    async def estimate_pricing(
        payload: PricingEstimateRequest,
        _: None = Depends(require_auth),
    ) -> PricingEstimateResponse:
        pricing_catalog: PricingCatalog = app.state.pricing_catalog
        estimated_cost, currency, cost_source = pricing_catalog.estimate(
            provider=payload.provider,
            model=payload.model,
            duration_sec=payload.duration_sec,
            resolution=payload.resolution,
            quality=payload.quality,
        )
        return PricingEstimateResponse(
            provider=payload.provider,
            model=payload.model,
            estimated_cost=estimated_cost,
            currency=currency,
            cost_source=cost_source,  # type: ignore[arg-type]
            pricing_version=pricing_catalog.pricing_version,
        )

    @app.get("/v1/video/tasks/{task_id}/result")
    async def get_video_result(
        task_id: str, _: None = Depends(require_auth)
    ) -> dict[str, Any]:
        try:
            task = app.state.store.get_task(task_id)
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Task not found") from error
        if task.get("asset_type", "video") != "video":
            raise HTTPException(status_code=404, detail="Task not found")

        if task["status"] != "succeeded":
            raise HTTPException(
                status_code=409,
                detail={"status": task["status"], "error": task["error"]},
            )
        return {"task_id": task_id, "result": task["result"]}

    @app.post("/v1/image/generations", response_model=VideoTaskResponse)
    async def create_image_task(
        payload: VideoGenerationRequest, _: None = Depends(require_auth)
    ) -> VideoTaskResponse:
        return await _enqueue_image_task(payload)

    @app.post("/v1/image/tasks/{task_id}/retry", response_model=VideoTaskResponse)
    async def retry_image_task(
        task_id: str,
        retry_payload: RetryTaskRequest,
        _: None = Depends(require_auth),
    ) -> VideoTaskResponse:
        try:
            task = app.state.store.get_task(task_id)
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Task not found") from error
        if task.get("asset_type", "video") != "image":
            raise HTTPException(status_code=404, detail="Task not found")

        source_request = VideoGenerationRequest.model_validate(task["request"])
        source_request.provider_options = _strip_internal_provider_options(
            source_request.provider_options
        )
        if retry_payload.prompt is not None:
            source_request.prompt = retry_payload.prompt
        if retry_payload.retry_mode == "new_seed":
            source_request.seed = random.SystemRandom().randint(1, 2_147_483_647)
        return await _enqueue_image_task(source_request)

    @app.delete(
        "/v1/image/tasks/{task_id}",
        status_code=status.HTTP_204_NO_CONTENT,
        response_class=Response,
    )
    async def delete_image_task(task_id: str, _: None = Depends(require_auth)) -> Response:
        try:
            task = app.state.store.get_task(task_id)
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Task not found") from error
        if task.get("asset_type", "video") != "image":
            raise HTTPException(status_code=404, detail="Task not found")
        app.state.worker.cancel(task_id)
        _delete_archived_assets(app.state.config.output_dir, task_id)
        app.state.store.delete_task(task_id)
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.get("/v1/image/tasks", response_model=list[VideoTaskDetail])
    async def list_image_tasks(
        limit: int = 20, _: None = Depends(require_auth)
    ) -> list[VideoTaskDetail]:
        max_limit = app.state.config.max_recent_tasks
        bounded_limit = min(max(limit, 1), max_limit)
        tasks = app.state.store.list_tasks(limit=bounded_limit, asset_type="image")
        queue_map = _build_queue_position_map(asset_type="image")
        return [_to_task_detail(task, queue_map=queue_map) for task in tasks]

    @app.get("/v1/image/tasks/{task_id}", response_model=VideoTaskDetail)
    async def get_image_task(
        task_id: str, _: None = Depends(require_auth)
    ) -> VideoTaskDetail:
        try:
            task = app.state.store.get_task(task_id)
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Task not found") from error
        if task.get("asset_type", "video") != "image":
            raise HTTPException(status_code=404, detail="Task not found")
        return _to_task_detail(task, queue_map=_build_queue_position_map(asset_type="image"))

    @app.get("/v1/image/tasks/{task_id}/result")
    async def get_image_result(
        task_id: str, _: None = Depends(require_auth)
    ) -> dict[str, Any]:
        try:
            task = app.state.store.get_task(task_id)
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Task not found") from error
        if task.get("asset_type", "video") != "image":
            raise HTTPException(status_code=404, detail="Task not found")

        if task["status"] != "succeeded":
            raise HTTPException(
                status_code=409,
                detail={"status": task["status"], "error": task["error"]},
            )
        return {"task_id": task_id, "result": task["result"]}

    @app.post("/v1/files", response_model=UploadedFileResponse)
    async def upload_file(
        file: UploadFile = File(...), _: None = Depends(require_auth)
    ) -> UploadedFileResponse:
        app_config: AppConfig = app.state.config
        max_size_bytes = max(1, app_config.max_upload_mb) * 1024 * 1024
        file_bytes = await file.read(max_size_bytes + 1)
        if not file_bytes:
            raise HTTPException(status_code=400, detail="Uploaded file is empty")
        if len(file_bytes) > max_size_bytes:
            raise HTTPException(
                status_code=413,
                detail=f"File exceeds max size: {app_config.max_upload_mb}MB",
            )

        original_name = (file.filename or "").strip() or "upload"
        mime_type = _resolve_upload_mime_type(
            content_type=file.content_type,
            filename=original_name,
        )
        extension = MIME_TO_EXTENSION[mime_type]
        file_id = str(uuid4())
        stored_name = f"{file_id}{extension}"
        target_path = app_config.upload_dir / stored_name

        try:
            with target_path.open("wb") as target:
                target.write(file_bytes)
        except OSError as error:
            raise HTTPException(status_code=500, detail="Failed to persist uploaded file") from error

        sha256 = hashlib.sha256(file_bytes).hexdigest()
        file_record = app.state.store.create_file(
            file_id=file_id,
            original_name=original_name,
            stored_name=stored_name,
            mime_type=mime_type,
            size_bytes=len(file_bytes),
            sha256=sha256,
        )
        return UploadedFileResponse(
            file_id=file_record["file_id"],
            original_name=file_record["original_name"],
            mime_type=file_record["mime_type"],
            size_bytes=file_record["size_bytes"],
            sha256=file_record["sha256"],
            created_at=_as_datetime(file_record["created_at"]),
            url=f"/v1/files/{file_record['file_id']}",
        )

    @app.get("/v1/files/{file_id}")
    async def get_uploaded_file(
        file_id: str, _: None = Depends(require_auth)
    ) -> FileResponse:
        try:
            file_record = app.state.store.get_file(file_id)
        except KeyError as error:
            raise HTTPException(status_code=404, detail="File not found") from error

        app.state.store.touch_file(file_id)
        file_path = app.state.config.upload_dir / file_record["stored_name"]
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="File content not found on disk")

        return FileResponse(
            str(file_path),
            media_type=file_record["mime_type"],
            filename=file_record["original_name"],
        )

    @app.get("/v1/assets/{task_id}/{filename}")
    async def get_archived_asset(
        task_id: str,
        filename: str,
        _: None = Depends(require_auth),
    ) -> FileResponse:
        if Path(filename).name != filename:
            raise HTTPException(status_code=400, detail="Invalid filename")

        archive_root = app.state.config.output_dir / "assets"
        file_path = (archive_root / task_id / filename).resolve()
        try:
            file_path.relative_to(archive_root.resolve())
        except ValueError as error:
            raise HTTPException(status_code=400, detail="Invalid asset path") from error

        if not file_path.exists() or not file_path.is_file():
            raise HTTPException(status_code=404, detail="Archived asset not found")

        media_type, _ = mimetypes.guess_type(str(file_path))
        return FileResponse(
            str(file_path),
            media_type=media_type or "application/octet-stream",
            filename=filename,
        )

    return app


def require_auth(request: Request) -> None:
    app_config: AppConfig = request.app.state.config
    if not app_config.bearer_token:
        return
    authorization = request.headers.get("Authorization")
    expected = f"Bearer {app_config.bearer_token}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")


def _resolve_uploaded_files(
    request_payload: VideoGenerationRequest,
    operation: ProviderModelOperationInfo,
    store: TaskStore,
    app_config: AppConfig,
) -> None:
    for field in operation.fields:
        if field.input_type not in {"file", "file_list"}:
            continue

        if field.target != "provider_options":
            continue
        raw_value = request_payload.provider_options.get(field.key)
        if raw_value is None:
            continue

        file_ids = _normalize_file_ids(
            raw_value=raw_value,
            expect_list=field.input_type == "file_list",
            field_key=field.key,
        )
        if not file_ids:
            continue

        resolved_entries: list[dict[str, Any]] = []
        for file_id in file_ids:
            try:
                file_record = store.get_file(file_id)
            except KeyError as error:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unknown uploaded file: {file_id}",
                ) from error

            file_path = app_config.upload_dir / file_record["stored_name"]
            if not file_path.exists():
                raise HTTPException(
                    status_code=400,
                    detail=f"Uploaded file content missing: {file_id}",
                )
            store.touch_file(file_id)
            resolved_entries.append(
                {
                    "file_id": file_record["file_id"],
                    "path": str(file_path),
                    "original_name": file_record["original_name"],
                    "mime_type": file_record["mime_type"],
                    "size_bytes": file_record["size_bytes"],
                }
            )

        request_payload.provider_options[f"__resolved_{field.key}"] = resolved_entries

    _validate_file_dependencies(request_payload.provider_options)


def _apply_orientation_mode_to_resolution(request_payload: VideoGenerationRequest) -> None:
    provider_options = request_payload.provider_options
    if not isinstance(provider_options, dict):
        return
    orientation_mode = _normalize_orientation_mode(provider_options.get("orientation_mode"))
    if orientation_mode is None:
        return
    resolution = _parse_resolution_value(request_payload.resolution)
    if resolution is None:
        return
    width, height = resolution
    desired_orientation = orientation_mode
    if orientation_mode == "auto":
        desired_orientation = _infer_orientation_from_resolved_references(provider_options)
    if desired_orientation is None:
        return
    if desired_orientation == "landscape" and width < height:
        width, height = height, width
    elif desired_orientation == "portrait" and width > height:
        width, height = height, width
    request_payload.resolution = f"{width}x{height}"


def _normalize_orientation_mode(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower()
    if normalized in {"auto", "landscape", "portrait"}:
        return normalized
    return None


def _parse_resolution_value(raw_resolution: str | None) -> tuple[int, int] | None:
    if not isinstance(raw_resolution, str):
        return None
    normalized = raw_resolution.strip().lower()
    if "x" not in normalized:
        return None
    width_part, _, height_part = normalized.partition("x")
    try:
        width = int(width_part.strip())
        height = int(height_part.strip())
    except (TypeError, ValueError):
        return None
    if width <= 0 or height <= 0:
        return None
    return width, height


def _infer_orientation_from_resolved_references(
    provider_options: dict[str, Any],
) -> str | None:
    for key in (
        "__resolved_start_frame_file_id",
        "__resolved_input_reference_file_ids",
        "__resolved_end_frame_file_id",
    ):
        dimensions = _read_first_resolved_image_size(provider_options.get(key))
        if dimensions is None:
            continue
        width, height = dimensions
        if width > height:
            return "landscape"
        if height > width:
            return "portrait"
    return None


def _read_first_resolved_image_size(raw_entries: Any) -> tuple[int, int] | None:
    if Image is None or not isinstance(raw_entries, list):
        return None
    for entry in raw_entries:
        if not isinstance(entry, dict):
            continue
        path_text = entry.get("path")
        if not isinstance(path_text, str) or not path_text.strip():
            continue
        file_path = Path(path_text)
        if not file_path.exists():
            continue
        try:
            with Image.open(file_path) as image:
                width, height = image.size
        except Exception:
            continue
        if width > 0 and height > 0:
            return width, height
    return None


def _normalize_file_ids(raw_value: Any, expect_list: bool, field_key: str) -> list[str]:
    if expect_list:
        if isinstance(raw_value, str) and raw_value.strip():
            return [raw_value.strip()]
        if isinstance(raw_value, list):
            normalized = []
            for item in raw_value:
                if isinstance(item, str) and item.strip():
                    normalized.append(item.strip())
            return normalized
        raise HTTPException(
            status_code=400,
            detail=f"{field_key} must be a list of file ids",
        )

    if isinstance(raw_value, str) and raw_value.strip():
        return [raw_value.strip()]
    raise HTTPException(
        status_code=400,
        detail=f"{field_key} must be a file id",
    )


def _validate_file_dependencies(provider_options: dict[str, Any]) -> None:
    has_start = isinstance(provider_options.get("start_frame_file_id"), str) and bool(
        provider_options.get("start_frame_file_id", "").strip()
    )
    has_end = isinstance(provider_options.get("end_frame_file_id"), str) and bool(
        provider_options.get("end_frame_file_id", "").strip()
    )
    if has_end and not has_start:
        raise HTTPException(
            status_code=400,
            detail="end_frame_file_id requires start_frame_file_id",
        )


def _resolve_upload_mime_type(content_type: str | None, filename: str) -> str:
    normalized = ""
    if isinstance(content_type, str) and content_type.strip():
        normalized = content_type.split(";")[0].strip().lower()
    if normalized in ALLOWED_IMAGE_MIME_TYPES:
        return normalized

    guessed_type, _ = mimetypes.guess_type(filename)
    if isinstance(guessed_type, str):
        guessed_type = guessed_type.lower()
        if guessed_type in ALLOWED_IMAGE_MIME_TYPES:
            return guessed_type

    raise HTTPException(
        status_code=400,
        detail="Unsupported file type; only jpg/png/webp are allowed",
    )


def _delete_archived_assets(output_dir: Path, task_id: str) -> None:
    target = output_dir / "assets" / task_id
    try:
        shutil.rmtree(target)
    except FileNotFoundError:
        return
    except OSError:
        # Best-effort cleanup; task deletion should still succeed.
        return


def _to_task_response(
    task: dict[str, Any],
    *,
    queue_map: dict[str, int] | None = None,
) -> VideoTaskResponse:
    queue_position = None
    if queue_map is not None:
        queue_position = queue_map.get(task["task_id"])
    return VideoTaskResponse(
        task_id=task["task_id"],
        status=task["status"],
        asset_type=task.get("asset_type", "video"),
        provider=task["provider"],
        model=task["model"],
        queue_position=queue_position,
        created_at=_as_datetime(task["created_at"]),
        updated_at=_as_datetime(task["updated_at"]),
    )


def _to_task_detail(
    task: dict[str, Any],
    *,
    queue_map: dict[str, int] | None = None,
) -> VideoTaskDetail:
    request_payload = task.get("request") or {}
    provider_options = request_payload.get("provider_options")
    safe_provider_options = (
        _strip_internal_provider_options(provider_options)
        if isinstance(provider_options, dict)
        else {}
    )
    cost_source = task.get("cost_source") or "unknown"
    if cost_source not in {"provider_api", "local_config", "unknown"}:
        cost_source = "unknown"
    queue_position = None
    if queue_map is not None:
        queue_position = queue_map.get(task["task_id"])

    return VideoTaskDetail(
        task_id=task["task_id"],
        status=task["status"],
        asset_type=task.get("asset_type", "video"),
        provider=task["provider"],
        model=task["model"],
        operation=task.get("operation") or request_payload.get("operation"),
        prompt=task["prompt"],
        negative_prompt=request_payload.get("negative_prompt"),
        duration_sec=request_payload.get("duration_sec"),
        resolution=request_payload.get("resolution"),
        fps=request_payload.get("fps"),
        seed=request_payload.get("seed"),
        provider_options=safe_provider_options,
        queue_position=queue_position,
        estimated_cost=task.get("estimated_cost"),
        actual_cost=task.get("actual_cost"),
        currency=task.get("currency"),
        cost_source=cost_source,  # type: ignore[arg-type]
        result=task["result"],
        error=task["error"],
        created_at=_as_datetime(task["created_at"]),
        updated_at=_as_datetime(task["updated_at"]),
    )


def _strip_internal_provider_options(options: dict[str, Any]) -> dict[str, Any]:
    safe_options: dict[str, Any] = {}
    for key, value in options.items():
        normalized = key.strip().lower()
        if key.startswith("__resolved_"):
            continue
        if "api_key" in normalized or "token" in normalized or "secret" in normalized:
            continue
        safe_options[key] = value
    return safe_options


def _as_datetime(value: datetime | str) -> datetime:
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(value)


app = create_app()
