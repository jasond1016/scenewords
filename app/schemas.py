from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class VideoGenerationRequest(BaseModel):
    provider: str = Field(..., description="Provider id from /v1/models")
    model: str = Field(..., description="Model name")
    operation: str | None = Field(default=None, description="Operation id for selected model")
    scene_id: str | None = None
    generation_id: str | None = None
    parent_version_id: str | None = None
    prompt: str | None = None
    negative_prompt: str | None = None
    duration_sec: int | None = Field(default=None, ge=1, le=60)
    resolution: str | None = None
    fps: int | None = Field(default=None, ge=1, le=120)
    seed: int | None = None
    provider_options: dict[str, Any] = Field(default_factory=dict)
    subject_bindings: list["SubjectBindingSnapshot"] = Field(default_factory=list)


class SubjectBindingSnapshot(BaseModel):
    subject_id: str
    kind: Literal["character", "object", "location"]
    name: str
    description: str = ""
    fixed_traits: list[str] = Field(default_factory=list)
    reference_file_ids: list[str] = Field(default_factory=list)


class VideoTaskResponse(BaseModel):
    task_id: str
    status: str
    asset_type: Literal["video", "image"] = "video"
    provider: str
    model: str
    scene_id: str | None = None
    scene_title: str | None = None
    generation_id: str | None = None
    parent_version_id: str | None = None
    version_number: int | None = None
    adopted_version_id: str | None = None
    task_stage: Literal["draft", "final"] = "draft"
    final_source_task_id: str | None = None
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
    subject_bindings: list[SubjectBindingSnapshot] = Field(default_factory=list)
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


class SubjectReferenceInput(BaseModel):
    file_id: str
    role: str = "reference"
    is_primary: bool = False


class SubjectReferenceResponse(SubjectReferenceInput):
    reference_id: str
    original_name: str
    mime_type: str
    url: str


class SubjectAssetInput(BaseModel):
    kind: Literal["character", "object", "location"]
    name: str = Field(..., min_length=1, max_length=120)
    description: str = Field(default="", max_length=4000)
    fixed_traits: list[str] = Field(default_factory=list)
    variable_traits: list[str] = Field(default_factory=list)
    references: list[SubjectReferenceInput] = Field(default_factory=list)


class SubjectAssetResponse(BaseModel):
    subject_id: str
    kind: Literal["character", "object", "location"]
    name: str
    description: str
    fixed_traits: list[str]
    variable_traits: list[str]
    references: list[SubjectReferenceResponse]
    created_at: datetime
    updated_at: datetime


class SubjectReferenceFromTaskInput(BaseModel):
    task_id: str
    image_index: int = Field(default=0, ge=0)
    role: str = Field(default="reference", max_length=120)
    is_primary: bool = False


class SceneCreateInput(BaseModel):
    title: str = Field(..., min_length=1, max_length=160)
    description: str = Field(default="", max_length=4000)


class SceneResponse(BaseModel):
    scene_id: str
    title: str
    description: str
    approved_generation_id: str | None = None
    approved_version_id: str | None = None
    current_final_id: str | None = None
    generation_count: int = 0
    version_count: int = 0
    created_at: datetime
    updated_at: datetime


class SceneGenerationResponse(BaseModel):
    generation_id: str
    asset_type: Literal["video", "image"]
    adopted_version_id: str | None = None
    created_at: datetime
    versions: list[VideoTaskDetail]


class SceneDetailResponse(SceneResponse):
    generations: list[SceneGenerationResponse]
    finals: list[VideoTaskDetail] = Field(default_factory=list)


class SceneFinalizeInput(BaseModel):
    provider: str
    model: str
    operation: str
    resolution: str | None = None
    resolution_tier: str | None = None


class RetryTaskRequest(BaseModel):
    retry_mode: Literal["same_seed", "new_seed"] = "same_seed"
    prompt: str | None = None


class PricingEntryResponse(BaseModel):
    provider: str
    model: str
    operation: str | None = None
    quality: str | None = None
    resolution: str | None = None
    duration_sec: int | None = None
    fixed_cost: float | None = None
    cost_per_second: float | None = None
    discount_rate: float | None = None
    currency: str = "USD"
    effective_from: str | None = None


class PricingCatalogResponse(BaseModel):
    mode: Literal["provider_api", "local_config"] = "local_config"
    currency: str = "USD"
    pricing_version: str | None = None
    entries: list[PricingEntryResponse] = Field(default_factory=list)


class TaskCostSummaryResponse(BaseModel):
    charged_cost_total: float = 0.0
    charged_task_count: int = 0
    pending_estimated_cost_total: float = 0.0
    pending_estimated_task_count: int = 0
    currency: str = "USD"
