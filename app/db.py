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
            self._connection.execute(
                """
                CREATE TABLE IF NOT EXISTS subjects (
                    subject_id TEXT PRIMARY KEY,
                    kind TEXT NOT NULL,
                    name TEXT NOT NULL,
                    description TEXT NOT NULL,
                    fixed_traits_json TEXT NOT NULL,
                    variable_traits_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                """
            )
            self._connection.execute(
                """
                CREATE TABLE IF NOT EXISTS subject_references (
                    reference_id TEXT PRIMARY KEY,
                    subject_id TEXT NOT NULL,
                    file_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    is_primary INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(subject_id) REFERENCES subjects(subject_id) ON DELETE CASCADE,
                    FOREIGN KEY(file_id) REFERENCES files(file_id)
                );
                """
            )
            self._connection.execute(
                """
                CREATE TABLE IF NOT EXISTS scenes (
                    scene_id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    description TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                """
            )
            self._connection.execute(
                """
                CREATE TABLE IF NOT EXISTS generations (
                    generation_id TEXT PRIMARY KEY,
                    scene_id TEXT NOT NULL,
                    asset_type TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(scene_id) REFERENCES scenes(scene_id) ON DELETE CASCADE
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
        scene_id: str | None = None,
        generation_id: str | None = None,
        parent_task_id: str | None = None,
    ) -> dict[str, Any]:
        now_iso = _now_iso()
        with self._lock:
            version_number = None
            if generation_id:
                row = self._connection.execute(
                    "SELECT COALESCE(MAX(version_number), 0) AS current_version FROM tasks WHERE generation_id = ?",
                    (generation_id,),
                ).fetchone()
                version_number = int(row["current_version"] or 0) + 1
            self._connection.execute(
                """
                INSERT INTO tasks (
                    task_id, status, asset_type, provider, model, operation, prompt, request_json,
                    estimated_cost, currency, cost_source, scene_id, generation_id, parent_task_id,
                    version_number, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    scene_id,
                    generation_id,
                    parent_task_id,
                    version_number,
                    now_iso,
                    now_iso,
                ),
            )
            if scene_id:
                self._connection.execute(
                    "UPDATE scenes SET updated_at = ? WHERE scene_id = ?",
                    (now_iso, scene_id),
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

    def update_result_payload(self, task_id: str, result: dict[str, Any]) -> None:
        with self._lock:
            row = self._connection.execute(
                "SELECT task_id FROM tasks WHERE task_id = ?",
                (task_id,),
            ).fetchone()
            if row is None:
                raise KeyError(task_id)
            self._connection.execute(
                """
                UPDATE tasks
                SET result_json = ?, updated_at = ?
                WHERE task_id = ?
                """,
                (
                    json.dumps(result, ensure_ascii=False),
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
        return self._attach_scene_title(_row_to_dict(row))

    def _attach_scene_title(self, task: dict[str, Any]) -> dict[str, Any]:
        scene_id = task.get("scene_id")
        if not scene_id:
            task["scene_title"] = None
            return task
        with self._lock:
            row = self._connection.execute(
                "SELECT title FROM scenes WHERE scene_id = ?", (scene_id,)
            ).fetchone()
        task["scene_title"] = row["title"] if row is not None else None
        return task

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
        return [self._attach_scene_title(_row_to_dict(row)) for row in rows]

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
        return [self._attach_scene_title(_row_to_dict(row)) for row in rows]

    def list_succeeded_tasks(self, asset_type: str | None = None) -> list[dict[str, Any]]:
        with self._lock:
            if asset_type:
                rows = self._connection.execute(
                    """
                    SELECT * FROM tasks
                    WHERE status = 'succeeded'
                      AND COALESCE(asset_type, 'video') = ?
                    ORDER BY created_at DESC
                    """,
                    (asset_type,),
                ).fetchall()
            else:
                rows = self._connection.execute(
                    """
                    SELECT * FROM tasks
                    WHERE status = 'succeeded'
                    ORDER BY created_at DESC
                    """
                ).fetchall()
        return [self._attach_scene_title(_row_to_dict(row)) for row in rows]

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

    def create_scene(
        self, *, scene_id: str, title: str, description: str
    ) -> dict[str, Any]:
        now_iso = _now_iso()
        with self._lock:
            self._connection.execute(
                """
                INSERT INTO scenes (scene_id, title, description, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (scene_id, title, description, now_iso, now_iso),
            )
            self._connection.commit()
        return self.get_scene(scene_id)

    def get_scene(self, scene_id: str) -> dict[str, Any]:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT s.*,
                    COUNT(DISTINCT g.generation_id) AS generation_count,
                    COUNT(t.task_id) AS version_count
                FROM scenes s
                LEFT JOIN generations g ON g.scene_id = s.scene_id
                LEFT JOIN tasks t ON t.generation_id = g.generation_id
                WHERE s.scene_id = ?
                GROUP BY s.scene_id
                """,
                (scene_id,),
            ).fetchone()
        if row is None:
            raise KeyError(scene_id)
        return _scene_row_to_dict(row)

    def list_scenes(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT s.*,
                    COUNT(DISTINCT g.generation_id) AS generation_count,
                    COUNT(t.task_id) AS version_count
                FROM scenes s
                LEFT JOIN generations g ON g.scene_id = s.scene_id
                LEFT JOIN tasks t ON t.generation_id = g.generation_id
                GROUP BY s.scene_id
                ORDER BY s.updated_at DESC
                """
            ).fetchall()
        return [_scene_row_to_dict(row) for row in rows]

    def create_generation(
        self, *, generation_id: str, scene_id: str, asset_type: str
    ) -> dict[str, Any]:
        now_iso = _now_iso()
        with self._lock:
            if self._connection.execute(
                "SELECT scene_id FROM scenes WHERE scene_id = ?", (scene_id,)
            ).fetchone() is None:
                raise KeyError(scene_id)
            self._connection.execute(
                """
                INSERT INTO generations (generation_id, scene_id, asset_type, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (generation_id, scene_id, asset_type, now_iso),
            )
            self._connection.execute(
                "UPDATE scenes SET updated_at = ? WHERE scene_id = ?",
                (now_iso, scene_id),
            )
            self._connection.commit()
        return self.get_generation(generation_id)

    def get_generation(self, generation_id: str) -> dict[str, Any]:
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM generations WHERE generation_id = ?", (generation_id,)
            ).fetchone()
        if row is None:
            raise KeyError(generation_id)
        return dict(row)

    def create_subject(
        self,
        *,
        subject_id: str,
        kind: str,
        name: str,
        description: str,
        fixed_traits: list[str],
        variable_traits: list[str],
        references: list[dict[str, Any]],
    ) -> dict[str, Any]:
        now_iso = _now_iso()
        with self._lock:
            self._connection.execute(
                """
                INSERT INTO subjects (
                    subject_id, kind, name, description, fixed_traits_json,
                    variable_traits_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    subject_id,
                    kind,
                    name,
                    description,
                    json.dumps(fixed_traits, ensure_ascii=False),
                    json.dumps(variable_traits, ensure_ascii=False),
                    now_iso,
                    now_iso,
                ),
            )
            self._replace_subject_references(subject_id, references, now_iso)
            self._connection.commit()
        return self.get_subject(subject_id)

    def update_subject(
        self,
        *,
        subject_id: str,
        kind: str,
        name: str,
        description: str,
        fixed_traits: list[str],
        variable_traits: list[str],
        references: list[dict[str, Any]],
    ) -> dict[str, Any]:
        now_iso = _now_iso()
        with self._lock:
            cursor = self._connection.execute(
                """
                UPDATE subjects
                SET kind = ?, name = ?, description = ?, fixed_traits_json = ?,
                    variable_traits_json = ?, updated_at = ?
                WHERE subject_id = ?
                """,
                (
                    kind,
                    name,
                    description,
                    json.dumps(fixed_traits, ensure_ascii=False),
                    json.dumps(variable_traits, ensure_ascii=False),
                    now_iso,
                    subject_id,
                ),
            )
            if cursor.rowcount == 0:
                raise KeyError(subject_id)
            self._connection.execute(
                "DELETE FROM subject_references WHERE subject_id = ?", (subject_id,)
            )
            self._replace_subject_references(subject_id, references, now_iso)
            self._connection.commit()
        return self.get_subject(subject_id)

    def _replace_subject_references(
        self,
        subject_id: str,
        references: list[dict[str, Any]],
        created_at: str,
    ) -> None:
        for reference in references:
            self._connection.execute(
                """
                INSERT INTO subject_references (
                    reference_id, subject_id, file_id, role, is_primary, created_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    reference["reference_id"],
                    subject_id,
                    reference["file_id"],
                    reference["role"],
                    1 if reference.get("is_primary") else 0,
                    created_at,
                ),
            )

    def add_subject_reference(
        self,
        *,
        subject_id: str,
        reference_id: str,
        file_id: str,
        role: str,
        is_primary: bool,
    ) -> dict[str, Any]:
        now_iso = _now_iso()
        with self._lock:
            if self._connection.execute(
                "SELECT subject_id FROM subjects WHERE subject_id = ?", (subject_id,)
            ).fetchone() is None:
                raise KeyError(subject_id)
            if is_primary:
                self._connection.execute(
                    "UPDATE subject_references SET is_primary = 0 WHERE subject_id = ?",
                    (subject_id,),
                )
            self._connection.execute(
                """
                INSERT INTO subject_references (
                    reference_id, subject_id, file_id, role, is_primary, created_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (reference_id, subject_id, file_id, role, 1 if is_primary else 0, now_iso),
            )
            self._connection.execute(
                "UPDATE subjects SET updated_at = ? WHERE subject_id = ?",
                (now_iso, subject_id),
            )
            self._connection.commit()
        return self.get_subject(subject_id)

    def get_subject(self, subject_id: str) -> dict[str, Any]:
        with self._lock:
            row = self._connection.execute(
                "SELECT * FROM subjects WHERE subject_id = ?", (subject_id,)
            ).fetchone()
            if row is None:
                raise KeyError(subject_id)
            references = self._connection.execute(
                """
                SELECT sr.*, f.original_name, f.mime_type
                FROM subject_references sr
                JOIN files f ON f.file_id = sr.file_id
                WHERE sr.subject_id = ?
                ORDER BY sr.is_primary DESC, sr.created_at ASC
                """,
                (subject_id,),
            ).fetchall()
        return _subject_row_to_dict(row, references)

    def list_subjects(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = self._connection.execute(
                "SELECT subject_id FROM subjects ORDER BY updated_at DESC"
            ).fetchall()
        return [self.get_subject(row["subject_id"]) for row in rows]

    def delete_subject(self, subject_id: str) -> None:
        with self._lock:
            row = self._connection.execute(
                "SELECT subject_id FROM subjects WHERE subject_id = ?", (subject_id,)
            ).fetchone()
            if row is None:
                raise KeyError(subject_id)
            self._connection.execute(
                "DELETE FROM subject_references WHERE subject_id = ?", (subject_id,)
            )
            self._connection.execute("DELETE FROM subjects WHERE subject_id = ?", (subject_id,))
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
        "scene_id": row["scene_id"] if "scene_id" in row.keys() else None,
        "generation_id": row["generation_id"] if "generation_id" in row.keys() else None,
        "parent_task_id": row["parent_task_id"] if "parent_task_id" in row.keys() else None,
        "version_number": row["version_number"] if "version_number" in row.keys() else None,
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


def _subject_row_to_dict(
    row: sqlite3.Row, references: list[sqlite3.Row]
) -> dict[str, Any]:
    return {
        "subject_id": row["subject_id"],
        "kind": row["kind"],
        "name": row["name"],
        "description": row["description"],
        "fixed_traits": json.loads(row["fixed_traits_json"]),
        "variable_traits": json.loads(row["variable_traits_json"]),
        "references": [
            {
                "reference_id": reference["reference_id"],
                "file_id": reference["file_id"],
                "role": reference["role"],
                "is_primary": bool(reference["is_primary"]),
                "original_name": reference["original_name"],
                "mime_type": reference["mime_type"],
            }
            for reference in references
        ],
        "created_at": _parse_iso(row["created_at"]),
        "updated_at": _parse_iso(row["updated_at"]),
    }


def _scene_row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "scene_id": row["scene_id"],
        "title": row["title"],
        "description": row["description"],
        "generation_count": int(row["generation_count"] or 0),
        "version_count": int(row["version_count"] or 0),
        "created_at": _parse_iso(row["created_at"]),
        "updated_at": _parse_iso(row["updated_at"]),
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
        "scene_id": "TEXT",
        "generation_id": "TEXT",
        "parent_task_id": "TEXT",
        "version_number": "INTEGER",
    }
    for column, definition in expected_columns.items():
        if column in existing:
            continue
        connection.execute(f"ALTER TABLE tasks ADD COLUMN {column} {definition}")
    connection.execute(
        "UPDATE tasks SET asset_type = 'video' WHERE asset_type IS NULL OR asset_type = ''"
    )
