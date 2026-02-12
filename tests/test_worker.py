from __future__ import annotations

import asyncio
from pathlib import Path
from uuid import uuid4

import httpx

from app.config import AppConfig, ProviderConfig, ProviderModelConfig
from app.db import TaskStore
from app.providers.base import Provider
from app.schemas import VideoGenerationRequest
from app.worker import TaskWorker


class _BlockingProvider(Provider):
    def __init__(
        self,
        *,
        app_config: AppConfig,
        http_client: httpx.AsyncClient,
        started: asyncio.Event,
        release: asyncio.Event,
    ) -> None:
        super().__init__(app_config=app_config, http_client=http_client)
        self._started = started
        self._release = release

    async def generate(
        self, provider_config: ProviderConfig, request: VideoGenerationRequest
    ) -> dict[str, object]:
        self._started.set()
        await self._release.wait()
        return {"video_url": "https://example.com/done.mp4"}


async def _wait_for_status(
    store: TaskStore,
    *,
    task_id: str,
    expected: str,
    timeout_sec: float = 3.0,
) -> None:
    deadline = asyncio.get_running_loop().time() + timeout_sec
    while asyncio.get_running_loop().time() < deadline:
        try:
            task = store.get_task(task_id)
        except KeyError:
            await asyncio.sleep(0.01)
            continue
        if task["status"] == expected:
            return
        await asyncio.sleep(0.01)
    raise AssertionError(f"Task {task_id} did not reach status={expected!r} within timeout")


def _build_app_config(tmp_path: Path) -> AppConfig:
    return AppConfig(
        provider_config_path=tmp_path / "providers.json",
        pricing_config_path=tmp_path / "pricing.json",
        db_path=tmp_path / "tasks.db",
        output_dir=tmp_path / "outputs",
        upload_dir=tmp_path / "uploads",
        bearer_token=None,
        allow_endpoint_override=True,
        max_recent_tasks=50,
        max_upload_mb=10,
    )


def _build_provider_config() -> ProviderConfig:
    return ProviderConfig(
        provider_id="demo_provider",
        display_name="Demo Provider",
        provider_type="openai_compatible",
        enabled=True,
        base_url="https://example.com",
        api_path="/v1/videos",
        auth_env=None,
        models=[
            ProviderModelConfig(
                name="demo-model",
                display_name="Demo Model",
                is_default=True,
            )
        ],
        supports_custom_endpoint=True,
        extra={},
    )


def _seed_task(store: TaskStore) -> str:
    task_id = str(uuid4())
    store.create_task(
        task_id=task_id,
        provider="demo_provider",
        model="demo-model",
        operation="generate",
        prompt="test prompt",
        request_payload={
            "provider": "demo_provider",
            "model": "demo-model",
            "operation": "generate",
            "prompt": "test prompt",
            "provider_options": {},
        },
        asset_type="video",
    )
    return task_id


def test_cancel_running_task_unblocks_next_queued_task(tmp_path: Path) -> None:
    async def _run() -> None:
        store = TaskStore(tmp_path / "tasks.db")
        app_config = _build_app_config(tmp_path)
        provider_config = _build_provider_config()
        started = asyncio.Event()
        release = asyncio.Event()
        http_client = httpx.AsyncClient()
        provider = _BlockingProvider(
            app_config=app_config,
            http_client=http_client,
            started=started,
            release=release,
        )
        worker = TaskWorker(
            store=store,
            provider_configs={"demo_provider": provider_config},
            providers={"demo_provider": provider},
            worker_count=1,
        )

        task_1 = _seed_task(store)
        task_2 = _seed_task(store)

        await worker.start()
        try:
            await worker.submit(task_1)
            await worker.submit(task_2)

            await asyncio.wait_for(started.wait(), timeout=1.0)
            await _wait_for_status(store, task_id=task_1, expected="running")

            worker.cancel(task_1)
            store.delete_task(task_1)

            await _wait_for_status(store, task_id=task_2, expected="running")
            release.set()
            await _wait_for_status(store, task_id=task_2, expected="succeeded")
        finally:
            await worker.stop()
            await http_client.aclose()

    asyncio.run(_run())
