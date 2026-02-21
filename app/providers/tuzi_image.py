from __future__ import annotations

import asyncio
import base64
import os
from pathlib import Path
from typing import Any

from app.config import ProviderConfig
from app.providers.base import (
    Provider,
    ProviderError,
    extract_resume_checkpoint,
    report_provider_progress,
)
from app.schemas import VideoGenerationRequest


class TuziImageProvider(Provider):
    async def generate(
        self, provider_config: ProviderConfig, request: VideoGenerationRequest
    ) -> dict[str, Any]:
        operation = _normalize_operation(request=request)
        if operation == "generate":
            return await _generate_sync(
                provider=self,
                provider_config=provider_config,
                request=request,
            )
        if operation == "edit":
            return await _edit_sync(
                provider=self,
                provider_config=provider_config,
                request=request,
            )
        if operation in {"generate_async", "async_generate"}:
            return await _generate_async(
                provider=self,
                provider_config=provider_config,
                request=request,
            )
        raise ProviderError(
            code="unsupported_operation",
            message=f"Unsupported Tuzi image operation: {operation}",
            raw_error={"operation": operation},
        )


async def _generate_sync(
    *,
    provider: Provider,
    provider_config: ProviderConfig,
    request: VideoGenerationRequest,
) -> dict[str, Any]:
    base_url = _choose_endpoint(
        configured=provider_config.base_url,
        override=request.provider_options.get("base_url"),
        allow_override=provider.app_config.allow_endpoint_override,
    )
    generate_path = _choose_endpoint(
        configured=_string_or_none(provider_config.extra.get("generate_path"))
        or provider_config.api_path
        or "/v1/images/generations",
        override=request.provider_options.get("generate_path"),
        allow_override=provider.app_config.allow_endpoint_override,
    )
    if not base_url or not generate_path:
        raise ProviderError(
            code="missing_endpoint",
            message="Tuzi image generate requires base_url and generate_path",
        )

    payload = _build_generate_payload(request=request)
    headers = _build_headers(provider_config=provider_config, provider_options=request.provider_options)
    headers["Content-Type"] = "application/json"
    endpoint = _join_url(base_url, generate_path)
    timeout_sec = _coerce_positive_float(
        request.provider_options.get("submit_timeout_sec"),
        fallback=120.0,
        field_name="submit_timeout_sec",
    )

    response_payload = await _post_json(
        provider=provider,
        endpoint=endpoint,
        headers=headers,
        payload=payload,
        timeout_sec=timeout_sec,
    )
    images = _extract_images(response_payload)
    return _build_image_result(
        operation="generate",
        provider_job_id=_extract_task_id(response_payload),
        images=images,
        raw_response={"submit_endpoint": endpoint, "submit": response_payload},
    )


async def _edit_sync(
    *,
    provider: Provider,
    provider_config: ProviderConfig,
    request: VideoGenerationRequest,
) -> dict[str, Any]:
    base_url = _choose_endpoint(
        configured=provider_config.base_url,
        override=request.provider_options.get("base_url"),
        allow_override=provider.app_config.allow_endpoint_override,
    )
    edit_path = _choose_endpoint(
        configured=_string_or_none(provider_config.extra.get("edit_path")) or "/v1/images/edits",
        override=request.provider_options.get("edit_path"),
        allow_override=provider.app_config.allow_endpoint_override,
    )
    if not base_url or not edit_path:
        raise ProviderError(
            code="missing_endpoint",
            message="Tuzi image edit requires base_url and edit_path",
        )

    form_parts = _build_edit_form(request=request)
    headers = _build_headers(provider_config=provider_config, provider_options=request.provider_options)
    headers.pop("Content-Type", None)
    endpoint = _join_url(base_url, edit_path)
    timeout_sec = _coerce_positive_float(
        request.provider_options.get("submit_timeout_sec"),
        fallback=120.0,
        field_name="submit_timeout_sec",
    )
    response_payload = await _post_multipart(
        provider=provider,
        endpoint=endpoint,
        headers=headers,
        form_parts=form_parts,
        timeout_sec=timeout_sec,
    )
    images = _extract_images(response_payload)
    return _build_image_result(
        operation="edit",
        provider_job_id=_extract_task_id(response_payload),
        images=images,
        raw_response={"submit_endpoint": endpoint, "submit": response_payload},
    )


async def _generate_async(
    *,
    provider: Provider,
    provider_config: ProviderConfig,
    request: VideoGenerationRequest,
) -> dict[str, Any]:
    base_url = _choose_endpoint(
        configured=provider_config.base_url,
        override=request.provider_options.get("base_url"),
        allow_override=provider.app_config.allow_endpoint_override,
    )
    submit_path = _choose_endpoint(
        configured=_string_or_none(provider_config.extra.get("async_path")) or "/v1/videos",
        override=request.provider_options.get("async_path"),
        allow_override=provider.app_config.allow_endpoint_override,
    )
    query_path = _choose_endpoint(
        configured=_string_or_none(provider_config.extra.get("query_path")) or "/v1/videos/{task_id}",
        override=request.provider_options.get("query_path"),
        allow_override=provider.app_config.allow_endpoint_override,
    )
    if not base_url or not submit_path or not query_path:
        raise ProviderError(
            code="missing_endpoint",
            message="Tuzi image async generate requires base_url, async_path and query_path",
        )

    headers = _build_headers(provider_config=provider_config, provider_options=request.provider_options)
    headers.pop("Content-Type", None)
    submit_endpoint = _join_url(base_url, submit_path)
    submit_timeout_sec = _coerce_positive_float(
        request.provider_options.get("submit_timeout_sec"),
        fallback=120.0,
        field_name="submit_timeout_sec",
    )
    resume_task_id, resume_query_endpoint = extract_resume_checkpoint(request)
    if resume_task_id and resume_query_endpoint:
        task_id = resume_task_id
        query_endpoint = resume_query_endpoint
        submit_payload: dict[str, Any] | None = None
        report_provider_progress(
            request,
            provider_job_id=task_id,
            provider_query_endpoint=query_endpoint,
            provider_status="resuming",
        )
    else:
        submit_payload = await _post_multipart(
            provider=provider,
            endpoint=submit_endpoint,
            headers=headers,
            form_parts=_build_async_form(request=request),
            timeout_sec=submit_timeout_sec,
        )
        task_id = _extract_task_id(submit_payload)
        if not task_id:
            raise ProviderError(
                code="missing_provider_job_id",
                message="Tuzi async submit response missing task id",
                raw_error=submit_payload,
            )

        query_endpoint = _render_task_url(
            base_url=base_url,
            path_template=query_path,
            task_id=task_id,
        )
        report_provider_progress(
            request,
            provider_job_id=task_id,
            provider_query_endpoint=query_endpoint,
            provider_status="submitted",
        )
    timeout_sec = _coerce_positive_float(
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
            fallback=8.0,
            field_name="default_poll_interval_sec",
        ),
        field_name="poll_interval_sec",
    )
    query_payload = await _poll_async_result(
        provider=provider,
        endpoint=query_endpoint,
        headers=headers,
        timeout_sec=timeout_sec,
        poll_interval_sec=poll_interval_sec,
        request=request,
        provider_job_id=task_id,
    )
    images = _extract_images(query_payload)
    if not images:
        raise ProviderError(
            code="missing_image_url",
            message="Tuzi async image task completed but no image result was found",
            raw_error={"query": query_payload, "query_endpoint": query_endpoint},
        )
    return _build_image_result(
        operation="generate_async",
        provider_job_id=task_id,
        images=images,
        raw_response={
            "submit_endpoint": None if submit_payload is None else submit_endpoint,
            "submit": submit_payload,
            "query_endpoint": query_endpoint,
            "query": query_payload,
            "resume": bool(resume_task_id and resume_query_endpoint),
        },
    )


def _build_generate_payload(request: VideoGenerationRequest) -> dict[str, Any]:
    model_name = _resolve_model_name(request=request)
    prompt = _require_prompt(request.prompt)
    payload: dict[str, Any] = {
        "model": model_name,
        "prompt": prompt,
    }

    size = _size_from_resolution(request.resolution, style="x")
    if size:
        payload["size"] = size

    quality = _string_or_none(request.provider_options.get("quality")) or _quality_from_model(
        model_name
    )
    if quality:
        payload["quality"] = quality

    response_format = _string_or_none(request.provider_options.get("response_format")) or "url"
    payload["response_format"] = response_format

    images = _normalize_string_list(
        request.provider_options.get("image", request.provider_options.get("images"))
    )
    if images:
        payload["image"] = images if len(images) > 1 else images[0]

    payload.update(_safe_dict(request.provider_options.get("extra_body")))
    return payload


def _build_edit_form(request: VideoGenerationRequest) -> list[tuple[str, Any]]:
    model_name = _resolve_model_name(request=request)
    prompt = _require_prompt(request.prompt)
    form_parts: list[tuple[str, Any]] = [
        ("model", (None, model_name)),
        ("prompt", (None, prompt)),
    ]

    size = _size_from_resolution(request.resolution, style="x")
    if size:
        form_parts.append(("size", (None, size)))

    quality = _string_or_none(request.provider_options.get("quality")) or _quality_from_model(
        model_name
    )
    if quality:
        form_parts.append(("quality", (None, quality)))

    response_format = _string_or_none(request.provider_options.get("response_format")) or "url"
    form_parts.append(("response_format", (None, response_format)))

    user_value = _string_or_none(request.provider_options.get("user"))
    if user_value:
        form_parts.append(("user", (None, user_value)))

    image_file_parts = _collect_file_parts(
        provider_options=request.provider_options,
        resolved_key="__resolved_image_file_ids",
        target_field_name="image",
        required=True,
        single=False,
    )
    form_parts.extend(image_file_parts)

    mask_part = _collect_file_parts(
        provider_options=request.provider_options,
        resolved_key="__resolved_mask_file_id",
        target_field_name="mask",
        required=False,
        single=True,
    )
    form_parts.extend(mask_part)

    for key, value in _safe_dict(request.provider_options.get("extra_body")).items():
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


def _build_async_form(request: VideoGenerationRequest) -> list[tuple[str, Any]]:
    model_name = _resolve_model_name(request=request)
    prompt = _require_prompt(request.prompt)
    form_parts: list[tuple[str, Any]] = [
        ("model", (None, model_name)),
        ("prompt", (None, prompt)),
    ]

    size = _size_from_resolution(request.resolution, style=":")
    if size:
        form_parts.append(("size", (None, size)))

    for reference in _normalize_string_list(
        request.provider_options.get(
            "input_references", request.provider_options.get("input_reference")
        )
    ):
        form_parts.append(("input_reference", (None, reference)))

    form_parts.extend(
        _collect_file_parts(
            provider_options=request.provider_options,
            resolved_key="__resolved_input_reference_file_ids",
            target_field_name="input_reference",
            required=False,
            single=False,
        )
    )

    for key, value in _safe_dict(request.provider_options.get("extra_body")).items():
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


async def _post_json(
    *,
    provider: Provider,
    endpoint: str,
    headers: dict[str, str],
    payload: dict[str, Any],
    timeout_sec: float,
) -> dict[str, Any]:
    try:
        response = await provider.http_client.post(
            endpoint,
            headers=headers,
            json=payload,
            timeout=timeout_sec,
        )
        response_payload = _safe_json(response)
    except Exception as error:
        raise ProviderError(
            code="provider_request_failed",
            message="Failed to request Tuzi image provider",
            raw_error=str(error),
        ) from error

    if response.status_code >= 400:
        raise ProviderError(
            code="provider_http_error",
            message=f"Tuzi image provider returned HTTP {response.status_code}",
            raw_error=response_payload,
        )
    if not isinstance(response_payload, dict):
        raise ProviderError(
            code="provider_invalid_response",
            message="Tuzi image provider response is not a JSON object",
            raw_error=response_payload,
        )
    return response_payload


async def _post_multipart(
    *,
    provider: Provider,
    endpoint: str,
    headers: dict[str, str],
    form_parts: list[tuple[str, Any]],
    timeout_sec: float,
) -> dict[str, Any]:
    try:
        response = await provider.http_client.post(
            endpoint,
            headers=headers,
            files=form_parts,
            timeout=timeout_sec,
        )
        response_payload = _safe_json(response)
    except Exception as error:
        raise ProviderError(
            code="provider_request_failed",
            message="Failed to request Tuzi image provider",
            raw_error=str(error),
        ) from error

    if response.status_code >= 400:
        raise ProviderError(
            code="provider_http_error",
            message=f"Tuzi image provider returned HTTP {response.status_code}",
            raw_error=response_payload,
        )
    if not isinstance(response_payload, dict):
        raise ProviderError(
            code="provider_invalid_response",
            message="Tuzi image provider response is not a JSON object",
            raw_error=response_payload,
        )
    return response_payload


async def _poll_async_result(
    *,
    provider: Provider,
    endpoint: str,
    headers: dict[str, str],
    timeout_sec: float,
    poll_interval_sec: float,
    request: VideoGenerationRequest,
    provider_job_id: str,
) -> dict[str, Any]:
    deadline = asyncio.get_event_loop().time() + timeout_sec
    while asyncio.get_event_loop().time() < deadline:
        try:
            response = await provider.http_client.get(
                endpoint,
                headers=headers,
                timeout=30.0,
            )
            payload = _safe_json(response)
        except Exception as error:
            raise ProviderError(
                code="provider_poll_failed",
                message="Failed to poll Tuzi image async task",
                raw_error=str(error),
            ) from error

        if response.status_code >= 400:
            raise ProviderError(
                code="provider_http_error",
                message=f"Tuzi image provider returned HTTP {response.status_code} while polling",
                raw_error=payload,
            )
        if not isinstance(payload, dict):
            raise ProviderError(
                code="provider_invalid_response",
                message="Tuzi image provider poll response is not a JSON object",
                raw_error=payload,
            )

        status = _extract_status(payload)
        report_provider_progress(
            request,
            provider_job_id=provider_job_id,
            provider_query_endpoint=endpoint,
            provider_status=status or "polling",
        )
        if status in {"failed", "error", "canceled", "cancelled", "timeout", "expired"}:
            raise ProviderError(
                code="provider_job_failed",
                message=f"Tuzi image async task failed with status: {status}",
                raw_error=payload,
            )
        if _extract_images(payload) or status in {"completed", "succeeded", "success", "done"}:
            report_provider_progress(
                request,
                provider_job_id=provider_job_id,
                provider_query_endpoint=endpoint,
                provider_status="succeeded",
            )
            return payload
        await asyncio.sleep(poll_interval_sec)

    raise ProviderError(
        code="provider_timeout",
        message=f"Tuzi image async task timed out after {int(timeout_sec)} seconds",
        raw_error={"query_endpoint": endpoint},
    )


def _build_image_result(
    *,
    operation: str,
    provider_job_id: str | None,
    images: list[dict[str, str]],
    raw_response: dict[str, Any],
) -> dict[str, Any]:
    image_urls = [item["url"] for item in images if "url" in item]
    return {
        "mode": "tuzi_image",
        "operation": operation,
        "asset_type": "image",
        "provider_job_id": provider_job_id,
        "images": images,
        "image_urls": image_urls,
        "raw_response": raw_response,
    }


def _collect_file_parts(
    *,
    provider_options: dict[str, Any],
    resolved_key: str,
    target_field_name: str,
    required: bool,
    single: bool,
) -> list[tuple[str, Any]]:
    raw = provider_options.get(resolved_key)
    if raw is None:
        if required:
            raise ProviderError(
                code="invalid_provider_option",
                message=f"{resolved_key} is required",
            )
        return []
    if not isinstance(raw, list):
        raise ProviderError(
            code="invalid_provider_option",
            message=f"{resolved_key} must be a resolved file entry list",
        )
    if required and len(raw) == 0:
        raise ProviderError(
            code="invalid_provider_option",
            message=f"{resolved_key} is required",
        )
    if single and len(raw) > 1:
        raise ProviderError(
            code="invalid_provider_option",
            message=f"{resolved_key} only supports one file",
        )
    parts: list[tuple[str, Any]] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        parts.append(_file_entry_to_multipart_part(entry=entry, target_field_name=target_field_name))
    return parts


def _file_entry_to_multipart_part(
    *, entry: dict[str, Any], target_field_name: str
) -> tuple[str, Any]:
    path_text = entry.get("path")
    if not isinstance(path_text, str) or not path_text.strip():
        raise ProviderError(
            code="file_not_found",
            message="Uploaded file path is missing",
            raw_error={"entry": entry},
        )
    file_path = Path(path_text)
    if not file_path.exists():
        raise ProviderError(
            code="file_not_found",
            message=f"Uploaded file not found: {file_path}",
            raw_error={"path": str(file_path)},
        )
    try:
        content = file_path.read_bytes()
    except OSError as error:
        raise ProviderError(
            code="file_read_failed",
            message=f"Failed to read uploaded file: {file_path}",
            raw_error=str(error),
        ) from error

    filename = entry.get("original_name")
    if not isinstance(filename, str) or not filename.strip():
        filename = file_path.name
    mime_type = entry.get("mime_type")
    if not isinstance(mime_type, str) or not mime_type.strip():
        mime_type = "application/octet-stream"
    return (target_field_name, (filename, content, mime_type))


def _extract_images(payload: Any) -> list[dict[str, str]]:
    items: list[dict[str, str]] = []

    def _walk(value: Any) -> None:
        if isinstance(value, dict):
            for key in ("url", "download_url", "uri", "video_url"):
                maybe_url = value.get(key)
                if isinstance(maybe_url, str) and maybe_url.strip():
                    items.append({"url": maybe_url.strip()})
            b64_value = value.get("b64_json")
            if isinstance(b64_value, str) and b64_value.strip():
                items.append({"b64_json": b64_value.strip()})
            for nested_key in (
                "data",
                "result",
                "output",
                "outputs",
                "image",
                "images",
                "video",
            ):
                _walk(value.get(nested_key))
            return
        if isinstance(value, list):
            for item in value:
                _walk(item)

    _walk(payload)
    deduped: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for item in items:
        key = next(iter(item.keys()))
        value = item[key]
        marker = (key, value)
        if marker in seen:
            continue
        seen.add(marker)
        deduped.append(item)
    return deduped


def _normalize_operation(request: VideoGenerationRequest) -> str:
    model_name = (_string_or_none(request.model) or "").lower()
    if isinstance(request.operation, str) and request.operation.strip():
        explicit_operation = request.operation.strip().lower()
        if explicit_operation == "generate" and model_name.endswith("-async"):
            return "generate_async"
        return explicit_operation
    explicit = request.provider_options.get("operation")
    if isinstance(explicit, str) and explicit.strip():
        explicit_operation = explicit.strip().lower()
        if explicit_operation == "generate" and model_name.endswith("-async"):
            return "generate_async"
        return explicit_operation
    if model_name.lower().endswith("-async"):
        return "generate_async"
    return "generate"


def _resolve_model_name(request: VideoGenerationRequest) -> str:
    model_name = _string_or_none(request.provider_options.get("model")) or _string_or_none(request.model)
    if not model_name:
        raise ProviderError(code="invalid_model", message="model is required")
    return model_name


def _quality_from_model(model_name: str) -> str | None:
    normalized = model_name.strip().lower()
    if not normalized:
        return None
    if "4k" in normalized:
        return "4k"
    if "2k" in normalized:
        return "2k"
    if normalized.startswith("gemini-3-pro-image-preview"):
        return "1k"
    return None


def _size_from_resolution(raw_resolution: str | None, *, style: str) -> str | None:
    normalized = _string_or_none(raw_resolution)
    if not normalized:
        return None
    value = normalized.lower().replace(" ", "")
    if "x" in value:
        left, _, right = value.partition("x")
    elif ":" in value:
        left, _, right = value.partition(":")
    else:
        return value
    if not left or not right:
        return None
    separator = ":" if style == ":" else "x"
    return f"{left}{separator}{right}"


def _require_prompt(value: str | None) -> str:
    prompt = _string_or_none(value)
    if not prompt:
        raise ProviderError(code="invalid_prompt", message="prompt is required")
    return prompt


def _normalize_string_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        normalized = [item.strip() for item in value.replace("\n", ",").split(",")]
        return [item for item in normalized if item]
    if isinstance(value, list):
        output: list[str] = []
        for item in value:
            if isinstance(item, str) and item.strip():
                output.append(item.strip())
        return output
    return []


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


def _safe_json(response: Any) -> Any:
    try:
        return response.json()
    except Exception:
        return {"raw_text": response.text}


def _safe_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    return {}


def _string_or_none(value: Any) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _to_form_value(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (str, int, float)):
        return str(value)
    if isinstance(value, bytes):
        return base64.b64encode(value).decode("utf-8")
    return str(value)


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


def _choose_endpoint(configured: str | None, override: Any, allow_override: bool) -> str | None:
    if allow_override and isinstance(override, str) and override.strip():
        return override.strip()
    return configured


def _join_url(base_url: str, path: str) -> str:
    if path.startswith(("http://", "https://")):
        return path
    return f"{base_url.rstrip('/')}/{path.lstrip('/')}"


def _render_task_url(base_url: str, path_template: str, task_id: str) -> str:
    target = _join_url(base_url, path_template)
    try:
        return target.format(task_id=task_id, id=task_id, video_id=task_id)
    except KeyError as error:
        raise ProviderError(
            code="invalid_api_path",
            message=f"Missing path variable in template: {error}",
            raw_error={"path_template": path_template, "task_id": task_id},
        ) from error
