from __future__ import annotations

import asyncio
from typing import Any
from uuid import uuid4

from app.config import ProviderConfig
from app.providers.base import Provider, ProviderError
from app.schemas import VideoGenerationRequest


class ComfyUIProvider(Provider):
    async def generate(
        self, provider_config: ProviderConfig, request: VideoGenerationRequest
    ) -> dict[str, Any]:
        workflow = request.provider_options.get("workflow")
        if not workflow:
            await asyncio.sleep(2.0)
            return {
                "mode": "simulation",
                "message": "No workflow provided in provider_options.workflow, task simulated.",
                "video_url": None,
            }

        prompt_node_id = str(request.provider_options.get("prompt_node_id", "6"))
        prompt_input_key = str(request.provider_options.get("prompt_input_key", "text"))
        timeout_sec = int(request.provider_options.get("timeout_sec", 600))
        poll_interval_sec = float(request.provider_options.get("poll_interval_sec", 2.0))

        _inject_prompt(
            workflow=workflow,
            prompt=request.prompt,
            negative_prompt=request.negative_prompt,
            prompt_node_id=prompt_node_id,
            prompt_input_key=prompt_input_key,
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
            raise ProviderError(
                code="comfy_submit_failed",
                message="Failed to submit workflow to ComfyUI",
                raw_error=str(error),
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
        video_url = _extract_video_url(base_url=base_url, history=history)
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
