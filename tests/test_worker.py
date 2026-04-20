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


class _StaticResultProvider(Provider):
    def __init__(
        self,
        *,
        app_config: AppConfig,
        http_client: httpx.AsyncClient,
        result_payload: dict[str, object],
    ) -> None:
        super().__init__(app_config=app_config, http_client=http_client)
        self._result_payload = result_payload

    async def generate(
        self, provider_config: ProviderConfig, request: VideoGenerationRequest
    ) -> dict[str, object]:
        del provider_config
        del request
        return dict(self._result_payload)


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


def _seed_task(
    store: TaskStore,
    *,
    asset_type: str = "video",
    estimated_cost: float | None = None,
    currency: str | None = None,
    cost_source: str | None = None,
) -> str:
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
        asset_type=asset_type,
        estimated_cost=estimated_cost,
        currency=currency,
        cost_source=cost_source,
    )
    return task_id


def test_cancel_running_task_unblocks_next_queued_task(tmp_path: Path) -> None:
    async def _run() -> None:
        store = TaskStore(tmp_path / "tasks.db")
        app_config = _build_app_config(tmp_path)
        provider_config = _build_provider_config()
        started = asyncio.Event()
        release = asyncio.Event()
        http_client = httpx.AsyncClient(
            transport=httpx.MockTransport(lambda request: httpx.Response(404, request=request))
        )
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


def test_archives_image_results_with_stable_local_urls(tmp_path: Path) -> None:
    async def _run() -> None:
        store = TaskStore(tmp_path / "tasks.db")
        app_config = _build_app_config(tmp_path)
        provider_config = _build_provider_config()

        image_1 = b"\xff\xd8\xff\xe0jpg"
        image_2 = b"\x89PNG\r\n\x1a\npng"

        def _handler(request: httpx.Request) -> httpx.Response:
            if str(request.url) == "https://archive.test/img-1.jpg":
                return httpx.Response(
                    200,
                    content=image_1,
                    headers={"content-type": "image/jpeg"},
                )
            if str(request.url) == "https://archive.test/img-2.png":
                return httpx.Response(
                    200,
                    content=image_2,
                    headers={"content-type": "image/png"},
                )
            return httpx.Response(404, json={"detail": "not found"})

        http_client = httpx.AsyncClient(transport=httpx.MockTransport(_handler))
        provider = _StaticResultProvider(
            app_config=app_config,
            http_client=http_client,
            result_payload={
                "image_urls": [
                    "https://archive.test/img-1.jpg",
                    "https://archive.test/img-2.png",
                ]
            },
        )
        worker = TaskWorker(
            store=store,
            provider_configs={"demo_provider": provider_config},
            providers={"demo_provider": provider},
            worker_count=1,
        )

        task_id = _seed_task(store, asset_type="image")
        await worker.start()
        try:
            await worker.submit(task_id)
            await _wait_for_status(store, task_id=task_id, expected="succeeded")
            task = store.get_task(task_id)
            result = task["result"]
            assert isinstance(result, dict)
            local_urls = result.get("local_image_urls")
            assert isinstance(local_urls, list)
            assert len(local_urls) == 2
            for local_url in local_urls:
                assert isinstance(local_url, str)
                assert local_url.startswith(f"/v1/assets/{task_id}/")
                filename = local_url.rsplit("/", 1)[-1]
                archived_path = app_config.output_dir / "assets" / task_id / filename
                assert archived_path.exists()
        finally:
            await worker.stop()
            await http_client.aclose()

    asyncio.run(_run())


def test_success_without_provider_cost_uses_estimated_cost_as_actual(tmp_path: Path) -> None:
    async def _run() -> None:
        store = TaskStore(tmp_path / "tasks.db")
        app_config = _build_app_config(tmp_path)
        provider_config = _build_provider_config()
        http_client = httpx.AsyncClient(
            transport=httpx.MockTransport(lambda request: httpx.Response(404, request=request))
        )
        provider = _StaticResultProvider(
            app_config=app_config,
            http_client=http_client,
            result_payload={"video_url": "https://example.com/video.mp4"},
        )
        worker = TaskWorker(
            store=store,
            provider_configs={"demo_provider": provider_config},
            providers={"demo_provider": provider},
            worker_count=1,
        )

        task_id = _seed_task(
            store,
            estimated_cost=1.25,
            currency="USD",
            cost_source="local_config",
        )
        await worker.start()
        try:
            await worker.submit(task_id)
            await _wait_for_status(store, task_id=task_id, expected="succeeded")
            task = store.get_task(task_id)
            assert task["actual_cost"] == 1.25
            assert task["cost_source"] == "local_config"
        finally:
            await worker.stop()
            await http_client.aclose()

    asyncio.run(_run())


def test_provider_reported_cost_overrides_estimated_cost(tmp_path: Path) -> None:
    async def _run() -> None:
        store = TaskStore(tmp_path / "tasks.db")
        app_config = _build_app_config(tmp_path)
        provider_config = _build_provider_config()
        http_client = httpx.AsyncClient(
            transport=httpx.MockTransport(lambda request: httpx.Response(404, request=request))
        )
        provider = _StaticResultProvider(
            app_config=app_config,
            http_client=http_client,
            result_payload={
                "video_url": "https://example.com/video.mp4",
                "billing": {"amount": 2.5},
            },
        )
        worker = TaskWorker(
            store=store,
            provider_configs={"demo_provider": provider_config},
            providers={"demo_provider": provider},
            worker_count=1,
        )

        task_id = _seed_task(
            store,
            estimated_cost=1.25,
            currency="USD",
            cost_source="local_config",
        )
        await worker.start()
        try:
            await worker.submit(task_id)
            await _wait_for_status(store, task_id=task_id, expected="succeeded")
            task = store.get_task(task_id)
            assert task["actual_cost"] == 2.5
            assert task["cost_source"] == "provider_api"
        finally:
            await worker.stop()
            await http_client.aclose()

    asyncio.run(_run())
