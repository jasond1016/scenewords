from __future__ import annotations

import asyncio
from collections.abc import Mapping
import mimetypes
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

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
        self._running_jobs: dict[str, asyncio.Task[None]] = {}
        self._canceled_task_ids: set[str] = set()
        self._stopping = False

    async def start(self) -> None:
        self._stopping = False
        self._tasks = [
            asyncio.create_task(self._run_loop(worker_id=index))
            for index in range(self.worker_count)
        ]

    async def stop(self) -> None:
        self._stopping = True
        for job in list(self._running_jobs.values()):
            if not job.done():
                job.cancel()
        for _ in self._tasks:
            await self.queue.put("")
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()

    async def submit(self, task_id: str) -> None:
        await self.queue.put(task_id)

    def cancel(self, task_id: str) -> None:
        self._canceled_task_ids.add(task_id)
        running = self._running_jobs.get(task_id)
        if running and not running.done():
            running.cancel()

    async def _run_loop(self, worker_id: int) -> None:
        while not self._stopping:
            task_id = await self.queue.get()
            if not task_id:
                self.queue.task_done()
                continue
            if task_id in self._canceled_task_ids:
                self._canceled_task_ids.discard(task_id)
                self.queue.task_done()
                continue

            try:
                job = asyncio.create_task(self._process_task(task_id))
                self._running_jobs[task_id] = job
                try:
                    await job
                except asyncio.CancelledError:
                    # Task cancellation is intentional (user-triggered delete/cancel).
                    pass
            finally:
                self._running_jobs.pop(task_id, None)
                self._canceled_task_ids.discard(task_id)
                self.queue.task_done()

    async def _process_task(self, task_id: str) -> None:
        if task_id in self._canceled_task_ids:
            return
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

        if task_id in self._canceled_task_ids:
            return
        self.store.set_status(task_id=task_id, status="running")
        request = VideoGenerationRequest.model_validate(task["request"])
        resume_provider_job_id = task.get("provider_job_id")
        resume_provider_query_endpoint = task.get("provider_query_endpoint")

        def _report_provider_progress(payload: dict[str, Any]) -> None:
            if not isinstance(payload, dict):
                return
            self.store.set_provider_progress(
                task_id=task_id,
                provider_job_id=_as_optional_text(payload.get("provider_job_id")),
                provider_status=_as_optional_text(payload.get("provider_status")),
                provider_query_endpoint=_as_optional_text(payload.get("provider_query_endpoint")),
            )

        request.provider_options["__provider_progress_reporter"] = _report_provider_progress
        if isinstance(resume_provider_job_id, str) and resume_provider_job_id.strip():
            request.provider_options["__resume_provider_job_id"] = resume_provider_job_id.strip()
        if (
            isinstance(resume_provider_query_endpoint, str)
            and resume_provider_query_endpoint.strip()
        ):
            request.provider_options["__resume_provider_query_endpoint"] = (
                resume_provider_query_endpoint.strip()
            )
        try:
            result = await provider.generate(provider_config=provider_config, request=request)
            result = await _archive_result_assets(
                task_id=task_id,
                asset_type=task.get("asset_type", "video"),
                result=result,
                provider=provider,
            )
            actual_cost, cost_source = _extract_settled_cost(task, result)
            self.store.set_result(
                task_id=task_id,
                result=result,
                actual_cost=actual_cost,
                cost_source=cost_source,
            )
        except ProviderError as error:
            self.store.set_error(
                task_id=task_id,
                code=error.code,
                message=error.message,
                raw_error=error.raw_error,
            )
        except asyncio.CancelledError:
            # Cancellation is expected when users cancel/delete an in-progress task.
            pass
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


def _extract_actual_cost(result: dict[str, object]) -> float | None:
    direct = result.get("cost")
    if isinstance(direct, (int, float)):
        return float(direct)
    usage = result.get("usage")
    if isinstance(usage, dict):
        nested = usage.get("total_cost")
        if isinstance(nested, (int, float)):
            return float(nested)
    billing = result.get("billing")
    if isinstance(billing, dict):
        nested = billing.get("amount")
        if isinstance(nested, (int, float)):
            return float(nested)
    return None


def _extract_settled_cost(
    task: dict[str, Any],
    result: dict[str, object],
) -> tuple[float | None, str | None]:
    provider_cost = _extract_actual_cost(result)
    if provider_cost is not None:
        return provider_cost, "provider_api"

    estimated_cost = task.get("estimated_cost")
    if isinstance(estimated_cost, (int, float)):
        return float(estimated_cost), _normalize_cost_source(task.get("cost_source"))
    return None, None


def _normalize_cost_source(value: Any) -> str:
    if value in {"provider_api", "local_config", "unknown"}:
        return str(value)
    return "unknown"


def _as_optional_text(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


async def _archive_result_assets(
    *,
    task_id: str,
    asset_type: Any,
    result: dict[str, Any],
    provider: Provider,
) -> dict[str, Any]:
    if not isinstance(result, dict):
        return result

    archived = dict(result)
    normalized_asset_type = str(asset_type or "video").lower()
    if normalized_asset_type == "image":
        local_image_urls: list[str] = []
        for index, source_url in enumerate(_extract_image_urls(archived)):
            local_url = await _download_media_to_local(
                task_id=task_id,
                source_url=source_url,
                provider=provider,
                kind="image",
                index=index,
            )
            if local_url:
                local_image_urls.append(local_url)
        if local_image_urls:
            archived["local_image_urls"] = local_image_urls
        return archived

    source_video_url = _extract_video_url(archived)
    if source_video_url:
        local_video_url = await _download_media_to_local(
            task_id=task_id,
            source_url=source_video_url,
            provider=provider,
            kind="video",
            index=0,
        )
        if local_video_url:
            archived["local_video_url"] = local_video_url
    return archived


async def _download_media_to_local(
    *,
    task_id: str,
    source_url: str,
    provider: Provider,
    kind: str,
    index: int,
) -> str | None:
    if not _is_http_url(source_url):
        return None
    try:
        response = await provider.http_client.get(
            source_url,
            timeout=90.0,
            follow_redirects=True,
        )
    except Exception:
        return None
    if response.status_code >= 400:
        return None
    content = response.content
    if not content:
        return None

    archive_dir = provider.app_config.output_dir / "assets" / task_id
    try:
        archive_dir.mkdir(parents=True, exist_ok=True)
    except OSError:
        return None

    extension = _resolve_media_extension(
        source_url=source_url,
        content_type=response.headers.get("content-type"),
        kind=kind,
    )
    filename = f"{kind}_{index + 1}{extension}"
    target_path = archive_dir / filename
    try:
        target_path.write_bytes(content)
    except OSError:
        return None
    return f"/v1/assets/{task_id}/{filename}"


def _is_http_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def _resolve_media_extension(*, source_url: str, content_type: str | None, kind: str) -> str:
    content_type_map = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "video/mp4": ".mp4",
        "video/webm": ".webm",
        "video/quicktime": ".mov",
        "video/mpeg": ".mpeg",
    }
    if isinstance(content_type, str) and content_type.strip():
        normalized_type = content_type.split(";")[0].strip().lower()
        mapped = content_type_map.get(normalized_type)
        if mapped:
            return mapped

    guessed_from_url = Path(urlparse(source_url).path).suffix.lower()
    allowed_suffixes = {
        ".jpg",
        ".jpeg",
        ".png",
        ".webp",
        ".gif",
        ".mp4",
        ".webm",
        ".mov",
        ".mpeg",
    }
    if guessed_from_url in allowed_suffixes:
        return guessed_from_url

    guessed_type, _ = mimetypes.guess_type(source_url)
    if guessed_type:
        mapped = content_type_map.get(guessed_type.lower())
        if mapped:
            return mapped
    return ".mp4" if kind == "video" else ".jpg"


def _extract_video_url(result: dict[str, Any]) -> str | None:
    for key in ("video_url", "url", "download_url"):
        value = result.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _extract_image_urls(result: dict[str, Any]) -> list[str]:
    urls: list[str] = []
    direct = result.get("image_urls")
    if isinstance(direct, list):
        for item in direct:
            if isinstance(item, str) and item.strip():
                urls.append(item.strip())
    images = result.get("images")
    if isinstance(images, list):
        for item in images:
            if isinstance(item, dict):
                url = item.get("url")
                if isinstance(url, str) and url.strip():
                    urls.append(url.strip())
    if not urls:
        for key in ("url", "download_url", "video_url"):
            value = result.get(key)
            if isinstance(value, str) and value.strip():
                urls.append(value.strip())
    deduped: list[str] = []
    seen: set[str] = set()
    for url in urls:
        if url in seen:
            continue
        seen.add(url)
        deduped.append(url)
    return deduped
