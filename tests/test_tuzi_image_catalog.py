from pathlib import Path

import pytest

from app.capabilities import build_model_operations
from app.config import load_provider_configs


ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize("model", [
    "gpt-image-2.5",
    "gpt-image-2.5-vip",
    "gpt-image-2.5-flare",
    "gpt-image-2.5-sunburst",
])
def test_official_gpt_image_25_catalog_exposes_all_output_parameters(model: str) -> None:
    provider = load_provider_configs(ROOT / "config/providers.json")["nano_banana2"]
    operations = build_model_operations(provider, model)

    assert [operation.id for operation in operations] == ["generate", "edit"]
    generate_fields = {field.key: field for field in operations[0].fields}
    edit_fields = {field.key: field for field in operations[1].fields}
    assert set(generate_fields) >= {
        "prompt", "resolution", "quality", "background", "output_format",
        "output_compression", "moderation", "n", "user",
    }
    assert "response_format" not in generate_fields
    assert set(edit_fields) >= set(generate_fields) | {
        "image_file_ids", "mask_file_id", "input_fidelity",
    }
    assert [option.value for option in generate_fields["quality"].options] == [
        "auto", "low", "medium", "high", "xhigh", "max",
    ]
    assert [option.value for option in generate_fields["background"].options] == [
        "auto", "opaque", "transparent",
    ]
