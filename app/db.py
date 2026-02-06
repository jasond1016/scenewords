from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class TaskStore:
    def __init__(self, db_path: Path) -> None:
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._connection = sqlite3.connect(str(db_path), check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        self._init_schema()

    def _init_schema(self) -> None:
        with self._lock:
            self._connection.execute(
                """
                CREATE TABLE IF NOT EXISTS tasks (
                    task_id TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    model TEXT NOT NULL,
                    prompt TEXT NOT NULL,
                    request_json TEXT NOT NULL,
                    result_json TEXT,
                    error_json TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                """
            )
            self._connection.commit()

    def create_task(
        self, task_id: str, provider: str, model: str, prompt: str, request_payload: dict[str, Any]
    ) -> dict[str, Any]:
        now_iso = _now_iso()
        with self._lock:
            self._connection.execute(
                """
                INSERT INTO tasks (
                    task_id, status, provider, model, prompt, request_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    task_id,
                    "queued",
                    provider,
                    model,
                    prompt,
                    json.dumps(request_payload, ensure_ascii=False),
                    now_iso,
                    now_iso,
                ),
            )
            self._connection.commit()
        return self.get_task(task_id)

    def set_status(self, task_id: str, status: str) -> None:
        with self._lock:
            self._connection.execute(
                "UPDATE tasks SET status = ?, updated_at = ? WHERE task_id = ?",
                (status, _now_iso(), task_id),
            )
            self._connection.commit()

    def set_result(self, task_id: str, result: dict[str, Any]) -> None:
        with self._lock:
            self._connection.execute(
                """
                UPDATE tasks
                SET status = ?, result_json = ?, error_json = NULL, updated_at = ?
                WHERE task_id = ?
                """,
                ("succeeded", json.dumps(result, ensure_ascii=False), _now_iso(), task_id),
            )
            self._connection.commit()

    def set_error(self, task_id: str, code: str, message: str, raw_error: Any) -> None:
        error_payload = {"code": code, "message": message, "raw_error": raw_error}
        with self._lock:
            self._connection.execute(
                """
                UPDATE tasks
                SET status = ?, error_json = ?, updated_at = ?
                WHERE task_id = ?
                """,
                ("failed", json.dumps(error_payload, ensure_ascii=False), _now_iso(), task_id),
            )
            self._connection.commit()

    def get_task(self, task_id: str) -> dict[str, Any]:
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM tasks WHERE task_id = ?", (task_id,)
            ).fetchone()
        if row is None:
            raise KeyError(task_id)
        return _row_to_dict(row)

    def list_tasks(self, limit: int = 20) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._connection.execute(
                "SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
        return [_row_to_dict(row) for row in rows]


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    request_payload = json.loads(row["request_json"])
    result_payload = json.loads(row["result_json"]) if row["result_json"] else None
    error_payload = json.loads(row["error_json"]) if row["error_json"] else None
    return {
        "task_id": row["task_id"],
        "status": row["status"],
        "provider": row["provider"],
        "model": row["model"],
        "prompt": row["prompt"],
        "request": request_payload,
        "result": result_payload,
        "error": error_payload,
        "created_at": _parse_iso(row["created_at"]),
        "updated_at": _parse_iso(row["updated_at"]),
    }


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def _parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value)
