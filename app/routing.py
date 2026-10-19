"""Conservative, price-ranked routing. A persisted plan never contains credentials."""
from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.capabilities import CapabilityValidationError, apply_operation_defaults_and_validate, build_model_operations
from app.config import ProviderConfig
from app.pricing import PricingCatalog
from app.providers.tuzi_image import _validate_official_image_options
from app.schemas import ProviderInfo, ProviderModelInfo, ProviderOperationOption, VideoGenerationRequest


class RouteModel(BaseModel):
    provider: str
    model: str
    kind: Literal["image", "video"]
    protocol: Literal["ratio", "official", "async", "frames", "components"]
    tiers: list[str]
    group: str
    priority: int


class RoutingConfig(BaseModel):
    version: str
    max_attempts: int = Field(ge=1, le=3)
    budget: dict[str, float]
    currency: str
    defaults: dict[str, str]
    ratio_sizes: dict[str, dict[str, str]]
    models: list[RouteModel]

    @classmethod
    def load(cls, path: Path) -> "RoutingConfig":
        return cls.model_validate(json.loads(path.read_text(encoding="utf-8")))

    def tier_for(self, request: VideoGenerationRequest, kind: str) -> str:
        if request.resolution_tier:
            return request.resolution_tier
        for tier, sizes in self.ratio_sizes.items():
            if request.resolution in sizes.values():
                return tier
        # Historical explicit pixel sizes must not be priced as the default tier.
        if kind == "image" and "x" in (request.resolution or ""):
            width, height = (int(v) for v in request.resolution.lower().split("x"))
            return "1k" if max(width, height) <= 2048 else "2k" if max(width, height) <= 3072 else "4k"
        return self.defaults[kind]

    def resolve(self, request: VideoGenerationRequest, kind: str,
                providers: dict[str, ProviderConfig], pricing: PricingCatalog) -> VideoGenerationRequest:
        tier = self.tier_for(request, kind)
        budget = min(self.budget[kind], request.routing_budget or self.budget[kind])
        if not math.isfinite(budget) or budget <= 0:
            raise CapabilityValidationError("Routing budget must be finite and positive")
        candidates: list[dict[str, Any]] = []
        excluded: list[dict[str, str]] = []
        prepared: dict[tuple[str, str], VideoGenerationRequest] = {}
        for rule in self.models:
            identity = {"provider": rule.provider, "model": rule.model}
            try:
                if rule.kind != kind or tier not in rule.tiers:
                    raise CapabilityValidationError("asset_type_or_resolution_tier")
                if request.seed is not None and request.model and (rule.model != request.model or rule.provider != request.provider):
                    raise CapabilityValidationError("same_seed_requires_original_model")
                config = providers.get(rule.provider)
                if not config or not config.enabled or not any(m.name == rule.model for m in config.models):
                    raise CapabilityValidationError("model_unavailable")
                if config.provider_type != ("tuzi_image" if kind == "image" else "tuzi_veo"):
                    raise CapabilityValidationError("unsupported_provider_protocol")
                candidate = self._prepare(request, rule, config, tier)
                cost, currency, _ = pricing.estimate(
                    provider=rule.provider, model=rule.model, operation=candidate.operation,
                    duration_sec=candidate.duration_sec, resolution=candidate.resolution,
                    quality=tier if rule.protocol == "official" else candidate.provider_options.get("quality"),
                )
                if cost is None or not math.isfinite(cost) or currency != self.currency:
                    raise CapabilityValidationError("price_unknown_or_currency_mismatch")
                cost = round(cost * int(candidate.provider_options.get("n", 1)), 6)
                if cost > budget:
                    raise CapabilityValidationError("over_budget")
                prepared[(rule.provider, rule.model)] = candidate
                candidates.append({**identity, "cost": cost, "group": rule.group,
                                   "protocol": rule.protocol, "priority": rule.priority, "resolution": candidate.resolution})
            except (ValueError, RuntimeError) as error:
                # Never include user values, provider bodies or credentials in diagnostics.
                reason = str(error).split(":", 1)[0]
                excluded.append({**identity, "reason": reason})
        candidates.sort(key=lambda c: (c["cost"], c["priority"], c["provider"], c["model"]))
        if not candidates:
            raise CapabilityValidationError("No priced model satisfies all requested capabilities and budget")
        first = candidates[0]
        result = prepared[(first["provider"], first["model"])]
        equivalent = [c for c in candidates if c["group"] == first["group"]
                      and c["protocol"] == first["protocol"]
                      and c["resolution"] == first["resolution"]]
        # Seeds identify a model's random process, never a portable cross-model promise.
        if request.seed is not None:
            equivalent = equivalent[:1]
        plan = []
        for candidate in equivalent[:self.max_attempts]:
            if sum(c["cost"] for c in plan) + candidate["cost"] <= budget + 1e-9:
                plan.append(candidate)
        result.provider_options["__routing"] = {
            "version": self.version, "goal": {"resolution_tier": tier, "resolution": request.resolution},
            "intent": request.model_dump(mode="json"),
            "candidates": candidates, "excluded": excluded, "plan": plan,
            "budget": budget, "currency": self.currency, "max_attempts": self.max_attempts,
            "fallback_disabled_reason": ("seed_model_specific" if request.seed is not None else
                "no_equivalent_candidate" if len(equivalent) == 1 else "budget_or_attempt_limit" if len(plan) == 1 else None),
            "attempts": [], "stop_reason": None,
        }
        return result

    def _prepare(self, source: VideoGenerationRequest, rule: RouteModel,
                 config: ProviderConfig, tier: str) -> VideoGenerationRequest:
        request = source.model_copy(deep=True)
        request.provider, request.model = rule.provider, rule.model
        request.resolution_tier = tier
        request.operation = request.operation or "generate"
        if request.negative_prompt is not None or request.fps is not None:
            raise CapabilityValidationError("unsupported_request_field")
        if rule.kind == "image" and (request.seed is not None or request.duration_sec is not None):
            raise CapabilityValidationError("unsupported_seed_or_duration")
        operations = build_model_operations(config, rule.model)
        operation = next((o for o in operations if o.id == request.operation), None)
        if not operation:
            raise CapabilityValidationError("unsupported_operation")
        allowed = {f.key for f in operation.fields if f.target == "provider_options"}
        # Transport/credential overrides cannot be reasoned about by smart routing.
        allowed -= {"api_key", "base_url", "headers", "extra_body"}
        if any(key not in allowed for key in request.provider_options):
            raise CapabilityValidationError("unsupported_provider_options")
        for field in operation.fields:
            if field.target != "provider_options" or field.key not in request.provider_options:
                continue
            value = request.provider_options[field.key]
            if field.input_type in {"file_list", "string_list"} and (
                not isinstance(value, list) or any(not isinstance(v, str) or not v.strip() for v in value)
            ):
                raise CapabilityValidationError("invalid_list_option")
            if field.input_type == "boolean" and not isinstance(value, bool):
                raise CapabilityValidationError("invalid_boolean_option")
        if rule.protocol in {"frames", "components"}:
            opts = request.provider_options
            has_components = bool(opts.get("input_reference_file_ids"))
            has_frames = bool(opts.get("start_frame_file_id") or opts.get("end_frame_file_id"))
            if has_components and has_frames:
                raise CapabilityValidationError("mixed_reference_modes")
            if (rule.protocol == "components") != has_components:
                raise CapabilityValidationError("reference_mode_mismatch")
            if opts.get("end_frame_file_id") and not opts.get("start_frame_file_id"):
                raise CapabilityValidationError("end_frame_requires_start_frame")
            if request.duration_sec not in {None, 8}:
                raise CapabilityValidationError("unsupported_duration")
        if rule.protocol == "official":
            request.resolution = self.ratio_sizes.get(tier, {}).get(request.resolution or "16:9", request.resolution)
            supported_sizes = {size for sizes in self.ratio_sizes.values() for size in sizes.values()}
            supported_sizes |= {o.value for f in operation.fields if f.key == "resolution" for o in f.options if o.value != "auto"}
            if request.resolution not in supported_sizes:
                raise CapabilityValidationError("unverified_pixel_size")
            if "x" in request.resolution:
                size_tier = self.tier_for(VideoGenerationRequest(resolution=request.resolution), "image")
                if size_tier != tier:
                    raise CapabilityValidationError("pixel_size_tier_mismatch")
            # The vetted config sizes above extend the legacy select list of examples.
            for field in operation.fields:
                if field.key == "resolution":
                    field.options = []
            _validate_official_image_options(request.provider_options)
        apply_operation_defaults_and_validate(request, [operation])
        return request

    def catalog(self, providers: dict[str, ProviderConfig]) -> list[ProviderInfo]:
        """Goal-only composer schema; legacy /models entries remain untouched."""
        result = []
        visible = {"prompt", "resolution", "duration_sec", "quality", "background", "n",
                   "output_format", "input_fidelity", "image_file_ids", "mask_file_id",
                   "start_frame_file_id", "end_frame_file_id", "input_reference_file_ids", "orientation_mode"}
        for kind in ("image", "video"):
            rules = [r for r in self.models if r.kind == kind and r.provider in providers
                     and providers[r.provider].enabled and any(m.name == r.model for m in providers[r.provider].models)]
            if not rules:
                continue
            models = []
            for tier in dict.fromkeys(t for r in rules for t in r.tiers):
                # Richest supported schema, not the selected execution model.
                rule = next((r for r in rules if tier in r.tiers and r.protocol == ("official" if kind == "image" else "frames")), None)
                if not rule:
                    continue
                operations = build_model_operations(providers[rule.provider], rule.model)
                for operation in operations:
                    operation.fields = [f for f in operation.fields if f.key in visible]
                    for field in operation.fields:
                        if kind == "image" and field.key == "resolution":
                            field.default = "16:9"
                            field.options = [ProviderOperationOption(value=r, label=r) for r in self.ratio_sizes[tier]]
                        if field.key in {"n", "output_format", "quality", "background"}:
                            field.required = False
                            field.default = None
                            if field.input_type == "select":
                                field.options.insert(0, ProviderOperationOption(value="", label="默认 / Default"))
                    if kind == "image" and operation.id == "generate" and not any(f.key == "image_file_ids" for f in operation.fields):
                        reference = next(f.model_copy(deep=True) for f in operations[1].fields if f.key == "image_file_ids")
                        reference.required = False
                        operation.fields.append(reference)
                models.append(ProviderModelInfo(name=f"auto-{kind}-{tier}", display_name=f"智能创作 {tier.upper()}",
                    is_default=tier == self.defaults[kind], routing_goal={"resolution_tier": tier}, operations=operations))
            result.append(ProviderInfo(id=f"auto-{kind}", display_name="智能创作", type="tuzi_image" if kind == "image" else "tuzi_veo",
                                       supports_custom_endpoint=False, models=models))
        return result
