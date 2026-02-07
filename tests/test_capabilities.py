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
