from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import app.worker as worker_module

from app.config import AppConfig, load_app_config
from app.db import TaskStore


@dataclass(slots=True)
class PosterBackfillStats:
    scanned: int = 0
    updated: int = 0
    skipped_existing: int = 0
    skipped_missing_video: int = 0
    failed: int = 0


async def backfill_local_video_posters(
    *,
    store: TaskStore,
    output_dir: Path,
) -> PosterBackfillStats:
    stats = PosterBackfillStats()
    for task in store.list_succeeded_tasks(asset_type="video"):
        stats.scanned += 1
        task_id = str(task["task_id"])
        result = task.get("result")
        if not isinstance(result, dict):
            stats.skipped_missing_video += 1
            continue

        if _has_existing_local_poster(task_id=task_id, result=result, output_dir=output_dir):
            stats.skipped_existing += 1
            continue

        video_path = _resolve_local_video_path(task_id=task_id, result=result, output_dir=output_dir)
        if video_path is None:
            stats.skipped_missing_video += 1
            continue

        poster_path = await worker_module._create_local_video_poster(video_path)
        if poster_path is None:
            stats.failed += 1
            continue

        updated_result = dict(result)
        updated_result["local_poster_url"] = f"/v1/assets/{task_id}/{poster_path.name}"
        store.update_result_payload(task_id, updated_result)
        stats.updated += 1
    return stats


async def run_backfill(app_config: AppConfig | None = None) -> PosterBackfillStats:
    resolved_config = app_config or load_app_config()
    store = TaskStore(resolved_config.db_path)
    return await backfill_local_video_posters(
        store=store,
        output_dir=resolved_config.output_dir,
    )


def _has_existing_local_poster(
    *,
    task_id: str,
    result: dict[str, Any],
    output_dir: Path,
) -> bool:
    local_poster_url = result.get("local_poster_url")
    if not isinstance(local_poster_url, str) or not local_poster_url.strip():
        return False
    poster_path = _resolve_task_asset_path(
        task_id=task_id,
        asset_url=local_poster_url,
        output_dir=output_dir,
    )
    return poster_path is not None and poster_path.exists() and poster_path.is_file()


def _resolve_local_video_path(
    *,
    task_id: str,
    result: dict[str, Any],
    output_dir: Path,
) -> Path | None:
    local_video_url = result.get("local_video_url")
    if isinstance(local_video_url, str) and local_video_url.strip():
        resolved = _resolve_task_asset_path(
            task_id=task_id,
            asset_url=local_video_url,
            output_dir=output_dir,
        )
        if resolved is not None and resolved.exists() and resolved.is_file():
            return resolved

    archive_dir = output_dir / "assets" / task_id
    if not archive_dir.exists() or not archive_dir.is_dir():
        return None

    for pattern in ("video_*.mp4", "video_*.webm", "video_*.mov", "video_*.mpeg"):
        matches = sorted(archive_dir.glob(pattern))
        if matches:
            return matches[0]
    return None


def _resolve_task_asset_path(
    *,
    task_id: str,
    asset_url: str,
    output_dir: Path,
) -> Path | None:
    prefix = f"/v1/assets/{task_id}/"
    if not asset_url.startswith(prefix):
        return None
    filename = asset_url[len(prefix) :].strip()
    if not filename:
        return None
    return output_dir / "assets" / task_id / filename


def _format_stats(stats: PosterBackfillStats) -> str:
    return (
        f"scanned={stats.scanned} "
        f"updated={stats.updated} "
        f"skipped_existing={stats.skipped_existing} "
        f"skipped_missing_video={stats.skipped_missing_video} "
        f"failed={stats.failed}"
    )


def main() -> int:
    stats = asyncio.run(run_backfill())
    print(f"Poster backfill complete: {_format_stats(stats)}")
    return 0 if stats.failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
