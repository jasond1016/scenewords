from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class VideoGenerationRequest(BaseModel):
    provider: str = Field(..., description="Provider id from /v1/models")
    model: str = Field(..., description="Model name")
    prompt: str = Field(..., min_length=1)
    negative_prompt: str | None = None
    duration_sec: int = Field(default=4, ge=1, le=20)
    resolution: str = Field(default="854x480")
    fps: int = Field(default=24, ge=8, le=60)
    seed: int | None = None
    provider_options: dict[str, Any] = Field(default_factory=dict)


class VideoTaskResponse(BaseModel):
    task_id: str
    status: str
    provider: str
    model: str
    created_at: datetime
    updated_at: datetime


class VideoTaskDetail(VideoTaskResponse):
    prompt: str
    result: dict[str, Any] | None = None
    error: dict[str, Any] | None = None


class ProviderModelInfo(BaseModel):
    name: str
    display_name: str
    is_default: bool = False


class ProviderInfo(BaseModel):
    id: str
    display_name: str
    type: str
    models: list[ProviderModelInfo]
    supports_custom_endpoint: bool


class ProviderCatalogResponse(BaseModel):
    providers: list[ProviderInfo]
