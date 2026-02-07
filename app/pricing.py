from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(slots=True)
class PricingEntry:
    provider: str
    model: str
    quality: str | None
    resolution: str | None
    duration_sec: int | None
    fixed_cost: float | None
    cost_per_second: float | None
    currency: str
    effective_from: str | None


@dataclass(slots=True)
class PricingCatalog:
    mode: str
    currency: str
    pricing_version: str | None
    entries: list[PricingEntry]

    @classmethod
    def load(cls, path: Path) -> "PricingCatalog":
        if not path.exists():
            return cls(
                mode="local_config",
                currency="USD",
                pricing_version=None,
                entries=[],
            )
        with path.open("r", encoding="utf-8") as file:
            payload = json.load(file)
        entries = []
        for raw in payload.get("entries", []):
            entry = PricingEntry(
                provider=str(raw.get("provider", "")).strip(),
                model=str(raw.get("model", "")).strip(),
                quality=_norm_optional(raw.get("quality")),
                resolution=_norm_optional(raw.get("resolution")),
                duration_sec=_norm_int(raw.get("duration_sec")),
                fixed_cost=_norm_float(raw.get("fixed_cost")),
                cost_per_second=_norm_float(raw.get("cost_per_second")),
                currency=str(raw.get("currency", payload.get("currency", "USD"))).strip()
                or "USD",
                effective_from=_norm_optional(raw.get("effective_from")),
            )
            if not entry.provider or not entry.model:
                continue
            if entry.fixed_cost is None and entry.cost_per_second is None:
                continue
            entries.append(entry)
        mode = str(payload.get("mode", "local_config")).strip() or "local_config"
        currency = str(payload.get("currency", "USD")).strip() or "USD"
        pricing_version = _norm_optional(payload.get("pricing_version"))
        return cls(mode=mode, currency=currency, pricing_version=pricing_version, entries=entries)

    def estimate(
        self,
        *,
        provider: str,
        model: str,
        duration_sec: int | None,
        resolution: str | None,
        quality: str | None,
    ) -> tuple[float | None, str | None, str]:
        match = _best_match(
            entries=self.entries,
            provider=provider,
            model=model,
            duration_sec=duration_sec,
            resolution=resolution,
            quality=quality,
        )
        if not match:
            return None, self.currency, "unknown"
        if match.fixed_cost is not None:
            return round(match.fixed_cost, 6), match.currency, "local_config"
        if duration_sec is None or duration_sec <= 0 or match.cost_per_second is None:
            return None, match.currency, "local_config"
        return round(match.cost_per_second * duration_sec, 6), match.currency, "local_config"


def _best_match(
    *,
    entries: list[PricingEntry],
    provider: str,
    model: str,
    duration_sec: int | None,
    resolution: str | None,
    quality: str | None,
) -> PricingEntry | None:
    normalized_resolution = _norm_optional(resolution)
    normalized_quality = _norm_optional(quality)
    candidates: list[tuple[int, PricingEntry]] = []
    for entry in entries:
        if entry.provider != provider or entry.model != model:
            continue
        if entry.resolution is not None and entry.resolution != normalized_resolution:
            continue
        if entry.quality is not None and entry.quality != normalized_quality:
            continue
        if entry.duration_sec is not None and entry.duration_sec != duration_sec:
            continue
        specificity = 0
        specificity += 1 if entry.resolution is not None else 0
        specificity += 1 if entry.quality is not None else 0
        specificity += 1 if entry.duration_sec is not None else 0
        candidates.append((specificity, entry))
    if not candidates:
        return None
    candidates.sort(key=lambda item: item[0], reverse=True)
    return candidates[0][1]


def _norm_optional(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _norm_int(value: object) -> int | None:
    if value is None:
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def _norm_float(value: object) -> float | None:
    if value is None:
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 0 else None
