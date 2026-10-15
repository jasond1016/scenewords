from __future__ import annotations

import pytest

from app.capabilities import CapabilityValidationError, apply_operation_defaults_and_validate
from app.schemas import (
    ProviderModelOperationInfo,
    ProviderOperationField,
    ProviderOperationOption,
    VideoGenerationRequest,
)


def _operation_with_resolution_options() -> ProviderModelOperationInfo:
    return ProviderModelOperationInfo(
        id="generate",
        display_name="Generate",
        is_default=True,
        fields=[
            ProviderOperationField(
                key="resolution",
                label="Resolution",
                input_type="select",
                required=True,
                default="16:9",
                options=[
                    ProviderOperationOption(value="16:9", label="16:9"),
                    ProviderOperationOption(value="9:16", label="9:16"),
                ],
            )
        ],
    )


def test_operation_validation_rejects_value_outside_select_options() -> None:
    request = VideoGenerationRequest(
        provider="demo",
        model="image-model",
        prompt="test",
        resolution="1280x720",
    )

    with pytest.raises(CapabilityValidationError, match="Unsupported value for resolution"):
        apply_operation_defaults_and_validate(request, [_operation_with_resolution_options()])


def test_operation_validation_applies_valid_select_default() -> None:
    request = VideoGenerationRequest(
        provider="demo",
        model="image-model",
        prompt="test",
    )

    apply_operation_defaults_and_validate(request, [_operation_with_resolution_options()])

    assert request.resolution == "16:9"


@pytest.mark.parametrize("value", [float("nan"), float("inf"), True, "no", 0, 11, 1.5, 1e308])
def test_number_constraints_reject_invalid_values(value) -> None:
    request = VideoGenerationRequest(provider="demo", model="model", prompt="test",
                                     provider_options={"count": value})
    operation = ProviderModelOperationInfo(id="generate", display_name="Generate", fields=[
        ProviderOperationField(key="count", label="Count", target="provider_options",
                               input_type="number", min=1, max=10, step=1),
    ])
    with pytest.raises(CapabilityValidationError):
        apply_operation_defaults_and_validate(request, [operation])


def test_fractional_step_preserves_numeric_string_history() -> None:
    request = VideoGenerationRequest(provider="demo", model="model", prompt="test",
                                     provider_options={"interval": "0.6"})
    operation = ProviderModelOperationInfo(id="generate", display_name="Generate", fields=[
        ProviderOperationField(key="interval", label="Interval", target="provider_options",
                               input_type="number", min=0.2, step=0.2),
    ])
    apply_operation_defaults_and_validate(request, [operation])
    assert request.provider_options["interval"] == "0.6"
