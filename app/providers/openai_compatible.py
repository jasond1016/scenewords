from __future__ import annotations

import os
from typing import Any

from app.config import ProviderConfig
from app.providers.base import Provider, ProviderError
from app.schemas import VideoGenerationRequest


class OpenAICompatibleProvider(Provider):
    async def generate(
        self, provider_config: ProviderConfig, request: VideoGenerationRequest
    ) -> dict[str, Any]:
        prompt = _require_prompt(request.prompt)
        duration_sec = request.duration_sec if isinstance(request.duration_sec, int) else 4
        resolution = request.resolution or "1280x720"
        fps = request.fps if isinstance(request.fps, int) else 24
        base_url = _choose_value(
            configured_value=provider_config.base_url,
            override_value=request.provider_options.get("base_url"),
            allow_override=self.app_config.allow_endpoint_override,
        )
        api_path = _choose_value(
            configured_value=provider_config.api_path,
            override_value=request.provider_options.get("api_path"),
            allow_override=self.app_config.allow_endpoint_override,
        )
        model_name = _choose_value(
            configured_value=request.model,
            override_value=request.provider_options.get("model"),
            allow_override=True,
        )

        if not base_url or not api_path:
            raise ProviderError(
                code="missing_endpoint",
                message="Provider requires both base_url and api_path",
            )

        auth_token = _resolve_auth_token(provider_config, request.provider_options)
        timeout_sec = float(request.provider_options.get("timeout_sec", 120))
        endpoint = f"{base_url.rstrip('/')}/{api_path.lstrip('/')}"
        headers = {
            "Content-Type": "application/json",
            **_safe_dict(request.provider_options.get("headers")),
        }
        if auth_token:
            headers["Authorization"] = f"Bearer {auth_token}"

        payload: dict[str, Any] = {
            "model": model_name,
            "prompt": prompt,
            "duration": duration_sec,
            "resolution": resolution,
            "fps": fps,
            "seed": request.seed,
        }
        if request.negative_prompt:
            payload["negative_prompt"] = request.negative_prompt
        payload.update(_safe_dict(request.provider_options.get("extra_body")))
        payload = {key: value for key, value in payload.items() if value is not None}

        try:
            response = await self.http_client.post(
                endpoint,
                headers=headers,
                json=payload,
                timeout=timeout_sec,
            )
            response_json = _safe_json(response)
        except Exception as error:
            raise ProviderError(
                code="provider_request_failed",
                message=f"Request failed for provider {provider_config.provider_id}",
                raw_error=str(error),
            ) from error

        if response.status_code >= 400:
            raise ProviderError(
                code="provider_http_error",
                message=f"Provider returned HTTP {response.status_code}",
                raw_error=response_json,
            )

        return {
            "mode": "openai_compatible",
            "provider_job_id": response_json.get("id"),
            "video_url": _find_video_url(response_json),
            "raw_response": response_json,
        }


def _require_prompt(value: str | None) -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()
    raise ProviderError(code="invalid_prompt", message="prompt is required")


def _resolve_auth_token(
    provider_config: ProviderConfig, provider_options: dict[str, Any]
) -> str | None:
    explicit_token = provider_options.get("api_key")
    if isinstance(explicit_token, str) and explicit_token.strip():
        return explicit_token.strip()
    if provider_config.auth_env:
        env_token = os.getenv(provider_config.auth_env)
        if env_token:
            return env_token
    return None


def _choose_value(
    configured_value: str | None, override_value: Any, allow_override: bool
) -> str | None:
    if allow_override and isinstance(override_value, str) and override_value.strip():
        return override_value.strip()
    return configured_value


def _safe_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    return {}


def _safe_json(response: Any) -> Any:
    try:
        return response.json()
    except Exception:
        return {"raw_text": response.text}


def _find_video_url(payload: Any) -> str | None:
    if isinstance(payload, dict):
        for key in ("video_url", "download_url", "url"):
            value = payload.get(key)
            if isinstance(value, str) and value:
                return value
        for nested_key in ("data", "output", "outputs", "result", "video"):
            nested_value = payload.get(nested_key)
            found = _find_video_url(nested_value)
            if found:
                return found
    if isinstance(payload, list):
        for item in payload:
            found = _find_video_url(item)
            if found:
                return found
    return None
