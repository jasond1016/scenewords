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
                    asset_type TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    model TEXT NOT NULL,
                    operation TEXT,
                    provider_job_id TEXT,
                    provider_status TEXT,
                    provider_query_endpoint TEXT,
                    prompt TEXT NOT NULL,
                    request_json TEXT NOT NULL,
                    result_json TEXT,
                    error_json TEXT,
                    estimated_cost REAL,
                    actual_cost REAL,
                    currency TEXT,
                    cost_source TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                """
            )
            self._connection.execute(
                """
                CREATE TABLE IF NOT EXISTS files (
                    file_id TEXT PRIMARY KEY,
                    original_name TEXT NOT NULL,
                    stored_name TEXT NOT NULL,
                    mime_type TEXT NOT NULL,
                    size_bytes INTEGER NOT NULL,
                    sha256 TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    last_used_at TEXT NOT NULL
                );
                """
            )
            _ensure_task_columns(self._connection)
            self._connection.commit()

    def create_task(
        self,
        task_id: str,
        provider: str,
        model: str,
        operation: str | None,
        prompt: str,
        request_payload: dict[str, Any],
        asset_type: str = "video",
        estimated_cost: float | None = None,
        currency: str | None = None,
        cost_source: str | None = None,
    ) -> dict[str, Any]:
        now_iso = _now_iso()
        with self._lock:
            self._connection.execute(
                """
                INSERT INTO tasks (
                    task_id, status, asset_type, provider, model, operation, prompt, request_json,
                    estimated_cost, currency, cost_source, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    task_id,
                    "queued",
                    asset_type,
                    provider,
                    model,
                    operation,
                    prompt,
                    json.dumps(request_payload, ensure_ascii=False),
                    estimated_cost,
                    currency,
                    cost_source,
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

    def set_provider_progress(
        self,
        task_id: str,
        *,
        provider_job_id: str | None = None,
        provider_status: str | None = None,
        provider_query_endpoint: str | None = None,
    ) -> None:
        updates: list[str] = []
        params: list[Any] = []
        if isinstance(provider_job_id, str) and provider_job_id.strip():
            updates.append("provider_job_id = ?")
            params.append(provider_job_id.strip())
        if isinstance(provider_status, str) and provider_status.strip():
            updates.append("provider_status = ?")
            params.append(provider_status.strip())
        if isinstance(provider_query_endpoint, str) and provider_query_endpoint.strip():
            updates.append("provider_query_endpoint = ?")
            params.append(provider_query_endpoint.strip())
        if not updates:
            return
        updates.append("updated_at = ?")
        params.append(_now_iso())
        params.append(task_id)
        sql = f"UPDATE tasks SET {', '.join(updates)} WHERE task_id = ?"
        with self._lock:
            self._connection.execute(sql, tuple(params))
            self._connection.commit()

    def set_canceled(self, task_id: str) -> None:
        with self._lock:
            self._connection.execute(
                """
                UPDATE tasks
                SET status = ?, provider_status = ?, error_json = NULL, updated_at = ?
                WHERE task_id = ?
                """,
                ("canceled", "canceled", _now_iso(), task_id),
            )
            self._connection.commit()

    def set_result(
        self,
        task_id: str,
        result: dict[str, Any],
        actual_cost: float | None = None,
        cost_source: str | None = None,
    ) -> None:
        with self._lock:
            self._connection.execute(
                """
                UPDATE tasks
                SET status = ?, result_json = ?, error_json = NULL, actual_cost = ?,
                    cost_source = COALESCE(?, cost_source), provider_status = ?, updated_at = ?
                WHERE task_id = ?
                """,
                (
                    "succeeded",
                    json.dumps(result, ensure_ascii=False),
                    actual_cost,
                    cost_source,
                    "succeeded",
                    _now_iso(),
                    task_id,
                ),
            )
            self._connection.commit()

    def set_error(self, task_id: str, code: str, message: str, raw_error: Any) -> None:
        error_payload = {"code": code, "message": message, "raw_error": raw_error}
        with self._lock:
            self._connection.execute(
                """
                UPDATE tasks
                SET status = ?, provider_status = ?, error_json = ?, updated_at = ?
                WHERE task_id = ?
                """,
                (
                    "failed",
                    "failed",
                    json.dumps(error_payload, ensure_ascii=False),
                    _now_iso(),
                    task_id,
                ),
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

    def delete_task(self, task_id: str) -> None:
        with self._lock:
            row = self._connection.execute(
                "SELECT task_id FROM tasks WHERE task_id = ?",
                (task_id,),
            ).fetchone()
            if row is None:
                raise KeyError(task_id)
            self._connection.execute(
                "DELETE FROM tasks WHERE task_id = ?",
                (task_id,),
            )
            self._connection.commit()

    def list_tasks(
        self,
        limit: int = 20,
        asset_type: str | None = None,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        safe_offset = max(offset, 0)
        with self._lock:
            if asset_type:
                rows = self._connection.execute(
                    """
                    SELECT * FROM tasks
                    WHERE COALESCE(asset_type, 'video') = ?
                    ORDER BY created_at DESC
                    LIMIT ?
                    OFFSET ?
                    """,
                    (asset_type, limit, safe_offset),
                ).fetchall()
            else:
                rows = self._connection.execute(
                    "SELECT * FROM tasks ORDER BY created_at DESC LIMIT ? OFFSET ?",
                    (limit, safe_offset),
                ).fetchall()
        return [_row_to_dict(row) for row in rows]

    def list_active_tasks(self, asset_type: str | None = None) -> list[dict[str, Any]]:
        with self._lock:
            if asset_type:
                rows = self._connection.execute(
                    """
                    SELECT * FROM tasks
                    WHERE status IN ('queued', 'running')
                      AND COALESCE(asset_type, 'video') = ?
                    ORDER BY created_at ASC
                    """,
                    (asset_type,),
                ).fetchall()
            else:
                rows = self._connection.execute(
                    """
                    SELECT * FROM tasks
                    WHERE status IN ('queued', 'running')
                    ORDER BY created_at ASC
                    """
                ).fetchall()
        return [_row_to_dict(row) for row in rows]

    def summarize_task_costs(self) -> dict[str, Any]:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT
                    COALESCE(
                        SUM(
                            CASE
                                WHEN status = 'succeeded' AND actual_cost IS NOT NULL
                                THEN actual_cost
                                ELSE 0
                            END
                        ),
                        0
                    ) AS charged_cost_total,
                    COALESCE(
                        SUM(
                            CASE
                                WHEN status = 'succeeded' AND actual_cost IS NOT NULL
                                THEN 1
                                ELSE 0
                            END
                        ),
                        0
                    ) AS charged_task_count,
                    COALESCE(
                        SUM(
                            CASE
                                WHEN status IN ('queued', 'running') AND estimated_cost IS NOT NULL
                                THEN estimated_cost
                                ELSE 0
                            END
                        ),
                        0
                    ) AS pending_estimated_cost_total,
                    COALESCE(
                        SUM(
                            CASE
                                WHEN status IN ('queued', 'running') AND estimated_cost IS NOT NULL
                                THEN 1
                                ELSE 0
                            END
                        ),
                        0
                    ) AS pending_estimated_task_count
                FROM tasks
                """
            ).fetchone()
        if row is None:
            return {
                "charged_cost_total": 0.0,
                "charged_task_count": 0,
                "pending_estimated_cost_total": 0.0,
                "pending_estimated_task_count": 0,
            }
        return {
            "charged_cost_total": _as_float(row["charged_cost_total"]) or 0.0,
            "charged_task_count": int(row["charged_task_count"] or 0),
            "pending_estimated_cost_total": _as_float(row["pending_estimated_cost_total"]) or 0.0,
            "pending_estimated_task_count": int(row["pending_estimated_task_count"] or 0),
        }

    def create_file(
        self,
        file_id: str,
        original_name: str,
        stored_name: str,
        mime_type: str,
        size_bytes: int,
        sha256: str,
    ) -> dict[str, Any]:
        now_iso = _now_iso()
        with self._lock:
            self._connection.execute(
                """
                INSERT INTO files (
                    file_id,
                    original_name,
                    stored_name,
                    mime_type,
                    size_bytes,
                    sha256,
                    created_at,
                    last_used_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    file_id,
                    original_name,
                    stored_name,
                    mime_type,
                    size_bytes,
                    sha256,
                    now_iso,
                    now_iso,
                ),
            )
            self._connection.commit()
        return self.get_file(file_id)

    def get_file(self, file_id: str) -> dict[str, Any]:
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM files WHERE file_id = ?", (file_id,)
            ).fetchone()
        if row is None:
            raise KeyError(file_id)
        return _file_row_to_dict(row)

    def touch_file(self, file_id: str) -> None:
        with self._lock:
            self._connection.execute(
                "UPDATE files SET last_used_at = ? WHERE file_id = ?",
                (_now_iso(), file_id),
            )
            self._connection.commit()


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    request_payload = json.loads(row["request_json"])
    result_payload = json.loads(row["result_json"]) if row["result_json"] else None
    error_payload = json.loads(row["error_json"]) if row["error_json"] else None
    return {
        "task_id": row["task_id"],
        "status": row["status"],
        "asset_type": row["asset_type"] if "asset_type" in row.keys() and row["asset_type"] else "video",
        "provider": row["provider"],
        "model": row["model"],
        "operation": row["operation"] if "operation" in row.keys() else None,
        "provider_job_id": row["provider_job_id"] if "provider_job_id" in row.keys() else None,
        "provider_status": row["provider_status"] if "provider_status" in row.keys() else None,
        "provider_query_endpoint": (
            row["provider_query_endpoint"] if "provider_query_endpoint" in row.keys() else None
        ),
        "prompt": row["prompt"],
        "request": request_payload,
        "result": result_payload,
        "error": error_payload,
        "estimated_cost": _as_float(row["estimated_cost"]) if "estimated_cost" in row.keys() else None,
        "actual_cost": _as_float(row["actual_cost"]) if "actual_cost" in row.keys() else None,
        "currency": row["currency"] if "currency" in row.keys() else None,
        "cost_source": row["cost_source"] if "cost_source" in row.keys() else None,
        "created_at": _parse_iso(row["created_at"]),
        "updated_at": _parse_iso(row["updated_at"]),
    }


def _file_row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "file_id": row["file_id"],
        "original_name": row["original_name"],
        "stored_name": row["stored_name"],
        "mime_type": row["mime_type"],
        "size_bytes": int(row["size_bytes"]),
        "sha256": row["sha256"],
        "created_at": _parse_iso(row["created_at"]),
        "last_used_at": _parse_iso(row["last_used_at"]),
    }


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


def _parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value)


def _as_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _ensure_task_columns(connection: sqlite3.Connection) -> None:
    existing = {
        row["name"]
        for row in connection.execute("PRAGMA table_info(tasks)").fetchall()
    }
    expected_columns: dict[str, str] = {
        "asset_type": "TEXT",
        "operation": "TEXT",
        "provider_job_id": "TEXT",
        "provider_status": "TEXT",
        "provider_query_endpoint": "TEXT",
        "estimated_cost": "REAL",
        "actual_cost": "REAL",
        "currency": "TEXT",
        "cost_source": "TEXT",
    }
    for column, definition in expected_columns.items():
        if column in existing:
            continue
        connection.execute(f"ALTER TABLE tasks ADD COLUMN {column} {definition}")
    connection.execute(
        "UPDATE tasks SET asset_type = 'video' WHERE asset_type IS NULL OR asset_type = ''"
    )
