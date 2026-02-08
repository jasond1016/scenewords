from __future__ import annotations

import json
from pathlib import Path

from app.capabilities import build_model_operations
from app.config import ProviderConfig, ProviderModelConfig, load_provider_configs


def _build_provider_config(
    *,
    provider_type: str,
    model_name: str,
    model_extra: dict[str, object] | None = None,
) -> ProviderConfig:
    return ProviderConfig(
        provider_id="demo",
        display_name="Demo",
        provider_type=provider_type,
        enabled=True,
        base_url=None,
        api_path=None,
        auth_env=None,
        models=[
            ProviderModelConfig(
                name=model_name,
                display_name=model_name,
                is_default=True,
                extra=model_extra or {},
            )
        ],
        supports_custom_endpoint=True,
        extra={},
    )


def test_load_provider_configs_keeps_model_duration_options(tmp_path: Path) -> None:
    config_path = tmp_path / "providers.json"
    config_path.write_text(
        json.dumps(
            {
                "providers": [
                    {
                        "id": "sora2",
                        "type": "tuzi_sora",
                        "models": [
                            {
                                "name": "sora2",
                                "default": True,
                                "duration_options": [10, 15],
                            }
                        ],
                    }
                ]
            }
        ),
        encoding="utf-8",
    )

    providers = load_provider_configs(config_path)
    model = providers["sora2"].models[0]
    assert model.extra is not None
    assert model.extra["duration_options"] == [10, 15]


def test_build_model_operations_uses_model_duration_options() -> None:
    provider = _build_provider_config(
        provider_type="tuzi_sora",
        model_name="sora2",
        model_extra={"duration_options": [10, 15]},
    )

    operations = build_model_operations(provider, "sora2")
    generate = next(item for item in operations if item.id == "generate")
    duration_field = next(field for field in generate.fields if field.key == "duration_sec")

    assert duration_field.default == 10
    assert [option.value for option in duration_field.options] == ["10", "15"]
    assert [option.label for option in duration_field.options] == ["10s", "15s"]


def test_tuzi_sora_create_character_exposes_character_model_options() -> None:
    provider = _build_provider_config(
        provider_type="tuzi_sora",
        model_name="sora-2",
    )

    operations = build_model_operations(provider, "sora-2")
    create_character = next(item for item in operations if item.id == "create_character")
    character_model_field = next(
        field for field in create_character.fields if field.key == "character_model"
    )

    assert character_model_field.default == "sora-2-character"
    assert [option.value for option in character_model_field.options] == [
        "sora-2-character",
        "sora-2-pro-character",
    ]


def test_tuzi_image_operations_include_generate_edit_and_async() -> None:
    provider = _build_provider_config(
        provider_type="tuzi_image",
        model_name="gemini-3-pro-image-preview",
    )

    operations = build_model_operations(provider, "gemini-3-pro-image-preview")
    operation_ids = [item.id for item in operations]

    assert operation_ids == ["generate", "edit", "generate_async"]

    edit = next(item for item in operations if item.id == "edit")
    image_file_field = next(field for field in edit.fields if field.key == "image_file_ids")
    mask_field = next(field for field in edit.fields if field.key == "mask_file_id")
    assert image_file_field.input_type == "file_list"
    assert image_file_field.required is True
    assert mask_field.input_type == "file"

    generate = next(item for item in operations if item.id == "generate")
    format_field = next(field for field in generate.fields if field.key == "response_format")
    assert [option.value for option in format_field.options] == ["url", "b64_json"]
