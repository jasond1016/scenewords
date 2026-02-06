from __future__ import annotations

import asyncio
import os
from typing import Any

from app.config import ProviderConfig
from app.providers.base import Provider, ProviderError
from app.schemas import VideoGenerationRequest


class GeminiVeoCompatibleProvider(Provider):
    async def generate(
        self, provider_config: ProviderConfig, request: VideoGenerationRequest
    ) -> dict[str, Any]:
        base_url = _choose_value(
            configured=provider_config.base_url,
            override=request.provider_options.get("base_url"),
            allow_override=self.app_config.allow_endpoint_override,
        )
        api_path = _choose_value(
            configured=provider_config.api_path,
            override=request.provider_options.get("api_path"),
            allow_override=self.app_config.allow_endpoint_override,
        )
        if not base_url or not api_path:
            raise ProviderError(
                code="missing_endpoint",
                message="Gemini-compatible provider requires base_url and api_path",
            )

        model_name = _choose_value(
            configured=request.model,
            override=request.provider_options.get("model"),
            allow_override=True,
        )
        if not model_name:
            raise ProviderError(code="invalid_model", message="model is required")

        path_variables = {
            "model": model_name,
            "project": str(request.provider_options.get("project", "PROJECT_ID")),
            "location": str(request.provider_options.get("location", "us-central1")),
        }
        try:
            rendered_path = api_path.format(**path_variables)
        except KeyError as error:
            raise ProviderError(
                code="invalid_api_path",
                message=f"Missing path variable in api_path: {error}",
                raw_error={"api_path": api_path, "path_variables": path_variables},
            ) from error
        submit_endpoint = _join_url(base_url, rendered_path)

        headers = _build_headers(provider_config, request.provider_options)
        payload = _build_payload(request)
        payload.update(_safe_dict(request.provider_options.get("extra_body")))

        submit_timeout_sec = _coerce_positive_float(
            request.provider_options.get("submit_timeout_sec"),
            fallback=120.0,
            field_name="submit_timeout_sec",
        )
        try:
            submit_response = await self.http_client.post(
                submit_endpoint,
                headers=headers,
                json=payload,
                timeout=submit_timeout_sec,
            )
            submit_json = _safe_json(submit_response)
        except Exception as error:
            raise ProviderError(
                code="provider_request_failed",
                message="Failed to submit request to Gemini-compatible provider",
                raw_error=str(error),
            ) from error

        if submit_response.status_code >= 400:
            raise ProviderError(
                code="provider_http_error",
                message=f"Provider returned HTTP {submit_response.status_code} on submit",
                raw_error=submit_json,
            )

        operation_name = _extract_operation_name(submit_json)
        immediate_video_url = _find_video_url(submit_json)
        if not operation_name and immediate_video_url:
            return {
                "mode": "gemini_veo_compatible",
                "provider_job_id": submit_json.get("id"),
                "video_url": immediate_video_url,
                "raw_response": submit_json,
            }
        if not operation_name:
            raise ProviderError(
                code="missing_operation_name",
                message="Provider did not return operation name",
                raw_error=submit_json,
            )

        poll_timeout_sec = _coerce_positive_float(
            request.provider_options.get("timeout_sec"),
            fallback=_coerce_positive_float(
                provider_config.extra.get("default_timeout_sec"),
                fallback=900.0,
                field_name="default_timeout_sec",
            ),
            field_name="timeout_sec",
        )
        poll_interval_sec = _coerce_positive_float(
            request.provider_options.get("poll_interval_sec"),
            fallback=_coerce_positive_float(
                provider_config.extra.get("default_poll_interval_sec"),
                fallback=10.0,
                field_name="default_poll_interval_sec",
            ),
            field_name="poll_interval_sec",
        )

        operation_base_url = _choose_value(
            configured=_string_or_none(provider_config.extra.get("operation_base_url")) or base_url,
            override=request.provider_options.get("operation_base_url"),
            allow_override=self.app_config.allow_endpoint_override,
        )
        operation_path_template = _choose_value(
            configured=_string_or_none(provider_config.extra.get("operation_path")),
            override=request.provider_options.get("operation_path"),
            allow_override=self.app_config.allow_endpoint_override,
        )
        operation_endpoint = _build_operation_endpoint(
            operation_name=operation_name,
            operation_base_url=operation_base_url,
            operation_path_template=operation_path_template,
        )
        operation_json = await self._poll_operation(
            operation_endpoint=operation_endpoint,
            headers=headers,
            timeout_sec=poll_timeout_sec,
            poll_interval_sec=poll_interval_sec,
        )

        error_payload = operation_json.get("error")
        if error_payload:
            raise ProviderError(
                code="provider_job_failed",
                message="Provider operation failed",
                raw_error=error_payload,
            )

        return {
            "mode": "gemini_veo_compatible",
            "provider_job_id": operation_name,
            "video_url": _find_video_url(operation_json),
            "raw_response": {
                "submit": submit_json,
                "operation": operation_json,
                "operation_endpoint": operation_endpoint,
            },
        }

    async def _poll_operation(
        self,
        operation_endpoint: str,
        headers: dict[str, str],
        timeout_sec: float,
        poll_interval_sec: float,
    ) -> dict[str, Any]:
        deadline = asyncio.get_event_loop().time() + timeout_sec
        while asyncio.get_event_loop().time() < deadline:
            try:
                response = await self.http_client.get(
                    operation_endpoint,
                    headers=headers,
                    timeout=30.0,
                )
                operation_json = _safe_json(response)
            except Exception as error:
                raise ProviderError(
                    code="provider_poll_failed",
                    message="Failed to poll provider operation",
                    raw_error=str(error),
                ) from error

            if response.status_code >= 400:
                raise ProviderError(
                    code="provider_http_error",
                    message=f"Provider returned HTTP {response.status_code} while polling",
                    raw_error=operation_json,
                )

            if operation_json.get("error"):
                raise ProviderError(
                    code="provider_job_failed",
                    message="Provider operation failed",
                    raw_error=operation_json.get("error"),
                )

            if bool(operation_json.get("done")):
                return operation_json
            await asyncio.sleep(poll_interval_sec)

        raise ProviderError(
            code="provider_timeout",
            message=f"Provider operation timed out after {int(timeout_sec)} seconds",
            raw_error={"operation_endpoint": operation_endpoint},
        )


def _build_headers(provider_config: ProviderConfig, provider_options: dict[str, Any]) -> dict[str, str]:
    headers = {
        "Content-Type": "application/json",
        **_safe_dict(provider_options.get("headers")),
    }
    api_key = _resolve_api_key(provider_config, provider_options)
    if api_key:
        header_name = _resolve_api_key_header(provider_config, provider_options)
        headers[header_name] = api_key
    return headers


def _resolve_api_key(provider_config: ProviderConfig, provider_options: dict[str, Any]) -> str | None:
    explicit = provider_options.get("api_key")
    if isinstance(explicit, str) and explicit.strip():
        return explicit.strip()
    configured_key = provider_config.extra.get("api_key")
    if isinstance(configured_key, str) and configured_key.strip():
        return configured_key.strip()
    if provider_config.auth_env:
        env_value = os.getenv(provider_config.auth_env)
        if env_value:
            return env_value
    return None


def _resolve_api_key_header(provider_config: ProviderConfig, provider_options: dict[str, Any]) -> str:
    override = provider_options.get("api_key_header")
    if isinstance(override, str) and override.strip():
        return override.strip()
    configured = provider_config.extra.get("api_key_header")
    if isinstance(configured, str) and configured.strip():
        return configured.strip()
    return "x-goog-api-key"


def _build_payload(request: VideoGenerationRequest) -> dict[str, Any]:
    payload = {
        "instances": [{"prompt": request.prompt}],
        "parameters": {
            "durationSeconds": request.duration_sec,
            "aspectRatio": _resolution_to_aspect_ratio(request.resolution),
        },
    }
    if request.negative_prompt:
        payload["parameters"]["negativePrompt"] = request.negative_prompt
    return payload


def _resolution_to_aspect_ratio(raw_resolution: str) -> str:
    try:
        width_part, height_part = raw_resolution.lower().split("x", 1)
        width = int(width_part.strip())
        height = int(height_part.strip())
    except Exception:
        return "16:9"
    if width <= 0 or height <= 0:
        return "16:9"
    target = width / height
    candidates = [
        (16 / 9, "16:9"),
        (9 / 16, "9:16"),
        (1.0, "1:1"),
        (4 / 3, "4:3"),
        (3 / 4, "3:4"),
        (21 / 9, "21:9"),
    ]
    _, aspect_ratio = min(candidates, key=lambda item: abs(item[0] - target))
    return aspect_ratio


def _extract_operation_name(payload: Any) -> str | None:
    if isinstance(payload, dict):
        for key in ("name", "operation", "operation_name", "id"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return None


def _build_operation_endpoint(
    operation_name: str,
    operation_base_url: str | None,
    operation_path_template: str | None,
) -> str:
    if operation_name.startswith("http://") or operation_name.startswith("https://"):
        return operation_name

    if not operation_base_url:
        raise ProviderError(
            code="missing_endpoint",
            message="operation_base_url is required to poll operation",
            raw_error={"operation_name": operation_name},
        )

    if operation_path_template:
        path = operation_path_template.format(operation_name=operation_name)
        return _join_url(operation_base_url, path)
    return _join_url(operation_base_url, operation_name)


def _find_video_url(payload: Any) -> str | None:
    if isinstance(payload, dict):
        for key in ("video_url", "download_url", "url", "uri"):
            value = payload.get(key)
            if isinstance(value, str) and value:
                return value
        for nested_key in (
            "response",
            "generateVideoResponse",
            "generatedSamples",
            "generatedVideos",
            "video",
            "result",
            "data",
            "outputs",
            "output",
        ):
            nested = payload.get(nested_key)
            found = _find_video_url(nested)
            if found:
                return found
    if isinstance(payload, list):
        for item in payload:
            found = _find_video_url(item)
            if found:
                return found
    return None


def _join_url(base_url: str, path: str) -> str:
    return f"{base_url.rstrip('/')}/{path.lstrip('/')}"


def _safe_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    return {}


def _safe_json(response: Any) -> Any:
    try:
        return response.json()
    except Exception:
        return {"raw_text": response.text}


def _choose_value(configured: str | None, override: Any, allow_override: bool) -> str | None:
    if allow_override and isinstance(override, str) and override.strip():
        return override.strip()
    return configured


def _string_or_none(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _coerce_positive_float(value: Any, fallback: float, field_name: str) -> float:
    if value is None:
        return fallback
    try:
        parsed = float(value)
    except (TypeError, ValueError) as error:
        raise ProviderError(
            code="invalid_provider_option",
            message=f"{field_name} must be a positive number",
            raw_error={field_name: value},
        ) from error
    if parsed <= 0:
        raise ProviderError(
            code="invalid_provider_option",
            message=f"{field_name} must be a positive number",
            raw_error={field_name: value},
        )
    return parsed
