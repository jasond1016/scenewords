from __future__ import annotations

import os
from typing import Any

from app.config import ProviderConfig
from app.providers.base import Provider, ProviderError
from app.schemas import VideoGenerationRequest


class VertexVeoProvider(Provider):
    async def generate(
        self, provider_config: ProviderConfig, request: VideoGenerationRequest
    ) -> dict[str, Any]:
        prompt = _require_prompt(request.prompt)
        duration_sec = request.duration_sec if isinstance(request.duration_sec, int) else 4
        resolution = request.resolution or "1280x720"
        fps = request.fps if isinstance(request.fps, int) else 24
        base_url = _choose_endpoint(
            configured=provider_config.base_url,
            override=request.provider_options.get("base_url"),
            allow_override=self.app_config.allow_endpoint_override,
        )
        api_path = _choose_endpoint(
            configured=provider_config.api_path,
            override=request.provider_options.get("api_path"),
            allow_override=self.app_config.allow_endpoint_override,
        )
        if not base_url or not api_path:
            raise ProviderError(
                code="missing_endpoint",
                message="Vertex provider requires both base_url and api_path",
            )

        model_name = request.provider_options.get("model", request.model)
        if not isinstance(model_name, str) or not model_name.strip():
            raise ProviderError(code="invalid_model", message="model is required")

        path_variables = {
            "model": model_name.strip(),
            "project": str(request.provider_options.get("project", "PROJECT_ID")),
            "location": str(request.provider_options.get("location", "us-central1")),
        }
        rendered_path = api_path.format(**path_variables)
        endpoint = f"{base_url.rstrip('/')}/{rendered_path.lstrip('/')}"

        auth_token = _resolve_auth_token(provider_config, request.provider_options)
        headers = {
            "Content-Type": "application/json",
            **_safe_dict(request.provider_options.get("headers")),
        }
        if auth_token:
            headers["Authorization"] = f"Bearer {auth_token}"

        payload = {
            "instances": [{"prompt": prompt}],
            "parameters": {
                "durationSeconds": duration_sec,
                "fps": fps,
                "resolution": resolution,
            },
        }
        if request.negative_prompt:
            payload["parameters"]["negativePrompt"] = request.negative_prompt
        payload.update(_safe_dict(request.provider_options.get("extra_body")))

        try:
            timeout_sec = float(request.provider_options.get("timeout_sec", 120))
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
                message="Failed to call Vertex Veo endpoint",
                raw_error=str(error),
            ) from error

        if response.status_code >= 400:
            raise ProviderError(
                code="provider_http_error",
                message=f"Vertex provider returned HTTP {response.status_code}",
                raw_error=response_json,
            )

        return {
            "mode": "vertex_veo",
            "provider_job_id": response_json.get("name") or response_json.get("id"),
            "video_url": None,
            "raw_response": response_json,
        }


def _safe_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    return {}


def _safe_json(response: Any) -> Any:
    try:
        return response.json()
    except Exception:
        return {"raw_text": response.text}


def _choose_endpoint(configured: str | None, override: Any, allow_override: bool) -> str | None:
    if allow_override and isinstance(override, str) and override.strip():
        return override.strip()
    return configured


def _resolve_auth_token(
    provider_config: ProviderConfig, provider_options: dict[str, Any]
) -> str | None:
    explicit_token = provider_options.get("api_key")
    if isinstance(explicit_token, str) and explicit_token.strip():
        return explicit_token.strip()
    if provider_config.auth_env:
        return os.getenv(provider_config.auth_env)
    return None


def _require_prompt(value: str | None) -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()
    raise ProviderError(code="invalid_prompt", message="prompt is required")
