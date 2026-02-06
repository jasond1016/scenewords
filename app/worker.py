from __future__ import annotations

import asyncio
from collections.abc import Mapping

from app.config import ProviderConfig
from app.db import TaskStore
from app.providers import PROVIDER_TYPE_REGISTRY
from app.providers.base import Provider, ProviderError
from app.schemas import VideoGenerationRequest


class TaskWorker:
    def __init__(
        self,
        store: TaskStore,
        provider_configs: dict[str, ProviderConfig],
        providers: Mapping[str, Provider],
        worker_count: int = 1,
    ) -> None:
        self.store = store
        self.provider_configs = provider_configs
        self.providers = providers
        self.queue: asyncio.Queue[str] = asyncio.Queue()
        self.worker_count = worker_count
        self._tasks: list[asyncio.Task[None]] = []
        self._stopping = False

    async def start(self) -> None:
        self._stopping = False
        self._tasks = [
            asyncio.create_task(self._run_loop(worker_id=index))
            for index in range(self.worker_count)
        ]

    async def stop(self) -> None:
        self._stopping = True
        for _ in self._tasks:
            await self.queue.put("")
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()

    async def submit(self, task_id: str) -> None:
        await self.queue.put(task_id)

    async def _run_loop(self, worker_id: int) -> None:
        while not self._stopping:
            task_id = await self.queue.get()
            if not task_id:
                self.queue.task_done()
                continue

            try:
                await self._process_task(task_id)
            finally:
                self.queue.task_done()

    async def _process_task(self, task_id: str) -> None:
        try:
            task = self.store.get_task(task_id)
        except KeyError:
            return

        provider_id = task["provider"]
        provider_config = self.provider_configs.get(provider_id)
        if not provider_config or not provider_config.enabled:
            self.store.set_error(
                task_id=task_id,
                code="unknown_provider",
                message=f"Provider {provider_id} not found or disabled",
                raw_error={"provider": provider_id},
            )
            return

        provider = self.providers.get(provider_id)
        if not provider:
            self.store.set_error(
                task_id=task_id,
                code="provider_not_initialized",
                message=f"Provider {provider_id} not initialized",
                raw_error={"provider_type": provider_config.provider_type},
            )
            return

        self.store.set_status(task_id=task_id, status="running")
        request = VideoGenerationRequest.model_validate(task["request"])
        try:
            result = await provider.generate(provider_config=provider_config, request=request)
            self.store.set_result(task_id=task_id, result=result)
        except ProviderError as error:
            self.store.set_error(
                task_id=task_id,
                code=error.code,
                message=error.message,
                raw_error=error.raw_error,
            )
        except Exception as error:
            self.store.set_error(
                task_id=task_id,
                code="internal_error",
                message="Unexpected worker error",
                raw_error=str(error),
            )


def build_provider_clients(
    provider_configs: dict[str, ProviderConfig], providers_by_type: dict[str, Provider]
) -> dict[str, Provider]:
    clients: dict[str, Provider] = {}
    for provider_id, provider_config in provider_configs.items():
        provider_client = providers_by_type.get(provider_config.provider_type)
        if provider_client:
            clients[provider_id] = provider_client
    return clients


def supported_provider_types() -> set[str]:
    return set(PROVIDER_TYPE_REGISTRY.keys())
