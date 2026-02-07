from __future__ import annotations

import asyncio
import json
import os
import re
from copy import deepcopy
from pathlib import Path
from typing import Any
from uuid import uuid4

from app.config import ProviderConfig
from app.providers.base import Provider, ProviderError
from app.schemas import VideoGenerationRequest


class ComfyUIProvider(Provider):
    async def generate(
        self, provider_config: ProviderConfig, request: VideoGenerationRequest
    ) -> dict[str, Any]:
        prompt = _require_prompt(request.prompt)
        duration_sec = request.duration_sec if isinstance(request.duration_sec, int) else 4
        fps = request.fps if isinstance(request.fps, int) else 24
        resolution = request.resolution or "854x480"
        workflow = _resolve_workflow(
            provider_options=request.provider_options,
            provider_config=provider_config,
            provider_config_path=self.app_config.provider_config_path,
        )
        if not workflow:
            await asyncio.sleep(2.0)
            return {
                "mode": "simulation",
                "message": (
                    "No workflow found from provider_options.workflow or provider "
                    "default_workflow/default_workflow_path, task simulated."
                ),
                "video_url": None,
            }
        _validate_workflow_format(workflow)

        prompt_node_id = str(request.provider_options.get("prompt_node_id", "6"))
        prompt_input_key = str(request.provider_options.get("prompt_input_key", "text"))
        default_timeout_sec = _coerce_positive_int(
            provider_config.extra.get("default_timeout_sec"),
            fallback=900,
            field_name="default_timeout_sec",
        )
        timeout_sec = _coerce_positive_int(
            request.provider_options.get("timeout_sec"),
            fallback=default_timeout_sec,
            field_name="timeout_sec",
        )
        default_poll_interval_sec = _coerce_positive_float(
            provider_config.extra.get("default_poll_interval_sec"),
            fallback=2.0,
            field_name="default_poll_interval_sec",
        )
        poll_interval_sec = _coerce_positive_float(
            request.provider_options.get("poll_interval_sec"),
            fallback=default_poll_interval_sec,
            field_name="poll_interval_sec",
        )

        _inject_prompt(
            workflow=workflow,
            prompt=prompt,
            negative_prompt=request.negative_prompt,
            prompt_node_id=prompt_node_id,
            prompt_input_key=prompt_input_key,
        )
        _apply_video_request_settings(
            workflow=workflow,
            duration_sec=duration_sec,
            fps=fps,
            resolution=resolution,
            provider_options=request.provider_options,
            provider_config=provider_config,
        )

        base_url = _pick_endpoint(
            provider_config.base_url,
            request.provider_options.get("base_url"),
            self.app_config.allow_endpoint_override,
        )
        if not base_url:
            raise ProviderError(
                code="missing_endpoint",
                message="ComfyUI provider missing base_url",
            )
        public_base_url = _pick_public_endpoint(
            call_base_url=base_url,
            configured_public_base_url=provider_config.extra.get("public_base_url"),
            override_public_base_url=request.provider_options.get("public_base_url"),
            allow_override=self.app_config.allow_endpoint_override,
        )

        payload = {"prompt": workflow, "client_id": str(uuid4())}
        try:
            submit_response = await self.http_client.post(
                f"{base_url.rstrip('/')}/prompt",
                json=payload,
                timeout=30.0,
            )
            submit_response.raise_for_status()
            submit_json = submit_response.json()
        except Exception as error:
            raw_error = str(error)
            response = getattr(error, "response", None)
            if response is not None:
                response_json: Any
                try:
                    response_json = response.json()
                except Exception:
                    response_json = response.text
                raw_error = {
                    "exception": str(error),
                    "status_code": response.status_code,
                    "response_body": response_json,
                }
            raise ProviderError(
                code="comfy_submit_failed",
                message="Failed to submit workflow to ComfyUI",
                raw_error=raw_error,
            ) from error

        prompt_id = submit_json.get("prompt_id")
        if not prompt_id:
            raise ProviderError(
                code="comfy_missing_prompt_id",
                message="ComfyUI did not return prompt_id",
                raw_error=submit_json,
            )

        history = await self._wait_history(
            base_url=base_url,
            prompt_id=prompt_id,
            timeout_sec=timeout_sec,
            poll_interval_sec=poll_interval_sec,
        )
        video_url = _extract_video_url(base_url=public_base_url, history=history)
        return {
            "mode": "comfyui",
            "provider_job_id": prompt_id,
            "video_url": video_url,
            "history": history,
        }

    async def _wait_history(
        self, base_url: str, prompt_id: str, timeout_sec: int, poll_interval_sec: float
    ) -> dict[str, Any]:
        deadline = asyncio.get_event_loop().time() + timeout_sec
        history_url = f"{base_url.rstrip('/')}/history/{prompt_id}"
        while asyncio.get_event_loop().time() < deadline:
            try:
                response = await self.http_client.get(history_url, timeout=20.0)
                response.raise_for_status()
                history_json = response.json()
            except Exception as error:
                raise ProviderError(
                    code="comfy_history_failed",
                    message="Failed to poll ComfyUI history",
                    raw_error=str(error),
                ) from error

            if history_json:
                if prompt_id in history_json:
                    return history_json[prompt_id]
                return history_json
            await asyncio.sleep(poll_interval_sec)

        raise ProviderError(
            code="comfy_timeout",
            message=f"ComfyUI task timed out after {timeout_sec} seconds",
            raw_error={"prompt_id": prompt_id},
        )


def _inject_prompt(
    workflow: dict[str, Any],
    prompt: str,
    negative_prompt: str | None,
    prompt_node_id: str,
    prompt_input_key: str,
) -> None:
    prompt_node = workflow.get(prompt_node_id)
    if not prompt_node:
        return
    inputs = prompt_node.setdefault("inputs", {})
    inputs[prompt_input_key] = prompt
    if negative_prompt:
        inputs["negative_prompt"] = negative_prompt


def _pick_endpoint(
    configured_base_url: str | None,
    override_base_url: Any,
    allow_override: bool,
) -> str | None:
    if allow_override and isinstance(override_base_url, str) and override_base_url.strip():
        return override_base_url.strip()
    return configured_base_url


def _pick_public_endpoint(
    call_base_url: str,
    configured_public_base_url: Any,
    override_public_base_url: Any,
    allow_override: bool,
) -> str:
    if (
        allow_override
        and isinstance(override_public_base_url, str)
        and override_public_base_url.strip()
    ):
        return override_public_base_url.strip()
    if isinstance(configured_public_base_url, str) and configured_public_base_url.strip():
        return configured_public_base_url.strip()
    return call_base_url


def _resolve_workflow(
    provider_options: dict[str, Any],
    provider_config: ProviderConfig,
    provider_config_path: Path,
) -> dict[str, Any] | None:
    request_workflow = _parse_workflow_json(provider_options.get("workflow"))
    if request_workflow is not None:
        return request_workflow

    default_workflow = _parse_workflow_json(provider_config.extra.get("default_workflow"))
    if default_workflow is not None:
        return default_workflow

    default_workflow_path = provider_config.extra.get("default_workflow_path")
    if not isinstance(default_workflow_path, str) or not default_workflow_path.strip():
        return None

    resolved_path = _resolve_default_workflow_path(
        configured_path=default_workflow_path.strip(),
        provider_config_path=provider_config_path,
    )

    try:
        raw_text = resolved_path.read_text(encoding="utf-8")
    except OSError as error:
        raise ProviderError(
            code="invalid_default_workflow",
            message=f"Failed to read default workflow file: {resolved_path}",
            raw_error=str(error),
        ) from error

    parsed_workflow = _parse_workflow_json(raw_text)
    if parsed_workflow is None:
        raise ProviderError(
            code="invalid_default_workflow",
            message=(
                "default_workflow_path must point to a valid JSON object "
                f"file: {resolved_path}"
            ),
        )
    return parsed_workflow


def _parse_workflow_json(raw_workflow: Any) -> dict[str, Any] | None:
    if isinstance(raw_workflow, dict):
        return deepcopy(raw_workflow)
    if not isinstance(raw_workflow, str) or not raw_workflow.strip():
        return None

    try:
        parsed = json.loads(raw_workflow)
    except json.JSONDecodeError:
        return None
    if isinstance(parsed, dict):
        return parsed
    return None


def _validate_workflow_format(workflow: dict[str, Any]) -> None:
    # ComfyUI "workflow" export (canvas graph with nodes/links) is not /prompt API format.
    # /prompt expects a node-id keyed prompt object.
    canvas_keys = {"nodes", "links", "groups", "last_node_id"}
    if canvas_keys.intersection(workflow.keys()):
        raise ProviderError(
            code="invalid_workflow_format",
            message=(
                "Workflow appears to be ComfyUI canvas format. "
                "Please export API format (Save as API Format) for /prompt."
            ),
            raw_error={"detected_keys": sorted(canvas_keys.intersection(workflow.keys()))},
        )


def _resolve_default_workflow_path(
    configured_path: str, provider_config_path: Path
) -> Path:
    raw_path = Path(configured_path)
    if raw_path.is_absolute():
        return raw_path

    config_relative = (provider_config_path.parent / raw_path).resolve()
    if config_relative.exists():
        return config_relative

    cwd_relative = (Path(os.getcwd()) / raw_path).resolve()
    return cwd_relative


def _coerce_positive_int(value: Any, fallback: int, field_name: str) -> int:
    if value is None:
        return fallback
    try:
        parsed = int(value)
    except (TypeError, ValueError) as error:
        raise ProviderError(
            code="invalid_provider_option",
            message=f"{field_name} must be a positive integer",
            raw_error={field_name: value},
        ) from error
    if parsed <= 0:
        raise ProviderError(
            code="invalid_provider_option",
            message=f"{field_name} must be a positive integer",
            raw_error={field_name: value},
        )
    return parsed


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


def _apply_video_request_settings(
    workflow: dict[str, Any],
    duration_sec: int,
    fps: int,
    resolution: str,
    provider_options: dict[str, Any],
    provider_config: ProviderConfig,
) -> None:
    auto_apply = _coerce_bool(
        _pick_option(
            provider_options=provider_options,
            provider_config=provider_config,
            option_name="auto_apply_video_params",
        ),
        fallback=True,
    )
    if not auto_apply:
        return

    width, height = _parse_resolution(resolution)

    latent_node_id = _pick_node_id_option(
        provider_options=provider_options,
        provider_config=provider_config,
        option_name="latent_node_id",
    )
    latent_node, latent_inputs, latent_node_key = _find_latent_node(
        workflow=workflow, preferred_node_id=latent_node_id
    )
    if latent_inputs is not None:
        if "width" in latent_inputs:
            latent_inputs["width"] = width
        if "height" in latent_inputs:
            latent_inputs["height"] = height
        length_input_key = _pick_first_existing_key(
            latent_inputs, ["length", "frames", "num_frames", "video_length"]
        )
        if length_input_key is not None:
            length_mode = _pick_length_mode(
                provider_options=provider_options,
                provider_config=provider_config,
                node_class_type=str(latent_node.get("class_type", "")) if latent_node else "",
            )
            frame_count = _compute_frame_count(
                duration_sec=duration_sec,
                fps=fps,
                length_mode=length_mode,
            )
            latent_inputs[length_input_key] = frame_count

    fps_node_id = _pick_node_id_option(
        provider_options=provider_options,
        provider_config=provider_config,
        option_name="fps_node_id",
    )
    fps_input_key = _pick_input_key_option(
        provider_options=provider_options,
        provider_config=provider_config,
        option_name="fps_input_key",
        default_value="fps",
    )
    fps_node, fps_inputs = _find_fps_node(
        workflow=workflow,
        preferred_node_id=fps_node_id,
        preferred_input_key=fps_input_key,
    )
    if fps_inputs is not None and fps_input_key in fps_inputs:
        fps_inputs[fps_input_key] = fps
    elif fps_inputs is not None and fps_node is not None:
        # Fallback: update detected fps-like key when custom key is absent.
        detected_key = _pick_first_existing_key(fps_inputs, ["fps", "frame_rate", "framerate"])
        if detected_key is not None:
            fps_inputs[detected_key] = fps

    # If latent node wasn't found by heuristics but caller set explicit id, raise explicit error.
    if latent_node_id and latent_node_key is None:
        raise ProviderError(
            code="invalid_provider_option",
            message=f"latent_node_id not found in workflow: {latent_node_id}",
            raw_error={"latent_node_id": latent_node_id},
        )


def _find_latent_node(
    workflow: dict[str, Any], preferred_node_id: str | None
) -> tuple[dict[str, Any] | None, dict[str, Any] | None, str | None]:
    if preferred_node_id:
        node = workflow.get(preferred_node_id)
        inputs = _get_node_inputs(node)
        return node, inputs, preferred_node_id if isinstance(node, dict) else None

    for node_id, node in workflow.items():
        inputs = _get_node_inputs(node)
        if inputs is None:
            continue
        if "width" in inputs and "height" in inputs:
            if _pick_first_existing_key(inputs, ["length", "frames", "num_frames", "video_length"]):
                return node, inputs, str(node_id)
    return None, None, None


def _find_fps_node(
    workflow: dict[str, Any],
    preferred_node_id: str | None,
    preferred_input_key: str,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    if preferred_node_id:
        node = workflow.get(preferred_node_id)
        return node if isinstance(node, dict) else None, _get_node_inputs(node)

    for node in workflow.values():
        inputs = _get_node_inputs(node)
        if inputs is None:
            continue
        if preferred_input_key in inputs:
            return node, inputs
    for node in workflow.values():
        inputs = _get_node_inputs(node)
        if inputs is None:
            continue
        if _pick_first_existing_key(inputs, ["fps", "frame_rate", "framerate"]):
            return node, inputs
    return None, None


def _get_node_inputs(node: Any) -> dict[str, Any] | None:
    if not isinstance(node, dict):
        return None
    inputs = node.get("inputs")
    if isinstance(inputs, dict):
        return inputs
    return None


def _pick_option(
    provider_options: dict[str, Any],
    provider_config: ProviderConfig,
    option_name: str,
) -> Any:
    if option_name in provider_options:
        return provider_options.get(option_name)
    return provider_config.extra.get(option_name)


def _pick_node_id_option(
    provider_options: dict[str, Any],
    provider_config: ProviderConfig,
    option_name: str,
) -> str | None:
    value = _pick_option(
        provider_options=provider_options,
        provider_config=provider_config,
        option_name=option_name,
    )
    if isinstance(value, str) and value.strip():
        return value.strip()
    if isinstance(value, int):
        return str(value)
    return None


def _pick_input_key_option(
    provider_options: dict[str, Any],
    provider_config: ProviderConfig,
    option_name: str,
    default_value: str,
) -> str:
    value = _pick_option(
        provider_options=provider_options,
        provider_config=provider_config,
        option_name=option_name,
    )
    if isinstance(value, str) and value.strip():
        return value.strip()
    return default_value


def _pick_first_existing_key(payload: dict[str, Any], keys: list[str]) -> str | None:
    for key in keys:
        if key in payload:
            return key
    return None


def _pick_length_mode(
    provider_options: dict[str, Any],
    provider_config: ProviderConfig,
    node_class_type: str,
) -> str:
    raw_mode = _pick_option(
        provider_options=provider_options,
        provider_config=provider_config,
        option_name="length_mode",
    )
    if isinstance(raw_mode, str) and raw_mode.strip():
        normalized = raw_mode.strip().lower()
        if normalized in {"duration_fps", "duration_fps_plus_one"}:
            return normalized
        raise ProviderError(
            code="invalid_provider_option",
            message="length_mode must be duration_fps or duration_fps_plus_one",
            raw_error={"length_mode": raw_mode},
        )
    if node_class_type.startswith("Wan22"):
        return "duration_fps_plus_one"
    return "duration_fps"


def _compute_frame_count(duration_sec: int, fps: int, length_mode: str) -> int:
    if length_mode == "duration_fps_plus_one":
        return max(1, duration_sec * fps + 1)
    return max(1, duration_sec * fps)


def _parse_resolution(raw_resolution: str) -> tuple[int, int]:
    match = re.fullmatch(r"\s*(\d+)\s*[xX]\s*(\d+)\s*", raw_resolution)
    if not match:
        raise ProviderError(
            code="invalid_resolution",
            message=f"Unsupported resolution format: {raw_resolution}",
            raw_error={"resolution": raw_resolution},
        )
    width = int(match.group(1))
    height = int(match.group(2))
    if width <= 0 or height <= 0:
        raise ProviderError(
            code="invalid_resolution",
            message=f"Resolution width/height must be positive: {raw_resolution}",
            raw_error={"resolution": raw_resolution},
        )
    return width, height


def _coerce_bool(value: Any, fallback: bool) -> bool:
    if value is None:
        return fallback
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            return True
        if normalized in {"0", "false", "no", "off"}:
            return False
    raise ProviderError(
        code="invalid_provider_option",
        message="Boolean option must be true/false",
        raw_error={"value": value},
    )


def _extract_video_url(base_url: str, history: dict[str, Any]) -> str | None:
    outputs = history.get("outputs")
    if not isinstance(outputs, dict):
        return None

    for node_data in outputs.values():
        if not isinstance(node_data, dict):
            continue
        for key in ("videos", "images", "gifs"):
            media_list = node_data.get(key)
            if not isinstance(media_list, list):
                continue
            for media in media_list:
                if not isinstance(media, dict):
                    continue
                filename = media.get("filename")
                file_type = media.get("type", "output")
                subfolder = media.get("subfolder", "")
                if not filename:
                    continue
                return (
                    f"{base_url.rstrip('/')}/view"
                    f"?filename={filename}&type={file_type}&subfolder={subfolder}"
                )
    return None


def _require_prompt(value: str | None) -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()
    raise ProviderError(code="invalid_prompt", message="prompt is required")
