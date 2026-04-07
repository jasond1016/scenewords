from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class VideoGenerationRequest(BaseModel):
    provider: str = Field(..., description="Provider id from /v1/models")
    model: str = Field(..., description="Model name")
    operation: str | None = Field(default=None, description="Operation id for selected model")
    prompt: str | None = None
    negative_prompt: str | None = None
    duration_sec: int | None = Field(default=None, ge=1, le=60)
    resolution: str | None = None
    fps: int | None = Field(default=None, ge=1, le=120)
    seed: int | None = None
    provider_options: dict[str, Any] = Field(default_factory=dict)


class VideoTaskResponse(BaseModel):
    task_id: str
    status: str
    asset_type: Literal["video", "image"] = "video"
    provider: str
    model: str
    queue_position: int | None = None
    created_at: datetime
    updated_at: datetime


class VideoTaskDetail(VideoTaskResponse):
    operation: str | None = None
    provider_job_id: str | None = None
    provider_status: str | None = None
    provider_query_endpoint: str | None = None
    prompt: str
    negative_prompt: str | None = None
    duration_sec: int | None = None
    resolution: str | None = None
    fps: int | None = None
    seed: int | None = None
    provider_options: dict[str, Any] = Field(default_factory=dict)
    estimated_cost: float | None = None
    actual_cost: float | None = None
    currency: str | None = None
    cost_source: Literal["provider_api", "local_config", "unknown"] = "unknown"
    result: dict[str, Any] | None = None
    error: dict[str, Any] | None = None


class ProviderModelInfo(BaseModel):
    name: str
    display_name: str
    is_default: bool = False
    operations: list["ProviderModelOperationInfo"] = Field(default_factory=list)


class ProviderInfo(BaseModel):
    id: str
    display_name: str
    type: str
    models: list[ProviderModelInfo]
    supports_custom_endpoint: bool


class ProviderCatalogResponse(BaseModel):
    providers: list[ProviderInfo]


class ProviderOperationOption(BaseModel):
    value: str
    label: str


class ProviderOperationField(BaseModel):
    key: str
    label: str
    target: Literal["request", "provider_options"] = "request"
    input_type: Literal[
        "text",
        "textarea",
        "number",
        "select",
        "boolean",
        "password",
        "json",
        "string_list",
        "file",
        "file_list",
    ] = "text"
    required: bool = False
    default: Any | None = None
    placeholder: str | None = None
    help_text: str | None = None
    min: float | None = None
    max: float | None = None
    step: float | None = None
    options: list[ProviderOperationOption] = Field(default_factory=list)


class ProviderModelOperationInfo(BaseModel):
    id: str
    display_name: str
    description: str | None = None
    is_default: bool = False
    fields: list[ProviderOperationField] = Field(default_factory=list)


class UploadedFileResponse(BaseModel):
    file_id: str
    original_name: str
    mime_type: str
    size_bytes: int
    sha256: str
    created_at: datetime
    url: str


class RetryTaskRequest(BaseModel):
    retry_mode: Literal["same_seed", "new_seed"] = "same_seed"
    prompt: str | None = None


class PricingEntryResponse(BaseModel):
    provider: str
    model: str
    quality: str | None = None
    resolution: str | None = None
    duration_sec: int | None = None
    fixed_cost: float | None = None
    cost_per_second: float | None = None
    currency: str = "USD"
    effective_from: str | None = None


class PricingCatalogResponse(BaseModel):
    mode: Literal["provider_api", "local_config"] = "local_config"
    currency: str = "USD"
    pricing_version: str | None = None
    entries: list[PricingEntryResponse] = Field(default_factory=list)
