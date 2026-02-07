from __future__ import annotations

import pytest

from app.providers.base import ProviderError
from app.providers.tuzi_video import _build_create_character_form
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
