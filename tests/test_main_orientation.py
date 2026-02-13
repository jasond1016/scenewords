from __future__ import annotations

from pathlib import Path

from PIL import Image

import app.main as app_main
from app.schemas import VideoGenerationRequest


def _write_image(path: Path, size: tuple[int, int]) -> None:
    Image.new("RGB", size, color=(120, 120, 120)).save(path, format="JPEG", quality=90)


def test_apply_orientation_mode_auto_uses_start_frame_reference(tmp_path: Path) -> None:
    portrait = tmp_path / "portrait.jpg"
    _write_image(portrait, (900, 1200))
    request = VideoGenerationRequest(
        provider="veo31",
        model="veo3.1",
        prompt="test",
        resolution="1280x720",
        provider_options={
            "orientation_mode": "auto",
            "__resolved_start_frame_file_id": [{"path": str(portrait)}],
        },
    )

    app_main._apply_orientation_mode_to_resolution(request)

    assert request.resolution == "720x1280"


def test_apply_orientation_mode_auto_uses_reference_file_list(tmp_path: Path) -> None:
    landscape = tmp_path / "landscape.jpg"
    _write_image(landscape, (1200, 700))
    request = VideoGenerationRequest(
        provider="veo31",
        model="veo3.1",
        prompt="test",
        resolution="720x1280",
        provider_options={
            "orientation_mode": "auto",
            "__resolved_input_reference_file_ids": [{"path": str(landscape)}],
        },
    )

    app_main._apply_orientation_mode_to_resolution(request)

    assert request.resolution == "1280x720"


def test_apply_orientation_mode_explicit_landscape_swaps_resolution() -> None:
    request = VideoGenerationRequest(
        provider="veo31",
        model="veo3.1",
        prompt="test",
        resolution="720x1280",
        provider_options={
            "orientation_mode": "landscape",
        },
    )

    app_main._apply_orientation_mode_to_resolution(request)

    assert request.resolution == "1280x720"


def test_apply_orientation_mode_auto_keeps_resolution_when_no_reference() -> None:
    request = VideoGenerationRequest(
        provider="veo31",
        model="veo3.1",
        prompt="test",
        resolution="1280x720",
        provider_options={
            "orientation_mode": "auto",
        },
    )

    app_main._apply_orientation_mode_to_resolution(request)

    assert request.resolution == "1280x720"
