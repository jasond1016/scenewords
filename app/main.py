from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import AppConfig, ProviderConfig, load_app_config, load_provider_configs
from app.db import TaskStore
from app.providers import PROVIDER_TYPE_REGISTRY
from app.providers.base import Provider
from app.schemas import (
    ProviderCatalogResponse,
    ProviderInfo,
    ProviderModelInfo,
    VideoGenerationRequest,
    VideoTaskDetail,
    VideoTaskResponse,
)
from app.worker import TaskWorker, build_provider_clients

STATIC_DIR = Path(__file__).parent / "static"


def create_app() -> FastAPI:
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
        app_config.db_path.parent.mkdir(parents=True, exist_ok=True)

        provider_configs = load_provider_configs(app_config.provider_config_path)
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
        return FileResponse(str(STATIC_DIR / "index.html"))

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
                        )
                        for model in provider.models
                    ],
                )
            )
        return ProviderCatalogResponse(providers=providers)

    @app.post("/v1/video/generations", response_model=VideoTaskResponse)
    async def create_video_task(
        payload: VideoGenerationRequest, _: None = Depends(require_auth)
    ) -> VideoTaskResponse:
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

        task_id = str(uuid4())
        task = app.state.store.create_task(
            task_id=task_id,
            provider=payload.provider,
            model=payload.model,
            prompt=payload.prompt,
            request_payload=payload.model_dump(mode="json"),
        )
        await app.state.worker.submit(task_id)
        return _to_task_response(task)

    @app.get("/v1/video/tasks", response_model=list[VideoTaskDetail])
    async def list_video_tasks(
        limit: int = 20, _: None = Depends(require_auth)
    ) -> list[VideoTaskDetail]:
        max_limit = app.state.config.max_recent_tasks
        bounded_limit = min(max(limit, 1), max_limit)
        tasks = app.state.store.list_tasks(limit=bounded_limit)
        return [_to_task_detail(task) for task in tasks]

    @app.get("/v1/video/tasks/{task_id}", response_model=VideoTaskDetail)
    async def get_video_task(
        task_id: str, _: None = Depends(require_auth)
    ) -> VideoTaskDetail:
        try:
            task = app.state.store.get_task(task_id)
        except KeyError as error:
            raise HTTPException(status_code=404, detail="Task not found") from error
        return _to_task_detail(task)

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

    return app


def require_auth(request: Request) -> None:
    app_config: AppConfig = request.app.state.config
    if not app_config.bearer_token:
        return
    authorization = request.headers.get("Authorization")
    expected = f"Bearer {app_config.bearer_token}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")


def _to_task_response(task: dict[str, Any]) -> VideoTaskResponse:
    return VideoTaskResponse(
        task_id=task["task_id"],
        status=task["status"],
        provider=task["provider"],
        model=task["model"],
        created_at=_as_datetime(task["created_at"]),
        updated_at=_as_datetime(task["updated_at"]),
    )


def _to_task_detail(task: dict[str, Any]) -> VideoTaskDetail:
    return VideoTaskDetail(
        task_id=task["task_id"],
        status=task["status"],
        provider=task["provider"],
        model=task["model"],
        prompt=task["prompt"],
        result=task["result"],
        error=task["error"],
        created_at=_as_datetime(task["created_at"]),
        updated_at=_as_datetime(task["updated_at"]),
    )


def _as_datetime(value: datetime | str) -> datetime:
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(value)


app = create_app()
