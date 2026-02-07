from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(slots=True)
class ProviderModelConfig:
    name: str
    display_name: str
    is_default: bool = False


@dataclass(slots=True)
class ProviderConfig:
    provider_id: str
    display_name: str
    provider_type: str
    enabled: bool
    base_url: str | None
    api_path: str | None
    auth_env: str | None
    models: list[ProviderModelConfig]
    supports_custom_endpoint: bool
    extra: dict[str, Any]


@dataclass(slots=True)
class AppConfig:
    provider_config_path: Path
    db_path: Path
    output_dir: Path
    upload_dir: Path
    bearer_token: str | None
    allow_endpoint_override: bool
    max_recent_tasks: int
    max_upload_mb: int


def load_app_config() -> AppConfig:
    provider_config_path = Path(
        os.getenv("VIDEO_GATEWAY_CONFIG", "config/providers.json")
    ).resolve()
    db_path = Path(os.getenv("VIDEO_GATEWAY_DB_PATH", "data/tasks.db")).resolve()
    output_dir = Path(
        os.getenv("VIDEO_GATEWAY_OUTPUT_DIR", "data/outputs")
    ).resolve()
    upload_dir = Path(os.getenv("VIDEO_GATEWAY_UPLOAD_DIR", "data/uploads")).resolve()
    bearer_token = os.getenv("VIDEO_GATEWAY_BEARER_TOKEN")
    allow_endpoint_override = (
        os.getenv("VIDEO_GATEWAY_ALLOW_ENDPOINT_OVERRIDE", "true").lower() == "true"
    )
    max_recent_tasks = int(os.getenv("VIDEO_GATEWAY_MAX_RECENT_TASKS", "50"))
    max_upload_mb = int(os.getenv("VIDEO_GATEWAY_MAX_UPLOAD_MB", "10"))

    return AppConfig(
        provider_config_path=provider_config_path,
        db_path=db_path,
        output_dir=output_dir,
        upload_dir=upload_dir,
        bearer_token=bearer_token,
        allow_endpoint_override=allow_endpoint_override,
        max_recent_tasks=max_recent_tasks,
        max_upload_mb=max_upload_mb,
    )


def load_provider_configs(path: Path) -> dict[str, ProviderConfig]:
    with path.open("r", encoding="utf-8") as file:
        payload = json.load(file)

    providers: dict[str, ProviderConfig] = {}
    for raw_provider in payload.get("providers", []):
        models = [
            ProviderModelConfig(
                name=raw_model["name"],
                display_name=raw_model.get("display_name", raw_model["name"]),
                is_default=bool(raw_model.get("default", False)),
            )
            for raw_model in raw_provider.get("models", [])
        ]
        provider = ProviderConfig(
            provider_id=raw_provider["id"],
            display_name=raw_provider.get("display_name", raw_provider["id"]),
            provider_type=raw_provider["type"],
            enabled=bool(raw_provider.get("enabled", True)),
            base_url=raw_provider.get("base_url"),
            api_path=raw_provider.get("api_path"),
            auth_env=raw_provider.get("auth_env"),
            models=models,
            supports_custom_endpoint=bool(
                raw_provider.get("supports_custom_endpoint", True)
            ),
            extra={
                key: value
                for key, value in raw_provider.items()
                if key
                not in {
                    "id",
                    "display_name",
                    "type",
                    "enabled",
                    "base_url",
                    "api_path",
                    "auth_env",
                    "models",
                    "supports_custom_endpoint",
                }
            },
        )
        providers[provider.provider_id] = provider
    return providers
