from __future__ import annotations

import hashlib
import random
from datetime import datetime
import mimetypes
from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
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
    app = FastAPI(title="Video Gateway", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

    @app.on_event("startup")
    async def on_startup() -> None:
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
            worker_count=1,
        )
        await worker.start()

        app.state.config = app_config
        app.state.provider_configs = provider_configs
        app.state.pricing_catalog = pricing_catalog
        app.state.store = store
        app.state.http_client = http_client
        app.state.worker = worker

    @app.on_event("shutdown")
    async def on_shutdown() -> None:
        worker: TaskWorker = app.state.worker
        http_client: httpx.AsyncClient = app.state.http_client
        await worker.stop()
        await http_client.aclose()

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

    def _build_queue_position_map() -> dict[str, int]:
        active_tasks = app.state.store.list_active_tasks()
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

    async def _enqueue_video_task(payload: VideoGenerationRequest) -> VideoTaskResponse:
        _, operation = _validate_generation_payload(payload)
        _resolve_uploaded_files(
            request_payload=payload,
            operation=operation,
            store=app.state.store,
            app_config=app.state.config,
        )
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
            estimated_cost=estimated_cost,
            currency=currency,
            cost_source=cost_source,
        )
        await app.state.worker.submit(task_id)
        return _to_task_response(task, queue_map=_build_queue_position_map())

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

        source_request = VideoGenerationRequest.model_validate(task["request"])
        source_request.provider_options = _strip_internal_provider_options(
            source_request.provider_options
        )
        if retry_payload.prompt is not None:
            source_request.prompt = retry_payload.prompt
        if retry_payload.retry_mode == "new_seed":
            source_request.seed = random.SystemRandom().randint(1, 2_147_483_647)
        return await _enqueue_video_task(source_request)

    @app.get("/v1/video/tasks", response_model=list[VideoTaskDetail])
    async def list_video_tasks(
        limit: int = 20, _: None = Depends(require_auth)
    ) -> list[VideoTaskDetail]:
        max_limit = app.state.config.max_recent_tasks
        bounded_limit = min(max(limit, 1), max_limit)
        tasks = app.state.store.list_tasks(limit=bounded_limit)
        queue_map = _build_queue_position_map()
        return [_to_task_detail(task, queue_map=queue_map) for task in tasks]

    @app.get("/v1/video/tasks/{task_id}", response_model=VideoTaskDetail)
    async def get_video_task(
        task_id: str, _: None = Depends(require_auth)
    ) -> VideoTaskDetail:
        try:
            task = app.state.store.get_task(task_id)
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Task not found") from error
        return _to_task_detail(task, queue_map=_build_queue_position_map())

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
