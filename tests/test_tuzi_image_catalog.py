from pathlib import Path

import pytest

from app.capabilities import apply_operation_defaults_and_validate, build_model_operations
from app.config import load_provider_configs
from app.pricing import PricingCatalog
from app.providers.tuzi_image import _build_generate_payload
from app.schemas import VideoGenerationRequest


ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize("model, costs", [
    ("gpt-image-2.5", [0.0196, 0.084, 0.147]),
    ("gpt-image-2.5-vip", [0.049, 0.126, 0.196]),
])
def test_tiered_models_submit_resolution_tier_and_estimate_matching_price(model, costs):
    provider = load_provider_configs(ROOT / "config/providers.json")["nano_banana2"]
    assert model in {item.name for item in provider.models}
    operations = build_model_operations(provider, model)
    assert [operation.id for operation in operations] == ["generate"]
    assert any(field.key == "image_file_ids" for field in operations[0].fields)
    resolution_tier_field = next(
        field for field in operations[0].fields if field.key == "resolution_tier"
    )
    assert [option.value for option in resolution_tier_field.options] == ["1k", "2k", "4k"]
    catalog = PricingCatalog.load(ROOT / "config/pricing.json")
    for quality, expected_cost in zip([None, "2k", "4k"], costs):
        request = VideoGenerationRequest(
            provider=provider.provider_id, model=model, prompt="test",
            provider_options={} if quality is None else {"resolution_tier": quality},
        )
        apply_operation_defaults_and_validate(request, operations)
        payload = _build_generate_payload(request)
        assert payload["model"] == model
        expected_sizes = {None: "1360x768", "2k": "2736x1536", "4k": "3840x2160"}
        assert payload["size"] == expected_sizes[quality]
        assert "resolution" not in payload
        assert payload["quality"] == (quality or "1k").upper()
        cost, currency, source = catalog.estimate(
            provider=request.provider, model=model, operation=request.operation,
            duration_sec=None, resolution=request.resolution,
            quality=request.provider_options["resolution_tier"],
        )
        assert cost == pytest.approx(expected_cost)
        assert (currency, source) == ("RMB", "local_config")


def test_tiered_model_legacy_quality_value_maps_to_resolution() -> None:
    request = VideoGenerationRequest(
        provider="nano_banana2",
        model="gpt-image-2.5",
        operation="generate",
        prompt="test",
        resolution="16:9",
        provider_options={"quality": "4k"},
    )

    payload = _build_generate_payload(request)

    assert payload["size"] == "3840x2160"
    assert "resolution" not in payload
    assert payload["quality"] == "4K"
