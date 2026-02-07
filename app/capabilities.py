from __future__ import annotations

from typing import Any

from app.config import ProviderConfig
from app.schemas import ProviderModelOperationInfo, ProviderOperationField, ProviderOperationOption
from app.schemas import VideoGenerationRequest


class CapabilityValidationError(ValueError):
    pass


def build_model_operations(
    provider_config: ProviderConfig, model_name: str
) -> list[ProviderModelOperationInfo]:
    provider_type = provider_config.provider_type
    timeout_default = _positive_number(
        provider_config.extra.get("default_timeout_sec"), fallback=900.0
    )
    poll_default = _positive_number(
        provider_config.extra.get("default_poll_interval_sec"), fallback=5.0
    )

    if provider_type == "tuzi_sora":
        return _tuzi_sora_operations(timeout_default=timeout_default, poll_default=poll_default)
    if provider_type == "tuzi_veo":
        return _tuzi_veo_operations(timeout_default=timeout_default, poll_default=poll_default)
    if provider_type == "comfyui":
        return _comfyui_operations(timeout_default=timeout_default, poll_default=poll_default)
    if provider_type == "gemini_veo_compatible":
        return _gemini_veo_operations(timeout_default=timeout_default, poll_default=poll_default)
    if provider_type == "vertex_veo":
        return _vertex_veo_operations(timeout_default=timeout_default)
    if provider_type == "openai_compatible":
        return _openai_operations(timeout_default=timeout_default)
    return _generic_operations(timeout_default=timeout_default)


def apply_operation_defaults_and_validate(
    request: VideoGenerationRequest,
    operations: list[ProviderModelOperationInfo],
) -> str:
    if not operations:
        request.operation = request.operation or "generate"
        return request.operation

    operation_id = request.operation or _default_operation_id(operations)
    operation = _find_operation(operations, operation_id)
    if not operation:
        raise CapabilityValidationError(f"Unsupported operation: {operation_id}")

    request.operation = operation.id
    for field in operation.fields:
        value = _read_field(request=request, field=field)
        if _is_empty_value(value) and field.default is not None:
            _write_field(request=request, field=field, value=field.default)
            value = field.default
        if field.required and _is_empty_value(value):
            raise CapabilityValidationError(f"Missing required field: {field.key}")
    return operation.id


def _default_operation_id(operations: list[ProviderModelOperationInfo]) -> str:
    for operation in operations:
        if operation.is_default:
            return operation.id
    return operations[0].id


def _find_operation(
    operations: list[ProviderModelOperationInfo], operation_id: str
) -> ProviderModelOperationInfo | None:
    for operation in operations:
        if operation.id == operation_id:
            return operation
    return None


def _read_field(request: VideoGenerationRequest, field: ProviderOperationField) -> Any:
    if field.target == "provider_options":
        return request.provider_options.get(field.key)
    return getattr(request, field.key, None)


def _write_field(
    request: VideoGenerationRequest, field: ProviderOperationField, value: Any
) -> None:
    if field.target == "provider_options":
        request.provider_options[field.key] = value
        return
    setattr(request, field.key, value)


def _is_empty_value(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, list):
        return len(value) == 0
    return False


def _positive_number(value: Any, fallback: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return fallback
    if parsed <= 0:
        return fallback
    return parsed


def _option(value: str, label: str) -> ProviderOperationOption:
    return ProviderOperationOption(value=value, label=label)


def _field(
    key: str,
    label: str,
    *,
    target: str = "request",
    input_type: str = "text",
    required: bool = False,
    default: Any | None = None,
    placeholder: str | None = None,
    help_text: str | None = None,
    min_value: float | None = None,
    max_value: float | None = None,
    step: float | None = None,
    options: list[ProviderOperationOption] | None = None,
) -> ProviderOperationField:
    return ProviderOperationField(
        key=key,
        label=label,
        target=target,  # type: ignore[arg-type]
        input_type=input_type,  # type: ignore[arg-type]
        required=required,
        default=default,
        placeholder=placeholder,
        help_text=help_text,
        min=min_value,
        max=max_value,
        step=step,
        options=options or [],
    )


def _resolution_field(default_value: str = "1280x720") -> ProviderOperationField:
    return _field(
        "resolution",
        "分辨率",
        input_type="select",
        required=True,
        default=default_value,
        options=[
            _option("1280x720", "1280x720 (横屏)"),
            _option("720x1280", "720x1280 (竖屏)"),
        ],
    )


def _tuzi_sora_operations(
    *, timeout_default: float, poll_default: float
) -> list[ProviderModelOperationInfo]:
    shared_submit = [
        _field("prompt", "提示词", input_type="textarea", required=True),
        _field(
            "duration_sec",
            "时长(秒)",
            input_type="number",
            required=True,
            default=10,
            min_value=1,
            max_value=20,
            step=1,
        ),
        _resolution_field(),
        _field(
            "input_references",
            "参考图 URL",
            target="provider_options",
            input_type="string_list",
            placeholder="每行一个 URL，可留空",
        ),
        _field(
            "watermark",
            "添加水印",
            target="provider_options",
            input_type="boolean",
            default=False,
        ),
        _field(
            "api_key",
            "API Key",
            target="provider_options",
            input_type="password",
            help_text="留空则使用服务端环境变量",
        ),
        _field(
            "timeout_sec",
            "超时(s)",
            target="provider_options",
            input_type="number",
            default=timeout_default,
            min_value=30,
            step=1,
        ),
        _field(
            "poll_interval_sec",
            "轮询间隔(s)",
            target="provider_options",
            input_type="number",
            default=poll_default,
            min_value=1,
            step=1,
        ),
    ]
    return [
        ProviderModelOperationInfo(
            id="generate",
            display_name="文生/图生视频",
            description="调用 Tuzi Sora 异步生成视频",
            is_default=True,
            fields=[
                *shared_submit,
                _field(
                    "character_create",
                    "自动创建角色",
                    target="provider_options",
                    input_type="boolean",
                    default=False,
                ),
            ],
        ),
        ProviderModelOperationInfo(
            id="storyboard",
            display_name="故事板生成",
            description="使用镜头分段提示词，自动创建角色信息",
            fields=[
                _field(
                    "prompt",
                    "故事板提示词",
                    input_type="textarea",
                    required=True,
                    placeholder="例：Scene 1: ...\\nScene 2: ...",
                ),
                *[field for field in shared_submit if field.key != "prompt"],
                _field(
                    "character_create",
                    "自动创建角色",
                    target="provider_options",
                    input_type="boolean",
                    default=True,
                ),
            ],
        ),
        ProviderModelOperationInfo(
            id="remix",
            display_name="视频 Remix",
            description="基于已存在视频 ID 生成新版本",
            fields=[
                _field("prompt", "Remix 提示词", input_type="textarea", required=True),
                _field(
                    "source_video_id",
                    "源视频 ID",
                    target="provider_options",
                    required=True,
                    placeholder="输入要 remix 的视频 ID",
                ),
                _field(
                    "api_key",
                    "API Key",
                    target="provider_options",
                    input_type="password",
                    help_text="留空则使用服务端环境变量",
                ),
                _field(
                    "timeout_sec",
                    "超时(s)",
                    target="provider_options",
                    input_type="number",
                    default=timeout_default,
                    min_value=30,
                    step=1,
                ),
                _field(
                    "poll_interval_sec",
                    "轮询间隔(s)",
                    target="provider_options",
                    input_type="number",
                    default=poll_default,
                    min_value=1,
                    step=1,
                ),
            ],
        ),
        ProviderModelOperationInfo(
            id="create_character",
            display_name="创建角色",
            description="从已有视频任务提取角色（无视频输出）",
            fields=[
                _field(
                    "character_from_task",
                    "来源任务 ID",
                    target="provider_options",
                    required=True,
                    placeholder="输入已有视频任务 ID",
                ),
                _field(
                    "character_timestamps",
                    "角色时间点",
                    target="provider_options",
                    placeholder="例如 0,3（可选）",
                ),
                _field(
                    "api_key",
                    "API Key",
                    target="provider_options",
                    input_type="password",
                    help_text="留空则使用服务端环境变量",
                ),
            ],
        ),
    ]


def _tuzi_veo_operations(
    *, timeout_default: float, poll_default: float
) -> list[ProviderModelOperationInfo]:
    return [
        ProviderModelOperationInfo(
            id="generate",
            display_name="生成视频",
            description="调用 Tuzi Veo 异步生成",
            is_default=True,
            fields=[
                _field("prompt", "提示词", input_type="textarea", required=True),
                _field(
                    "duration_sec",
                    "时长(秒)",
                    input_type="number",
                    required=True,
                    default=8,
                    min_value=1,
                    max_value=20,
                    step=1,
                ),
                _resolution_field(),
                _field(
                    "input_references",
                    "参考图 URL",
                    target="provider_options",
                    input_type="string_list",
                    placeholder="每行一个 URL，可留空",
                ),
                _field(
                    "watermark",
                    "添加水印",
                    target="provider_options",
                    input_type="boolean",
                    default=False,
                ),
                _field(
                    "api_key",
                    "API Key",
                    target="provider_options",
                    input_type="password",
                    help_text="留空则使用服务端环境变量",
                ),
                _field(
                    "timeout_sec",
                    "超时(s)",
                    target="provider_options",
                    input_type="number",
                    default=timeout_default,
                    min_value=30,
                    step=1,
                ),
                _field(
                    "poll_interval_sec",
                    "轮询间隔(s)",
                    target="provider_options",
                    input_type="number",
                    default=poll_default,
                    min_value=1,
                    step=1,
                ),
            ],
        )
    ]


def _comfyui_operations(
    *, timeout_default: float, poll_default: float
) -> list[ProviderModelOperationInfo]:
    return [
        ProviderModelOperationInfo(
            id="generate",
            display_name="生成视频",
            is_default=True,
            fields=[
                _field("prompt", "提示词", input_type="textarea", required=True),
                _field("negative_prompt", "负向提示词", input_type="textarea"),
                _field(
                    "duration_sec",
                    "时长(秒)",
                    input_type="number",
                    required=True,
                    default=4,
                    min_value=1,
                    max_value=60,
                    step=1,
                ),
                _field(
                    "fps",
                    "FPS",
                    input_type="number",
                    required=True,
                    default=24,
                    min_value=1,
                    max_value=120,
                    step=1,
                ),
                _field(
                    "resolution",
                    "分辨率",
                    input_type="select",
                    required=True,
                    default="854x480",
                    options=[
                        _option("854x480", "854x480"),
                        _option("1024x576", "1024x576"),
                        _option("1280x720", "1280x720"),
                        _option("720x1280", "720x1280"),
                    ],
                ),
                _field(
                    "workflow",
                    "Workflow JSON",
                    target="provider_options",
                    input_type="json",
                    placeholder='{"6":{"inputs":{"text":"..."}}}',
                ),
                _field(
                    "prompt_node_id",
                    "Prompt 节点 ID",
                    target="provider_options",
                    default="6",
                ),
                _field(
                    "prompt_input_key",
                    "Prompt 输入 Key",
                    target="provider_options",
                    default="text",
                ),
                _field(
                    "timeout_sec",
                    "超时(s)",
                    target="provider_options",
                    input_type="number",
                    default=timeout_default,
                    min_value=30,
                    step=1,
                ),
                _field(
                    "poll_interval_sec",
                    "轮询间隔(s)",
                    target="provider_options",
                    input_type="number",
                    default=poll_default,
                    min_value=0.2,
                    step=0.2,
                ),
            ],
        )
    ]


def _gemini_veo_operations(
    *, timeout_default: float, poll_default: float
) -> list[ProviderModelOperationInfo]:
    return [
        ProviderModelOperationInfo(
            id="generate",
            display_name="生成视频",
            is_default=True,
            fields=[
                _field("prompt", "提示词", input_type="textarea", required=True),
                _field("negative_prompt", "负向提示词", input_type="textarea"),
                _field(
                    "duration_sec",
                    "时长(秒)",
                    input_type="number",
                    required=True,
                    default=4,
                    min_value=1,
                    max_value=20,
                    step=1,
                ),
                _resolution_field(),
                _field(
                    "api_key",
                    "API Key",
                    target="provider_options",
                    input_type="password",
                ),
                _field(
                    "timeout_sec",
                    "超时(s)",
                    target="provider_options",
                    input_type="number",
                    default=timeout_default,
                    min_value=30,
                    step=1,
                ),
                _field(
                    "poll_interval_sec",
                    "轮询间隔(s)",
                    target="provider_options",
                    input_type="number",
                    default=poll_default,
                    min_value=1,
                    step=1,
                ),
            ],
        )
    ]


def _vertex_veo_operations(*, timeout_default: float) -> list[ProviderModelOperationInfo]:
    return [
        ProviderModelOperationInfo(
            id="generate",
            display_name="生成视频",
            is_default=True,
            fields=[
                _field("prompt", "提示词", input_type="textarea", required=True),
                _field("negative_prompt", "负向提示词", input_type="textarea"),
                _field(
                    "duration_sec",
                    "时长(秒)",
                    input_type="number",
                    required=True,
                    default=4,
                    min_value=1,
                    max_value=20,
                    step=1,
                ),
                _resolution_field(),
                _field(
                    "fps",
                    "FPS",
                    input_type="number",
                    required=True,
                    default=24,
                    min_value=1,
                    max_value=120,
                    step=1,
                ),
                _field(
                    "api_key",
                    "API Key",
                    target="provider_options",
                    input_type="password",
                ),
                _field(
                    "timeout_sec",
                    "超时(s)",
                    target="provider_options",
                    input_type="number",
                    default=timeout_default,
                    min_value=30,
                    step=1,
                ),
            ],
        )
    ]


def _openai_operations(*, timeout_default: float) -> list[ProviderModelOperationInfo]:
    return [
        ProviderModelOperationInfo(
            id="generate",
            display_name="生成视频",
            is_default=True,
            fields=[
                _field("prompt", "提示词", input_type="textarea", required=True),
                _field("negative_prompt", "负向提示词", input_type="textarea"),
                _field(
                    "duration_sec",
                    "时长(秒)",
                    input_type="number",
                    required=True,
                    default=4,
                    min_value=1,
                    max_value=20,
                    step=1,
                ),
                _resolution_field(default_value="854x480"),
                _field(
                    "fps",
                    "FPS",
                    input_type="number",
                    required=True,
                    default=24,
                    min_value=1,
                    max_value=120,
                    step=1,
                ),
                _field("seed", "随机种子", input_type="number", step=1),
                _field(
                    "api_key",
                    "API Key",
                    target="provider_options",
                    input_type="password",
                ),
                _field(
                    "timeout_sec",
                    "超时(s)",
                    target="provider_options",
                    input_type="number",
                    default=timeout_default,
                    min_value=30,
                    step=1,
                ),
            ],
        )
    ]


def _generic_operations(*, timeout_default: float) -> list[ProviderModelOperationInfo]:
    return [
        ProviderModelOperationInfo(
            id="generate",
            display_name="生成视频",
            is_default=True,
            fields=[
                _field("prompt", "提示词", input_type="textarea", required=True),
                _field(
                    "duration_sec",
                    "时长(秒)",
                    input_type="number",
                    required=True,
                    default=4,
                    min_value=1,
                    step=1,
                ),
                _resolution_field(default_value="1280x720"),
                _field(
                    "api_key",
                    "API Key",
                    target="provider_options",
                    input_type="password",
                ),
                _field(
                    "timeout_sec",
                    "超时(s)",
                    target="provider_options",
                    input_type="number",
                    default=timeout_default,
                    min_value=30,
                    step=1,
                ),
            ],
        )
    ]
