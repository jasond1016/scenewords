from __future__ import annotations

import asyncio
from pathlib import Path
from uuid import uuid4

import app.poster_backfill as poster_backfill

from app.db import TaskStore


def _seed_succeeded_video_task(
    *,
    store: TaskStore,
    result: dict[str, object],
) -> str:
    task_id = str(uuid4())
    store.create_task(
        task_id=task_id,
        provider="demo_provider",
        model="demo-model",
        operation="generate",
        prompt="test prompt",
        request_payload={
            "provider": "demo_provider",
            "model": "demo-model",
            "operation": "generate",
            "prompt": "test prompt",
            "provider_options": {},
        },
        asset_type="video",
    )
    store.set_result(task_id, result)
    return task_id


def test_backfills_local_poster_url_from_local_video(tmp_path: Path, monkeypatch) -> None:
    async def _fake_create_local_video_poster(video_path: Path) -> Path | None:
        poster_path = video_path.with_name("poster_1.jpg")
        poster_path.write_bytes(b"poster")
        return poster_path

    monkeypatch.setattr(
        poster_backfill.worker_module,
        "_create_local_video_poster",
        _fake_create_local_video_poster,
    )

    store = TaskStore(tmp_path / "tasks.db")
    task_id = _seed_succeeded_video_task(
        store=store,
        result={"local_video_url": ""},
    )
    archive_dir = tmp_path / "outputs" / "assets" / task_id
    archive_dir.mkdir(parents=True)
    (archive_dir / "video_1.mp4").write_bytes(b"video")

    stats = asyncio.run(
        poster_backfill.backfill_local_video_posters(
            store=store,
            output_dir=tmp_path / "outputs",
        )
    )

    updated_task = store.get_task(task_id)
    assert stats.scanned == 1
    assert stats.updated == 1
    assert stats.failed == 0
    assert updated_task["result"]["local_poster_url"] == f"/v1/assets/{task_id}/poster_1.jpg"
    assert (archive_dir / "poster_1.jpg").exists()


def test_skips_task_when_existing_poster_is_present(tmp_path: Path, monkeypatch) -> None:
    async def _unexpected_create_local_video_poster(video_path: Path) -> Path | None:
        raise AssertionError(f"should not regenerate poster for {video_path}")

    monkeypatch.setattr(
        poster_backfill.worker_module,
        "_create_local_video_poster",
        _unexpected_create_local_video_poster,
    )

    store = TaskStore(tmp_path / "tasks.db")
    task_id = _seed_succeeded_video_task(
        store=store,
        result={
            "local_video_url": f"/v1/assets/{uuid4()}/video_1.mp4",
            "local_poster_url": "",
        },
    )
    archive_dir = tmp_path / "outputs" / "assets" / task_id
    archive_dir.mkdir(parents=True)
    (archive_dir / "video_1.mp4").write_bytes(b"video")
    (archive_dir / "poster_1.jpg").write_bytes(b"poster")
    store.update_result_payload(
        task_id,
        {
            "local_video_url": f"/v1/assets/{task_id}/video_1.mp4",
            "local_poster_url": f"/v1/assets/{task_id}/poster_1.jpg",
        },
    )

    stats = asyncio.run(
        poster_backfill.backfill_local_video_posters(
            store=store,
            output_dir=tmp_path / "outputs",
        )
    )

    updated_task = store.get_task(task_id)
    assert stats.scanned == 1
    assert stats.updated == 0
    assert stats.skipped_existing == 1
    assert updated_task["result"]["local_poster_url"] == f"/v1/assets/{task_id}/poster_1.jpg"
