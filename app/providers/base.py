from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

import httpx

from app.config import AppConfig, ProviderConfig
from app.schemas import VideoGenerationRequest


class ProviderError(RuntimeError):
    def __init__(self, code: str, message: str, raw_error: Any | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.raw_error = raw_error


class Provider(ABC):
    def __init__(self, app_config: AppConfig, http_client: httpx.AsyncClient) -> None:
        self.app_config = app_config
        self.http_client = http_client

    @abstractmethod
    async def generate(
        self, provider_config: ProviderConfig, request: VideoGenerationRequest
    ) -> dict[str, Any]:
        raise NotImplementedError


def report_provider_progress(
    request: VideoGenerationRequest,
    *,
    provider_job_id: str | None = None,
    provider_status: str | None = None,
    provider_query_endpoint: str | None = None,
) -> None:
    provider_options = request.provider_options
    if not isinstance(provider_options, dict):
        return
    callback = provider_options.get("__provider_progress_reporter")
    if not callable(callback):
        return

    payload: dict[str, Any] = {}
    if isinstance(provider_job_id, str) and provider_job_id.strip():
        payload["provider_job_id"] = provider_job_id.strip()
    if isinstance(provider_status, str) and provider_status.strip():
        payload["provider_status"] = provider_status.strip()
    if isinstance(provider_query_endpoint, str) and provider_query_endpoint.strip():
        payload["provider_query_endpoint"] = provider_query_endpoint.strip()
    if not payload:
        return
    try:
        callback(payload)
    except Exception:
        # Reporter must never break provider execution.
        return


def extract_resume_checkpoint(request: VideoGenerationRequest) -> tuple[str | None, str | None]:
    provider_options = request.provider_options
    if not isinstance(provider_options, dict):
        return None, None
    provider_job_id_raw = provider_options.get("__resume_provider_job_id")
    provider_query_endpoint_raw = provider_options.get("__resume_provider_query_endpoint")
    provider_job_id = (
        provider_job_id_raw.strip()
        if isinstance(provider_job_id_raw, str) and provider_job_id_raw.strip()
        else None
    )
    provider_query_endpoint = (
        provider_query_endpoint_raw.strip()
        if isinstance(provider_query_endpoint_raw, str) and provider_query_endpoint_raw.strip()
        else None
    )
    return provider_job_id, provider_query_endpoint
