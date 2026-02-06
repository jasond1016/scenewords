from __future__ import annotations

import asyncio
import json
import os
from typing import Any

from app.config import ProviderConfig
from app.providers.base import Provider, ProviderError
from app.schemas import VideoGenerationRequest


class TuziVeoProvider(Provider):
    async def generate(
        self, provider_config: ProviderConfig, request: VideoGenerationRequest
    ) -> dict[str, Any]:
        return await _TuziAsyncVideoProvider(
            provider=self,
            mode_name="tuzi_veo",
            enable_download_fallback=False,
        ).generate(provider_config=provider_config, request=request)


class TuziSoraProvider(Provider):
    async def generate(
        self, provider_config: ProviderConfig, request: VideoGenerationRequest
    ) -> dict[str, Any]:
        return await _TuziAsyncVideoProvider(
            provider=self,
            mode_name="tuzi_sora",
            enable_download_fallback=True,
        ).generate(provider_config=provider_config, request=request)


class _TuziAsyncVideoProvider:
    def __init__(self, provider: Provider, mode_name: str, enable_download_fallback: bool) -> None:
        self.provider = provider
        self.mode_name = mode_name
        self.enable_download_fallback = enable_download_fallback

    async def generate(
        self, provider_config: ProviderConfig, request: VideoGenerationRequest
    ) -> dict[str, Any]:
        base_url = _choose_value(
            configured=provider_config.base_url,
            override=request.provider_options.get("base_url"),
            allow_override=self.provider.app_config.allow_endpoint_override,
        )
        api_path = _choose_value(
            configured=provider_config.api_path,
            override=request.provider_options.get("api_path"),
            allow_override=self.provider.app_config.allow_endpoint_override,
        )
        query_path = _choose_value(
            configured=_string_or_none(provider_config.extra.get("query_path")) or "/v1/videos/{task_id}",
            override=request.provider_options.get("query_path"),
            allow_override=self.provider.app_config.allow_endpoint_override,
        )
        if not base_url or not api_path or not query_path:
            raise ProviderError(
                code="missing_endpoint",
                message="Tuzi provider requires base_url, api_path and query_path",
            )

        headers = _build_headers(provider_config=provider_config, provider_options=request.provider_options)
        submit_url = _join_url(base_url, api_path)
        submit_timeout_sec = _coerce_positive_float(
            request.provider_options.get("submit_timeout_sec"),
            fallback=120.0,
            field_name="submit_timeout_sec",
        )
        submit_json = await self._submit(
            endpoint=submit_url,
            headers=headers,
            form_parts=_build_submit_form(request),
            timeout_sec=submit_timeout_sec,
        )

        task_id = _extract_task_id(submit_json)
        if not task_id:
            raise ProviderError(
                code="missing_provider_job_id",
                message="Tuzi submit response missing task id",
                raw_error=submit_json,
            )

        query_url = _render_task_url(base_url=base_url, path_template=query_path, task_id=task_id)
        poll_timeout_sec = _coerce_positive_float(
            request.provider_options.get("timeout_sec"),
            fallback=_coerce_positive_float(
                provider_config.extra.get("default_timeout_sec"),
                fallback=1200.0,
                field_name="default_timeout_sec",
            ),
            field_name="timeout_sec",
        )
        poll_interval_sec = _coerce_positive_float(
            request.provider_options.get("poll_interval_sec"),
            fallback=_coerce_positive_float(
                provider_config.extra.get("default_poll_interval_sec"),
                fallback=5.0,
                field_name="default_poll_interval_sec",
            ),
            field_name="poll_interval_sec",
        )
        query_json = await self._poll(
            endpoint=query_url,
            headers=headers,
            timeout_sec=poll_timeout_sec,
            poll_interval_sec=poll_interval_sec,
        )

        raw_response: dict[str, Any] = {
            "submit": submit_json,
            "query": query_json,
            "query_endpoint": query_url,
        }

        video_url = _find_video_url(query_json)
        if not video_url and self.enable_download_fallback:
            fallback_url, download_meta = await self._download_fallback(
                provider_config=provider_config,
                request=request,
                base_url=base_url,
                task_id=task_id,
                headers=headers,
            )
            if download_meta:
                raw_response["download"] = download_meta
            if fallback_url:
                video_url = fallback_url

        if not video_url:
            raise ProviderError(
                code="missing_video_url",
                message="Tuzi task completed but no playable video_url was found",
                raw_error=raw_response,
            )

        return {
            "mode": self.mode_name,
            "provider_job_id": task_id,
            "video_url": video_url,
            "raw_response": raw_response,
        }

    async def _submit(
        self,
        endpoint: str,
        headers: dict[str, str],
        form_parts: list[tuple[str, tuple[None, str]]],
        timeout_sec: float,
    ) -> dict[str, Any]:
        try:
            response = await self.provider.http_client.post(
                endpoint,
                headers=headers,
                files=form_parts,
                timeout=timeout_sec,
            )
            payload = _safe_json(response)
        except Exception as error:
            raise ProviderError(
                code="provider_request_failed",
                message="Failed to submit request to Tuzi provider",
                raw_error=str(error),
            ) from error

        if response.status_code >= 400:
            raise ProviderError(
                code="provider_http_error",
                message=f"Tuzi provider returned HTTP {response.status_code} on submit",
                raw_error=payload,
            )
        if not isinstance(payload, dict):
            raise ProviderError(
                code="provider_invalid_response",
                message="Tuzi submit response is not a JSON object",
                raw_error=payload,
            )
        return payload

    async def _poll(
        self,
        endpoint: str,
        headers: dict[str, str],
        timeout_sec: float,
        poll_interval_sec: float,
    ) -> dict[str, Any]:
        deadline = asyncio.get_event_loop().time() + timeout_sec
        while asyncio.get_event_loop().time() < deadline:
            try:
                response = await self.provider.http_client.get(
                    endpoint,
                    headers=headers,
                    timeout=30.0,
                )
                payload = _safe_json(response)
            except Exception as error:
                raise ProviderError(
                    code="provider_poll_failed",
                    message="Failed to poll Tuzi provider",
                    raw_error=str(error),
                ) from error

            if response.status_code >= 400:
                raise ProviderError(
                    code="provider_http_error",
                    message=f"Tuzi provider returned HTTP {response.status_code} while polling",
                    raw_error=payload,
                )
            if not isinstance(payload, dict):
                raise ProviderError(
                    code="provider_invalid_response",
                    message="Tuzi query response is not a JSON object",
                    raw_error=payload,
                )

            status = _extract_status(payload)
            if _is_failure_payload(payload=payload, status=status):
                raise ProviderError(
                    code="provider_job_failed",
                    message=f"Tuzi provider job failed with status: {status or 'unknown'}",
                    raw_error=payload,
                )

            if _is_success_status(status) or _find_video_url(payload):
                return payload

            await asyncio.sleep(poll_interval_sec)

        raise ProviderError(
            code="provider_timeout",
            message=f"Tuzi provider timed out after {int(timeout_sec)} seconds",
            raw_error={"query_endpoint": endpoint},
        )

    async def _download_fallback(
        self,
        provider_config: ProviderConfig,
        request: VideoGenerationRequest,
        base_url: str,
        task_id: str,
        headers: dict[str, str],
    ) -> tuple[str | None, dict[str, Any] | None]:
        download_path = _choose_value(
            configured=_string_or_none(provider_config.extra.get("download_path"))
            or "/v1/videos/{task_id}/content",
            override=request.provider_options.get("download_path"),
            allow_override=self.provider.app_config.allow_endpoint_override,
        )
        if not download_path:
            return None, None

        endpoint = _render_task_url(base_url=base_url, path_template=download_path, task_id=task_id)
        timeout_sec = _coerce_positive_float(
            request.provider_options.get("download_timeout_sec"),
            fallback=120.0,
            field_name="download_timeout_sec",
        )
        try:
            response = await self.provider.http_client.get(
                endpoint,
                headers=headers,
                timeout=timeout_sec,
                follow_redirects=False,
            )
        except Exception as error:
            return None, {"endpoint": endpoint, "error": str(error)}

        download_meta: dict[str, Any] = {
            "endpoint": endpoint,
            "status_code": response.status_code,
            "content_type": response.headers.get("content-type"),
        }
        if response.status_code >= 400:
            download_meta["response"] = _safe_json(response)
            return None, download_meta

        resolved = _extract_download_url(response)
        if resolved:
            download_meta["resolved_video_url"] = resolved
            return resolved, download_meta

        download_meta["response"] = _safe_json(response)
        return None, download_meta


def _build_submit_form(request: VideoGenerationRequest) -> list[tuple[str, tuple[None, str]]]:
    model_name = _choose_value(
        configured=request.model,
        override=request.provider_options.get("model"),
        allow_override=True,
    )
    if not model_name:
        raise ProviderError(code="invalid_model", message="model is required")

    form_payload: dict[str, Any] = {
        "model": model_name,
        "prompt": request.prompt,
        "seconds": request.duration_sec,
        "size": _resolution_to_tuzi_size(request.resolution),
    }
    if request.negative_prompt:
        form_payload["negative_prompt"] = request.negative_prompt
    if request.seed is not None:
        form_payload["seed"] = request.seed

    # Keep gateway behavior flexible for vendor-specific multipart fields.
    form_payload.update(_safe_dict(request.provider_options.get("extra_body")))

    form_parts: list[tuple[str, tuple[None, str]]] = []
    for key, value in form_payload.items():
        if value is None:
            continue
        if isinstance(value, list):
            for item in value:
                coerced = _to_form_value(item)
                if coerced is not None:
                    form_parts.append((key, (None, coerced)))
            continue
        coerced = _to_form_value(value)
        if coerced is not None:
            form_parts.append((key, (None, coerced)))
    return form_parts


def _to_form_value(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (str, int, float)):
        return str(value)
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def _resolution_to_tuzi_size(raw_resolution: str) -> str:
    normalized = str(raw_resolution or "").strip().lower()
    if normalized in {"360p", "540p", "720p", "1080p"}:
        return normalized
    if "x" not in normalized:
        return "720p"
    width_part, _, height_part = normalized.partition("x")
    try:
        width = int(width_part.strip())
        height = int(height_part.strip())
    except (TypeError, ValueError):
        return "720p"
    if width <= 0 or height <= 0:
        return "720p"
    longest_edge = max(width, height)
    if longest_edge >= 1920:
        return "1080p"
    return "720p"


def _build_headers(provider_config: ProviderConfig, provider_options: dict[str, Any]) -> dict[str, str]:
    headers = {**_safe_dict(provider_options.get("headers"))}
    api_key = _resolve_api_key(provider_config=provider_config, provider_options=provider_options)
    if api_key:
        header_name = _resolve_auth_header(provider_config=provider_config, provider_options=provider_options)
        if header_name.lower() == "authorization":
            headers["Authorization"] = f"Bearer {api_key}"
        else:
            headers[header_name] = api_key
    return headers


def _resolve_api_key(provider_config: ProviderConfig, provider_options: dict[str, Any]) -> str | None:
    explicit = provider_options.get("api_key")
    if isinstance(explicit, str) and explicit.strip():
        return explicit.strip()
    configured = provider_config.extra.get("api_key")
    if isinstance(configured, str) and configured.strip():
        return configured.strip()
    if provider_config.auth_env:
        env_value = os.getenv(provider_config.auth_env)
        if env_value:
            return env_value
    return None


def _resolve_auth_header(provider_config: ProviderConfig, provider_options: dict[str, Any]) -> str:
    override = provider_options.get("auth_header")
    if isinstance(override, str) and override.strip():
        return override.strip()
    configured = provider_config.extra.get("auth_header")
    if isinstance(configured, str) and configured.strip():
        return configured.strip()
    return "Authorization"


def _extract_task_id(payload: dict[str, Any]) -> str | None:
    for key in ("id", "task_id", "video_id"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _extract_status(payload: dict[str, Any]) -> str | None:
    value = payload.get("status")
    if isinstance(value, str) and value.strip():
        return value.strip().lower()
    return None


def _is_failure_payload(payload: dict[str, Any], status: str | None) -> bool:
    if status in {"failed", "error", "canceled", "cancelled", "timeout", "expired"}:
        return True
    return payload.get("error") is not None


def _is_success_status(status: str | None) -> bool:
    return status in {"completed", "succeeded", "success", "done"}


def _extract_download_url(response: Any) -> str | None:
    location = response.headers.get("location")
    if isinstance(location, str) and location.startswith(("http://", "https://")):
        return location

    payload = _safe_json(response)
    from_payload = _find_video_url(payload)
    if from_payload:
        return from_payload

    content_type = (response.headers.get("content-type") or "").lower()
    if "text/plain" in content_type:
        text = response.text.strip()
        if text.startswith(("http://", "https://")):
            return text
    return None


def _render_task_url(base_url: str, path_template: str, task_id: str) -> str:
    target = path_template
    if not target.startswith(("http://", "https://")):
        target = _join_url(base_url, target)
    try:
        return target.format(task_id=task_id, id=task_id, video_id=task_id)
    except KeyError as error:
        raise ProviderError(
            code="invalid_api_path",
            message=f"Missing path variable in template: {error}",
            raw_error={"path_template": path_template, "task_id": task_id},
        ) from error


def _find_video_url(payload: Any) -> str | None:
    if isinstance(payload, dict):
        for key in ("video_url", "download_url", "url", "uri"):
            value = payload.get(key)
            if isinstance(value, str) and value:
                return value
        for nested_key in ("data", "result", "output", "outputs", "video"):
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


def _safe_json(response: Any) -> Any:
    try:
        return response.json()
    except Exception:
        return {"raw_text": response.text}


def _safe_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    return {}


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
