from __future__ import annotations

from pathlib import Path

import pytest

from app.providers.base import ProviderError
from app.providers.tuzi_image import (
    _build_edit_form,
    _build_generate_payload,
    _extract_images,
    _normalize_operation,
)
from app.schemas import VideoGenerationRequest


def test_build_generate_payload_maps_ratio_quality_and_references() -> None:
    request = VideoGenerationRequest(
        provider="tuzi_image_demo",
        model="gemini-3-pro-image-preview",
        operation="generate",
        prompt="test prompt",
        resolution="16:9",
        provider_options={
            "quality": "2k",
            "response_format": "url",
            "image": ["https://example.com/a.png", "https://example.com/b.png"],
        },
    )

    payload = _build_generate_payload(request=request)

    assert payload["model"] == "gemini-3-pro-image-preview"
    assert payload["prompt"] == "test prompt"
    assert payload["size"] == "16x9"
    assert payload["quality"] == "2k"
    assert payload["response_format"] == "url"
    assert payload["image"] == ["https://example.com/a.png", "https://example.com/b.png"]


def test_build_generate_payload_infers_quality_from_model_when_missing() -> None:
    request = VideoGenerationRequest(
        provider="tuzi_image_demo",
        model="gemini-3-pro-image-preview-4k",
        operation="generate",
        prompt="test prompt",
        resolution="16:9",
        provider_options={"response_format": "url"},
    )

    payload = _build_generate_payload(request=request)

    assert payload["quality"] == "4k"


def test_build_edit_form_accepts_uploaded_image_and_optional_mask(tmp_path: Path) -> None:
    source = tmp_path / "source.png"
    source.write_bytes(b"fake-image")
    mask = tmp_path / "mask.png"
    mask.write_bytes(b"fake-mask")

    request = VideoGenerationRequest(
        provider="tuzi_image_demo",
        model="gemini-3-pro-image-preview",
        operation="edit",
        prompt="edit prompt",
        resolution="1:1",
        provider_options={
            "__resolved_image_file_ids": [
                {
                    "path": str(source),
                    "original_name": "source.png",
                    "mime_type": "image/png",
                }
            ],
            "__resolved_mask_file_id": [
                {
                    "path": str(mask),
                    "original_name": "mask.png",
                    "mime_type": "image/png",
                }
            ],
        },
    )

    form = _build_edit_form(request=request)
    assert ("model", (None, "gemini-3-pro-image-preview")) in form
    assert ("prompt", (None, "edit prompt")) in form
    assert ("size", (None, "1x1")) in form
    assert any(part[0] == "image" for part in form)
    assert any(part[0] == "mask" for part in form)


def test_build_edit_form_requires_source_image() -> None:
    request = VideoGenerationRequest(
        provider="tuzi_image_demo",
        model="gemini-3-pro-image-preview",
        operation="edit",
        prompt="edit prompt",
        provider_options={},
    )
    with pytest.raises(ProviderError, match="__resolved_image_file_ids is required"):
        _build_edit_form(request=request)


def test_extract_images_handles_nested_payload() -> None:
    payload = {
        "data": [
            {"url": "https://example.com/a.png"},
            {"b64_json": "ZmFrZQ=="},
            {"output": {"images": [{"url": "https://example.com/a.png"}, {"url": "https://example.com/b.png"}]}},
        ]
    }
    images = _extract_images(payload)
    assert {"url": "https://example.com/a.png"} in images
    assert {"url": "https://example.com/b.png"} in images
    assert {"b64_json": "ZmFrZQ=="} in images


def test_async_model_maps_generate_operation_to_generate_async() -> None:
    request = VideoGenerationRequest(
        provider="tuzi_image_demo",
        model="gemini-3-pro-image-preview-2k-async",
        operation="generate",
        prompt="test prompt",
        provider_options={},
    )
    assert _normalize_operation(request) == "generate_async"
