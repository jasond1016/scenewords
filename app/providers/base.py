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
