from __future__ import annotations

import io

import pytest
from PIL import Image

from app.providers.base import ProviderError
from app.providers.tuzi_video import (
    _SubmitRequest,
    _build_create_character_form,
    _build_generation_form,
    _should_retry_upload_failure,
)
from app.schemas import VideoGenerationRequest


def _build_request(provider_options: dict[str, object]) -> VideoGenerationRequest:
    return VideoGenerationRequest(
        provider="sora2",
        model="sora-2",
        operation="create_character",
        provider_options=provider_options,
    )


def test_build_create_character_form_supports_sora2_pro_character() -> None:
    request = _build_request(
        {
            "character_from_task": "1234567890",
            "character_model": "sora-2-pro-character",
        }
    )

    form = _build_create_character_form(request)
    assert ("model", (None, "sora-2-pro-character")) in form


def test_build_create_character_form_rejects_invalid_character_model() -> None:
    request = _build_request(
        {
            "character_from_task": "1234567890",
            "character_model": "not-supported",
        }
    )

    with pytest.raises(ProviderError, match="character_model must be one of"):
        _build_create_character_form(request)


def test_build_generation_form_normalizes_start_frame_to_target_resolution(tmp_path) -> None:
    source_path = tmp_path / "source.jpg"
    Image.new("RGB", (4032, 3024), color=(120, 90, 60)).save(source_path, format="JPEG", quality=95)
    request = VideoGenerationRequest(
        provider="veo31",
        model="veo3.1",
        operation="generate",
        prompt="test",
        duration_sec=8,
        resolution="1280x720",
        provider_options={
            "__resolved_start_frame_file_id": [
                {
                    "file_id": "file_1",
                    "path": str(source_path),
                    "original_name": "source.jpg",
                    "mime_type": "image/jpeg",
                    "size_bytes": source_path.stat().st_size,
                }
            ]
        },
    )

    normal_form, normal_meta = _build_generation_form(request, "generate", upload_profile="normal")
    aggressive_form, aggressive_meta = _build_generation_form(request, "generate", upload_profile="aggressive")

    normal_part = next(part for part in normal_form if part[0] == "input_reference" and isinstance(part[1], tuple))
    aggressive_part = next(part for part in aggressive_form if part[0] == "input_reference" and isinstance(part[1], tuple))
    normal_bytes = normal_part[1][1]
    aggressive_bytes = aggressive_part[1][1]

    with Image.open(io.BytesIO(normal_bytes)) as image:
        assert image.size == (1280, 720)
    with Image.open(io.BytesIO(aggressive_bytes)) as image:
        assert image.size == (1280, 720)

    assert len(normal_meta) == 1
    assert len(aggressive_meta) == 1
    assert normal_meta[0]["output_bytes"] <= 3_000_000
    assert aggressive_meta[0]["output_bytes"] <= normal_meta[0]["output_bytes"]


def test_build_generation_form_preserves_full_portrait_content_with_padding(tmp_path) -> None:
    source_path = tmp_path / "portrait.png"
    image = Image.new("RGB", (600, 900), color=(128, 128, 128))
    # Strong top/bottom color bands let us verify content survives processing.
    for y in range(80):
        for x in range(600):
            image.putpixel((x, y), (255, 0, 0))
            image.putpixel((x, 899 - y), (0, 0, 255))
    image.save(source_path, format="PNG")

    request = VideoGenerationRequest(
        provider="veo31",
        model="veo3.1",
        operation="generate",
        prompt="test",
        duration_sec=8,
        resolution="1280x720",
        provider_options={
            "__resolved_start_frame_file_id": [
                {
                    "file_id": "file_1",
                    "path": str(source_path),
                    "original_name": "portrait.png",
                    "mime_type": "image/png",
                    "size_bytes": source_path.stat().st_size,
                }
            ]
        },
    )

    form, meta = _build_generation_form(request, "generate", upload_profile="normal")
    part = next(part for part in form if part[0] == "input_reference" and isinstance(part[1], tuple))
    processed_bytes = part[1][1]

    with Image.open(io.BytesIO(processed_bytes)) as processed:
        assert processed.size == (1280, 720)
        top = processed.getpixel((640, 30))
        bottom = processed.getpixel((640, 690))

    assert top[0] > 180 and top[1] < 80 and top[2] < 80
    assert bottom[2] > 180 and bottom[0] < 80 and bottom[1] < 80
    assert len(meta) == 1
    assert meta[0]["cropped"] is False
    assert meta[0]["padded"] is True


def test_should_retry_upload_failure_only_once_for_normal_profile() -> None:
    error = ProviderError(
        code="provider_job_failed",
        message="failed",
        raw_error={"error": {"message": "Reason: PUBLIC_ERROR_MINOR_UPLOAD"}},
    )
    normal_submit = _SubmitRequest(
        endpoint="https://example.com",
        timeout_sec=120.0,
        files=[("input_reference", ("a.jpg", b"abc", "image/jpeg"))],
        upload_profile="normal",
    )
    aggressive_submit = _SubmitRequest(
        endpoint="https://example.com",
        timeout_sec=120.0,
        files=[("input_reference", ("a.jpg", b"abc", "image/jpeg"))],
        upload_profile="aggressive",
    )

    assert _should_retry_upload_failure(error=error, submit_request=normal_submit) is True
    assert _should_retry_upload_failure(error=error, submit_request=aggressive_submit) is False
