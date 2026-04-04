from __future__ import annotations

import asyncio
import io
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from app.config import ProviderConfig
from app.providers.base import (
    Provider,
    ProviderError,
    extract_resume_checkpoint,
    report_provider_progress,
)
from app.schemas import VideoGenerationRequest

try:
    from PIL import Image, ImageOps
except Exception:  # pragma: no cover - optional dependency at import time
    Image = None  # type: ignore[assignment]
    ImageOps = None  # type: ignore[assignment]


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


@dataclass(slots=True)
class _SubmitRequest:
    endpoint: str
    timeout_sec: float
    files: list[tuple[str, Any]] | None = None
    json_body: dict[str, Any] | None = None
    should_poll: bool = True
    upload_profile: Literal["normal", "aggressive"] = "normal"
    image_processing: list[dict[str, Any]] | None = None


class _TuziAsyncVideoProvider:
    def __init__(self, provider: Provider, mode_name: str, enable_download_fallback: bool) -> None:
        self.provider = provider
        self.mode_name = mode_name
        self.enable_download_fallback = enable_download_fallback

    async def generate(
        self, provider_config: ProviderConfig, request: VideoGenerationRequest
    ) -> dict[str, Any]:
        operation = _normalize_operation(request)
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
            configured=_string_or_none(provider_config.extra.get("query_path"))
            or "/v1/videos/{task_id}",
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
        submit_request = _build_submit_request(
            operation=operation,
            submit_url=submit_url,
            base_url=base_url,
            provider_config=provider_config,
            request=request,
            upload_profile="normal",
        )

        resume_task_id, resume_query_endpoint = extract_resume_checkpoint(request)
        if resume_task_id and resume_query_endpoint:
            task_id = resume_task_id
            submit_json: dict[str, Any] | None = None
            raw_response = {
                "operation": operation,
                "resume": True,
            }
            query_url = resume_query_endpoint
            report_provider_progress(
                request,
                provider_job_id=task_id,
                provider_query_endpoint=query_url,
                provider_status="resuming",
            )
        else:
            submit_json = await self._submit(
                endpoint=submit_request.endpoint,
                headers=headers,
                files=submit_request.files,
                json_body=submit_request.json_body,
                timeout_sec=submit_request.timeout_sec,
            )

            task_id = _extract_task_id(submit_json)
            if not task_id:
                raise ProviderError(
                    code="missing_provider_job_id",
                    message="Tuzi submit response missing task id",
                    raw_error=submit_json,
                )

            raw_response = {
                "operation": operation,
                "submit": submit_json,
                "submit_endpoint": submit_request.endpoint,
            }
            if submit_request.image_processing:
                raw_response["image_processing"] = submit_request.image_processing
                raw_response["image_processing_profile"] = submit_request.upload_profile

            if not submit_request.should_poll:
                report_provider_progress(
                    request,
                    provider_job_id=task_id,
                    provider_status="submitted",
                )
                return {
                    "mode": self.mode_name,
                    "operation": operation,
                    "provider_job_id": task_id,
                    "video_url": _find_video_url(submit_json),
                    "raw_response": raw_response,
                }

            query_url = _render_task_url(base_url=base_url, path_template=query_path, task_id=task_id)
            report_provider_progress(
                request,
                provider_job_id=task_id,
                provider_query_endpoint=query_url,
                provider_status="submitted",
            )

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
        try:
            query_json = await self._poll(
                endpoint=query_url,
                headers=headers,
                timeout_sec=poll_timeout_sec,
                poll_interval_sec=poll_interval_sec,
                request=request,
                provider_job_id=task_id,
            )
        except ProviderError as error:
            if (not (resume_task_id and resume_query_endpoint)) and _should_retry_upload_failure(
                error=error, submit_request=submit_request
            ):
                retry_submit_request = _build_submit_request(
                    operation=operation,
                    submit_url=submit_url,
                    base_url=base_url,
                    provider_config=provider_config,
                    request=request,
                    upload_profile="aggressive",
                )
                retry_submit_json = await self._submit(
                    endpoint=retry_submit_request.endpoint,
                    headers=headers,
                    files=retry_submit_request.files,
                    json_body=retry_submit_request.json_body,
                    timeout_sec=retry_submit_request.timeout_sec,
                )
                retry_task_id = _extract_task_id(retry_submit_json)
                if not retry_task_id:
                    raise ProviderError(
                        code="missing_provider_job_id",
                        message="Tuzi retry submit response missing task id",
                        raw_error=retry_submit_json,
                    ) from error
                retry_query_url = _render_task_url(
                    base_url=base_url,
                    path_template=query_path,
                    task_id=retry_task_id,
                )
                raw_response["retry"] = {
                    "submit": retry_submit_json,
                    "submit_endpoint": retry_submit_request.endpoint,
                    "query_endpoint": retry_query_url,
                    "reason": "PUBLIC_ERROR_MINOR_UPLOAD",
                    "image_processing_profile": retry_submit_request.upload_profile,
                    "image_processing": retry_submit_request.image_processing,
                    "previous_task_id": task_id,
                    "retry_task_id": retry_task_id,
                }
                task_id = retry_task_id
                query_url = retry_query_url
                query_json = await self._poll(
                    endpoint=query_url,
                    headers=headers,
                    timeout_sec=poll_timeout_sec,
                    poll_interval_sec=poll_interval_sec,
                    request=request,
                    provider_job_id=task_id,
                )
            else:
                raise
        raw_response["query"] = query_json
        raw_response["query_endpoint"] = query_url

        video_url = _find_video_url(query_json)
        if not video_url and self.enable_download_fallback and operation in {"generate", "storyboard", "remix"}:
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

        if operation in {"generate", "storyboard", "remix"} and not video_url:
            raise ProviderError(
                code="missing_video_url",
                message="Tuzi task completed but no playable video_url was found",
                raw_error=raw_response,
            )

        return {
            "mode": self.mode_name,
            "operation": operation,
            "provider_job_id": task_id,
            "video_url": video_url,
            "raw_response": raw_response,
        }

    async def _submit(
        self,
        endpoint: str,
        headers: dict[str, str],
        files: list[tuple[str, Any]] | None,
        json_body: dict[str, Any] | None,
        timeout_sec: float,
    ) -> dict[str, Any]:
        request_headers = {**headers}
        if files is not None:
            request_headers.pop("Content-Type", None)

        try:
            response = await self.provider.http_client.post(
                endpoint,
                headers=request_headers,
                files=files,
                json=json_body,
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
        request: VideoGenerationRequest,
        provider_job_id: str,
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
            report_provider_progress(
                request,
                provider_job_id=provider_job_id,
                provider_query_endpoint=endpoint,
                provider_status=status or "polling",
            )
            if _is_failure_payload(payload=payload, status=status):
                raise ProviderError(
                    code="provider_job_failed",
                    message=f"Tuzi provider job failed with status: {status or 'unknown'}",
                    raw_error=payload,
                )

            if _is_success_status(status) or _find_video_url(payload):
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


def _build_submit_request(
    operation: str,
    submit_url: str,
    base_url: str,
    provider_config: ProviderConfig,
    request: VideoGenerationRequest,
    upload_profile: Literal["normal", "aggressive"] = "normal",
) -> _SubmitRequest:
    submit_timeout_sec = _coerce_positive_float(
        request.provider_options.get("submit_timeout_sec"),
        fallback=120.0,
        field_name="submit_timeout_sec",
    )

    if operation in {"generate", "storyboard"}:
        form_files, processing_info = _build_generation_form(
            request=request,
            operation=operation,
            upload_profile=upload_profile,
        )
        return _SubmitRequest(
            endpoint=submit_url,
            timeout_sec=submit_timeout_sec,
            files=form_files,
            should_poll=True,
            upload_profile=upload_profile,
            image_processing=processing_info,
        )

    if operation == "remix":
        source_video_id = _string_or_none(request.provider_options.get("source_video_id"))
        if not source_video_id:
            raise ProviderError(
                code="invalid_provider_option",
                message="source_video_id is required for remix",
            )
        remix_path = _choose_value(
            configured=_string_or_none(provider_config.extra.get("remix_path"))
            or "/v1/videos/{video_id}/remix",
            override=request.provider_options.get("remix_path"),
            allow_override=True,
        )
        if not remix_path:
            raise ProviderError(code="missing_endpoint", message="missing remix_path")
        endpoint = _render_task_url(
            base_url=base_url,
            path_template=remix_path,
            task_id=source_video_id,
        )
        prompt = _string_or_none(request.prompt)
        if not prompt:
            raise ProviderError(code="invalid_prompt", message="prompt is required for remix")
        remix_body = {"prompt": prompt}
        remix_body.update(_safe_dict(request.provider_options.get("extra_body")))
        return _SubmitRequest(
            endpoint=endpoint,
            timeout_sec=submit_timeout_sec,
            json_body=remix_body,
            should_poll=True,
        )

    if operation == "create_character":
        return _SubmitRequest(
            endpoint=submit_url,
            timeout_sec=submit_timeout_sec,
            files=_build_create_character_form(request=request),
            should_poll=False,
        )

    raise ProviderError(
        code="unsupported_operation",
        message=f"Unsupported Tuzi operation: {operation}",
        raw_error={"operation": operation},
    )


def _build_generation_form(
    request: VideoGenerationRequest,
    operation: str,
    upload_profile: Literal["normal", "aggressive"] = "normal",
) -> tuple[list[tuple[str, Any]], list[dict[str, Any]]]:
    model_name = _choose_value(
        configured=request.model,
        override=request.provider_options.get("model"),
        allow_override=True,
    )
    prompt = _string_or_none(request.prompt)
    if not model_name:
        raise ProviderError(code="invalid_model", message="model is required")
    if not prompt:
        raise ProviderError(code="invalid_prompt", message="prompt is required")

    duration_sec = request.duration_sec if isinstance(request.duration_sec, int) else 10
    submit_size, target_width, target_height = _resolve_tuzi_video_submit_resolution(
        request.resolution
    )
    target_ratio = (
        float(target_width) / float(target_height)
        if target_width and target_height and target_height > 0
        else None
    )
    form_payload: dict[str, Any] = {
        "model": model_name,
        "prompt": prompt,
        "seconds": duration_sec,
        "size": submit_size,
    }

    watermark = request.provider_options.get("watermark")
    if watermark is not None:
        form_payload["watermark"] = bool(watermark)

    character_create = request.provider_options.get("character_create")
    if character_create is not None:
        form_payload["character_create"] = bool(character_create)
    elif operation == "storyboard":
        form_payload["character_create"] = True

    if request.seed is not None:
        form_payload["seed"] = request.seed

    form_payload.update(_safe_dict(request.provider_options.get("extra_body")))

    form_parts: list[tuple[str, Any]] = []
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

    image_processing: list[dict[str, Any]] = []
    start_frame_part, start_frame_processing = _collect_optional_single_file_part(
        provider_options=request.provider_options,
        resolved_key="__resolved_start_frame_file_id",
        target_field_name="input_reference",
        target_ratio=target_ratio,
        target_width=target_width,
        target_height=target_height,
        upload_profile=upload_profile,
    )
    end_frame_part, end_frame_processing = _collect_optional_single_file_part(
        provider_options=request.provider_options,
        resolved_key="__resolved_end_frame_file_id",
        target_field_name="input_reference",
        target_ratio=target_ratio,
        target_width=target_width,
        target_height=target_height,
        upload_profile=upload_profile,
    )
    if end_frame_part is not None and start_frame_part is None:
        raise ProviderError(
            code="invalid_provider_option",
            message="end_frame_file_id requires start_frame_file_id",
        )
    if start_frame_part is not None:
        form_parts.append(start_frame_part)
    if start_frame_processing:
        image_processing.append(start_frame_processing)
    if end_frame_part is not None:
        form_parts.append(end_frame_part)
    if end_frame_processing:
        image_processing.append(end_frame_processing)

    for reference in _collect_input_references(request.provider_options):
        form_parts.append(("input_reference", (None, reference)))
    reference_parts, reference_processing = _collect_input_reference_file_parts(
        provider_options=request.provider_options,
        target_ratio=target_ratio,
        target_width=target_width,
        target_height=target_height,
        upload_profile=upload_profile,
    )
    form_parts.extend(reference_parts)
    image_processing.extend(reference_processing)

    return form_parts, image_processing


def _build_create_character_form(
    request: VideoGenerationRequest,
) -> list[tuple[str, tuple[None, str]]]:
    source_task_id = _string_or_none(request.provider_options.get("character_from_task"))
    if not source_task_id:
        raise ProviderError(
            code="invalid_provider_option",
            message="character_from_task is required for create_character",
        )

    character_model = _string_or_none(request.provider_options.get("character_model"))
    if not character_model:
        character_model = "sora-2-character"
    if character_model not in {"sora-2-character", "sora-2-pro-character"}:
        raise ProviderError(
            code="invalid_provider_option",
            message="character_model must be one of: sora-2-character, sora-2-pro-character",
        )

    payload: dict[str, Any] = {
        "model": character_model,
        "character_from_task": source_task_id,
    }
    timestamps = request.provider_options.get("character_timestamps")
    if timestamps is not None:
        payload["character_timestamps"] = timestamps
    payload.update(_safe_dict(request.provider_options.get("extra_body")))

    parts: list[tuple[str, tuple[None, str]]] = []
    for key, value in payload.items():
        coerced = _to_form_value(value)
        if coerced is not None:
            parts.append((key, (None, coerced)))
    return parts


def _collect_input_references(provider_options: dict[str, Any]) -> list[str]:
    raw_value = provider_options.get("input_references", provider_options.get("input_reference"))
    if raw_value is None:
        return []
    if isinstance(raw_value, str):
        normalized = [item.strip() for item in raw_value.replace("\n", ",").split(",")]
        return [item for item in normalized if item]
    if isinstance(raw_value, list):
        values: list[str] = []
        for item in raw_value:
            if isinstance(item, str) and item.strip():
                values.append(item.strip())
        return values
    return []


def _collect_input_reference_file_parts(
    provider_options: dict[str, Any],
    *,
    target_ratio: float | None,
    target_width: int | None,
    target_height: int | None,
    upload_profile: Literal["normal", "aggressive"],
) -> tuple[list[tuple[str, Any]], list[dict[str, Any]]]:
    raw = provider_options.get("__resolved_input_reference_file_ids")
    if not isinstance(raw, list):
        return [], []

    parts: list[tuple[str, Any]] = []
    processing: list[dict[str, Any]] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        part, info = _file_entry_to_multipart_part(
            entry=entry,
            target_field_name="input_reference",
            target_ratio=target_ratio,
            target_width=target_width,
            target_height=target_height,
            upload_profile=upload_profile,
        )
        parts.append(part)
        if info:
            processing.append(info)
    return parts, processing


def _collect_optional_single_file_part(
    provider_options: dict[str, Any],
    resolved_key: str,
    target_field_name: str,
    *,
    target_ratio: float | None,
    target_width: int | None,
    target_height: int | None,
    upload_profile: Literal["normal", "aggressive"],
) -> tuple[tuple[str, Any] | None, dict[str, Any] | None]:
    raw = provider_options.get(resolved_key)
    if raw is None:
        return None, None
    if not isinstance(raw, list):
        raise ProviderError(
            code="invalid_provider_option",
            message=f"{resolved_key} must be a resolved file entry list",
        )
    if len(raw) == 0:
        return None, None
    if len(raw) > 1:
        raise ProviderError(
            code="invalid_provider_option",
            message=f"{resolved_key} only supports one file",
        )
    entry = raw[0]
    if not isinstance(entry, dict):
        raise ProviderError(
            code="invalid_provider_option",
            message=f"{resolved_key} has invalid file metadata",
        )
    return _file_entry_to_multipart_part(
        entry=entry,
        target_field_name=target_field_name,
        target_ratio=target_ratio,
        target_width=target_width,
        target_height=target_height,
        upload_profile=upload_profile,
    )


def _file_entry_to_multipart_part(
    entry: dict[str, Any],
    target_field_name: str,
    *,
    target_ratio: float | None,
    target_width: int | None,
    target_height: int | None,
    upload_profile: Literal["normal", "aggressive"],
) -> tuple[tuple[str, Any], dict[str, Any] | None]:
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
    normalized, meta = _normalize_upload_image(
        content=content,
        filename=filename,
        mime_type=mime_type,
        target_ratio=target_ratio,
        target_width=target_width,
        target_height=target_height,
        upload_profile=upload_profile,
    )
    if normalized is not None:
        filename, content, mime_type = normalized
        if meta is not None:
            meta["field"] = target_field_name
            file_id = entry.get("file_id")
            if isinstance(file_id, str) and file_id:
                meta["file_id"] = file_id
            original_name = entry.get("original_name")
            if isinstance(original_name, str) and original_name:
                meta["original_name"] = original_name
    return (target_field_name, (filename, content, mime_type)), meta


def _normalize_operation(request: VideoGenerationRequest) -> str:
    if isinstance(request.operation, str) and request.operation.strip():
        return request.operation.strip().lower()
    explicit = request.provider_options.get("operation")
    if isinstance(explicit, str) and explicit.strip():
        return explicit.strip().lower()
    return "generate"


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


def _resolve_tuzi_video_submit_resolution(
    raw_resolution: str | None,
) -> tuple[str, int, int]:
    normalized = str(raw_resolution or "").strip().lower()
    if normalized in {"720x1280", "2160x3840"}:
        return "720x1280", 720, 1280
    if normalized in {"1280x720", "3840x2160"}:
        return "1280x720", 1280, 720
    if "x" not in normalized:
        return "1280x720", 1280, 720
    width_part, _, height_part = normalized.partition("x")
    try:
        width = int(width_part.strip())
        height = int(height_part.strip())
    except (TypeError, ValueError):
        return "1280x720", 1280, 720
    if width <= 0 or height <= 0:
        return "1280x720", 1280, 720
    if height > width:
        return "720x1280", 720, 1280
    return "1280x720", 1280, 720


def _parse_resolution_dimensions(raw_resolution: str | None) -> tuple[int | None, int | None]:
    normalized = str(raw_resolution or "").strip().lower()
    if "x" not in normalized:
        return None, None
    width_part, _, height_part = normalized.partition("x")
    try:
        width = int(width_part.strip())
        height = int(height_part.strip())
    except (TypeError, ValueError):
        return None, None
    if width <= 0 or height <= 0:
        return None, None
    return width, height


def _should_retry_upload_failure(error: ProviderError, submit_request: _SubmitRequest) -> bool:
    if submit_request.upload_profile == "aggressive":
        return False
    if not submit_request.files:
        return False
    if error.code != "provider_job_failed":
        return False
    raw = error.raw_error if isinstance(error.raw_error, dict) else {}
    reason_text = json.dumps(raw, ensure_ascii=False).upper()
    return (
        "PUBLIC_ERROR_MINOR_UPLOAD" in reason_text
        or "UPLOADUSERIMAGE" in reason_text
    )


def _normalize_upload_image(
    *,
    content: bytes,
    filename: str,
    mime_type: str,
    target_ratio: float | None,
    target_width: int | None,
    target_height: int | None,
    upload_profile: Literal["normal", "aggressive"],
) -> tuple[tuple[str, bytes, str] | None, dict[str, Any] | None]:
    if Image is None or ImageOps is None:
        return None, None
    if not mime_type.lower().startswith("image/"):
        return None, None

    source_bytes = len(content)
    force_processing = upload_profile == "aggressive"
    max_bytes = 3_000_000 if upload_profile == "normal" else 1_500_000
    try:
        with Image.open(io.BytesIO(content)) as source:
            image = ImageOps.exif_transpose(source)
            original_width, original_height = image.size
            if original_width <= 0 or original_height <= 0:
                return None, None
            if image.mode not in {"RGB", "L"}:
                image = image.convert("RGB")
            elif image.mode == "L":
                image = image.convert("RGB")

            current_ratio = float(original_width) / float(original_height)
            ratio_mismatch = (
                target_ratio is not None and abs(current_ratio - target_ratio) > 0.015
            )
            resize_to_target = (
                target_width is not None
                and target_height is not None
                and (original_width != target_width or original_height != target_height)
            )
            needs_processing = (
                force_processing
                or ratio_mismatch
                or resize_to_target
                or source_bytes > max_bytes
                or mime_type.lower() not in {"image/jpeg", "image/jpg"}
            )
            if not needs_processing:
                return None, None

            resized = False
            padded = False
            if target_width is not None and target_height is not None:
                if ratio_mismatch:
                    image, padded, resized = _fit_with_padding_to_target(
                        image=image,
                        target_width=target_width,
                        target_height=target_height,
                    )
                elif image.size != (target_width, target_height):
                    image = image.resize((target_width, target_height), Image.Resampling.LANCZOS)
                    resized = True
            else:
                max_edge = 1920 if upload_profile == "normal" else 1280
                if max(image.size) > max_edge:
                    scale = float(max_edge) / float(max(image.size))
                    next_size = (
                        max(1, int(round(image.size[0] * scale))),
                        max(1, int(round(image.size[1] * scale))),
                    )
                    image = image.resize(next_size, Image.Resampling.LANCZOS)
                    resized = True

            encoded_bytes, quality_used = _encode_image_with_limit(
                image=image,
                upload_profile=upload_profile,
            )
            if encoded_bytes is None:
                return None, None

            base_name = Path(filename).stem.strip() or "image"
            normalized_name = f"{base_name}.jpg"
            info: dict[str, Any] = {
                "profile": upload_profile,
                "original_size": f"{original_width}x{original_height}",
                "output_size": f"{image.size[0]}x{image.size[1]}",
                "original_bytes": source_bytes,
                "output_bytes": len(encoded_bytes),
                "cropped": False,
                "padded": padded,
                "resized": resized,
                "quality": quality_used,
            }
            return (normalized_name, encoded_bytes, "image/jpeg"), info
    except Exception:
        return None, None


def _fit_with_padding_to_target(
    *,
    image: Any,
    target_width: int,
    target_height: int,
) -> tuple[Any, bool, bool]:
    width, height = image.size
    if width <= 0 or height <= 0:
        return image, False, False
    scale = min(float(target_width) / float(width), float(target_height) / float(height))
    scaled_size = (
        max(1, int(round(width * scale))),
        max(1, int(round(height * scale))),
    )
    resized = scaled_size != image.size
    working = image.resize(scaled_size, Image.Resampling.LANCZOS) if resized else image
    if working.size == (target_width, target_height):
        return working, False, resized

    background = _estimate_padding_color(working)
    canvas = Image.new("RGB", (target_width, target_height), color=background)
    offset_x = max(0, (target_width - working.size[0]) // 2)
    offset_y = max(0, (target_height - working.size[1]) // 2)
    canvas.paste(working, (offset_x, offset_y))
    return canvas, True, resized


def _estimate_padding_color(image: Any) -> tuple[int, int, int]:
    width, height = image.size
    if width <= 0 or height <= 0:
        return (0, 0, 0)
    sample_points = [
        (0, 0),
        (width - 1, 0),
        (0, height - 1),
        (width - 1, height - 1),
        (width // 2, 0),
        (width // 2, height - 1),
        (0, height // 2),
        (width - 1, height // 2),
    ]
    red_sum = 0
    green_sum = 0
    blue_sum = 0
    sample_count = 0
    for x, y in sample_points:
        pixel = image.getpixel((x, y))
        if isinstance(pixel, tuple):
            red = int(pixel[0])
            green = int(pixel[1] if len(pixel) > 1 else pixel[0])
            blue = int(pixel[2] if len(pixel) > 2 else pixel[0])
        else:
            red = int(pixel)
            green = int(pixel)
            blue = int(pixel)
        red_sum += red
        green_sum += green
        blue_sum += blue
        sample_count += 1
    if sample_count <= 0:
        return (0, 0, 0)
    return (
        int(round(red_sum / sample_count)),
        int(round(green_sum / sample_count)),
        int(round(blue_sum / sample_count)),
    )


def _encode_image_with_limit(
    *,
    image: Any,
    upload_profile: Literal["normal", "aggressive"],
) -> tuple[bytes | None, int]:
    max_bytes = 3_000_000 if upload_profile == "normal" else 1_500_000
    quality_candidates = [88, 82, 76, 70, 64, 58] if upload_profile == "normal" else [80, 74, 68, 62, 56, 50]
    working = image
    last_quality = quality_candidates[-1]
    for _attempt in range(4):
        for quality in quality_candidates:
            buffer = io.BytesIO()
            working.save(
                buffer,
                format="JPEG",
                quality=quality,
                optimize=True,
            )
            data = buffer.getvalue()
            last_quality = quality
            if len(data) <= max_bytes:
                return data, quality
        width, height = working.size
        if width < 320 or height < 320:
            break
        scaled = (
            max(1, int(round(width * 0.85))),
            max(1, int(round(height * 0.85))),
        )
        if scaled == working.size:
            break
        working = working.resize(scaled, Image.Resampling.LANCZOS)
    buffer = io.BytesIO()
    working.save(
        buffer,
        format="JPEG",
        quality=last_quality,
        optimize=True,
    )
    return buffer.getvalue(), last_quality


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
