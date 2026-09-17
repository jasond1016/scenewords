from __future__ import annotations

import json
from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

import app.main as app_main


def _write_test_configs(
    *,
    case_dir: Path,
) -> tuple[Path, Path]:
    providers_path = case_dir / "providers.json"
    providers_path.write_text(
        json.dumps(
            {
                "providers": [
                    {
                        "id": "demo_provider",
                        "display_name": "Demo Provider",
                        "type": "openai_compatible",
                        "enabled": True,
                        "base_url": "https://example.com",
                        "api_path": "/v1/videos",
                        "auth_env": "DEMO_API_KEY",
                        "models": [
                            {
                                "name": "demo-model",
                                "display_name": "Demo Model",
                                "default": True,
                            }
                        ],
                    },
                    {
                        "id": "tuzi_image_demo",
                        "display_name": "Tuzi Image Demo",
                        "type": "tuzi_image",
                        "enabled": True,
                        "base_url": "https://example.com",
                        "api_path": "/v1/images/generations",
                        "generate_path": "/v1/images/generations",
                        "edit_path": "/v1/images/edits",
                        "async_path": "/v1/videos",
                        "query_path": "/v1/videos/{task_id}",
                        "auth_env": "DEMO_API_KEY",
                        "models": [
                            {
                                "name": "gemini-3-pro-image-preview",
                                "display_name": "Nano Banana 2",
                                "default": True,
                            }
                        ],
                    },
                ]
            }
        ),
        encoding="utf-8",
    )
    pricing_path = case_dir / "pricing.json"
    pricing_path.write_text(
        json.dumps(
            {
                "mode": "local_config",
                "currency": "USD",
                "pricing_version": "test-version",
                "entries": [
                    {
                        "provider": "demo_provider",
                        "model": "demo-model",
                        "operation": "generate",
                        "fixed_cost": 1.25,
                        "discount_rate": 0.8,
                        "currency": "USD",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    return providers_path, pricing_path


@pytest.fixture
def client_factory(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    def _build(*, with_index: bool = False) -> TestClient:
        case_dir = tmp_path / uuid4().hex
        case_dir.mkdir(parents=True, exist_ok=True)
        providers_path, pricing_path = _write_test_configs(case_dir=case_dir)
        static_dir = case_dir / "static"
        if with_index:
            static_dir.mkdir(parents=True, exist_ok=True)
            (static_dir / "index.html").write_text(
                "<html><body>ok</body></html>", encoding="utf-8"
            )

        monkeypatch.setenv("VIDEO_GATEWAY_CONFIG", str(providers_path))
        monkeypatch.setenv("VIDEO_GATEWAY_PRICING_CONFIG", str(pricing_path))
        monkeypatch.setenv("VIDEO_GATEWAY_DB_PATH", str(case_dir / "tasks.db"))
        monkeypatch.setenv("VIDEO_GATEWAY_OUTPUT_DIR", str(case_dir / "outputs"))
        monkeypatch.setenv("VIDEO_GATEWAY_UPLOAD_DIR", str(case_dir / "uploads"))
        monkeypatch.setenv("VIDEO_GATEWAY_MAX_UPLOAD_MB", "1")
        monkeypatch.setattr(app_main, "STATIC_DIR", static_dir)
        return TestClient(app_main.create_app())

    return _build


def test_health(client_factory) -> None:
    with client_factory() as client:
        response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_index_returns_503_without_build_artifacts(client_factory) -> None:
    with client_factory(with_index=False) as client:
        response = client.get("/")
    assert response.status_code == 503
    assert response.json()["detail"] == app_main.FRONTEND_BUILD_HINT


def test_index_serves_html_when_index_exists(client_factory) -> None:
    with client_factory(with_index=True) as client:
        response = client.get("/")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]


def test_upload_file_rejects_non_image(client_factory) -> None:
    with client_factory() as client:
        response = client.post(
            "/v1/files",
            files={"file": ("note.txt", b"hello", "text/plain")},
        )
    assert response.status_code == 400
    assert "only jpg/png/webp" in response.json()["detail"]


def test_upload_and_readback_file(client_factory) -> None:
    with client_factory() as client:
        png_bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
        upload_response = client.post(
            "/v1/files",
            files={"file": ("image.png", png_bytes, "image/png")},
        )
        assert upload_response.status_code == 200
        file_info = upload_response.json()
        download_response = client.get(file_info["url"])
    assert download_response.status_code == 200
    assert download_response.headers["content-type"].startswith("image/png")
    assert download_response.content == png_bytes


def test_subject_asset_crud_preserves_reference_roles(client_factory) -> None:
    with client_factory() as client:
        uploads = []
        for name in ("anchor.png", "side.png"):
            response = client.post(
                "/v1/files",
                files={"file": (name, b"\x89PNG\r\n\x1a\nimage", "image/png")},
            )
            assert response.status_code == 200
            uploads.append(response.json())

        create_response = client.post(
            "/v1/subjects",
            json={
                "kind": "character",
                "name": " Xiao Wang ",
                "description": "Recurring office character",
                "fixed_traits": ["yellow hoodie", "round face", "yellow hoodie"],
                "variable_traits": ["expression", "pose"],
                "references": [
                    {
                        "file_id": uploads[0]["file_id"],
                        "role": "3/4 full body",
                        "is_primary": False,
                    },
                    {
                        "file_id": uploads[1]["file_id"],
                        "role": "side",
                        "is_primary": False,
                    },
                ],
            },
        )
        assert create_response.status_code == 201
        created = create_response.json()
        assert created["name"] == "Xiao Wang"
        assert created["fixed_traits"] == ["yellow hoodie", "round face"]
        assert created["references"][0]["is_primary"] is True
        assert created["references"][0]["role"] == "3/4 full body"

        list_response = client.get("/v1/subjects")
        assert list_response.status_code == 200
        assert [item["subject_id"] for item in list_response.json()] == [created["subject_id"]]

        update_response = client.put(
            f"/v1/subjects/{created['subject_id']}",
            json={
                "kind": "object",
                "name": "Yellow mascot",
                "description": "",
                "fixed_traits": ["yellow"],
                "variable_traits": [],
                "references": [
                    {
                        "file_id": uploads[1]["file_id"],
                        "role": "side",
                        "is_primary": True,
                    }
                ],
            },
        )
        assert update_response.status_code == 200
        assert update_response.json()["kind"] == "object"
        assert len(update_response.json()["references"]) == 1

        delete_response = client.delete(f"/v1/subjects/{created['subject_id']}")
        assert delete_response.status_code == 204
        assert client.get("/v1/subjects").json() == []


def test_subject_asset_rejects_unknown_reference(client_factory) -> None:
    with client_factory() as client:
        response = client.post(
            "/v1/subjects",
            json={
                "kind": "object",
                "name": "Cup",
                "references": [
                    {"file_id": "missing", "role": "front", "is_primary": True}
                ],
            },
        )
    assert response.status_code == 400
    assert response.json()["detail"] == "Unknown file: missing"


def test_list_video_tasks_default_empty(client_factory) -> None:
    with client_factory() as client:
        response = client.get("/v1/video/tasks")
    assert response.status_code == 200
    assert response.json() == []


def test_task_detail_returns_immutable_subject_binding_snapshot(client_factory) -> None:
    with client_factory() as client:
        task_id = str(uuid4())
        snapshot = {
            "subject_id": "subject-1",
            "kind": "character",
            "name": "Xiao Wang",
            "description": "Office character",
            "fixed_traits": ["yellow hoodie"],
            "reference_file_ids": ["reference-1"],
        }
        client.app.state.store.create_task(
            task_id=task_id,
            provider="demo_provider",
            model="demo-model",
            operation="generate",
            prompt="compiled prompt",
            request_payload={
                "provider": "demo_provider",
                "model": "demo-model",
                "operation": "generate",
                "prompt": "compiled prompt",
                "provider_options": {},
                "subject_bindings": [snapshot],
            },
        )
        response = client.get(f"/v1/video/tasks/{task_id}")
    assert response.status_code == 200
    assert response.json()["subject_bindings"] == [snapshot]


def test_list_video_tasks_supports_offset(client_factory) -> None:
    with client_factory() as client:
        oldest = _seed_task(client)
        middle = _seed_task(client)
        newest = _seed_task(client)
        response = client.get("/v1/video/tasks?limit=1&offset=1")
    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 1
    assert payload[0]["task_id"] == middle
    assert payload[0]["task_id"] != newest
    assert payload[0]["task_id"] != oldest


def test_list_video_tasks_summary_view_strips_raw_payloads(client_factory) -> None:
    with client_factory() as client:
        task_id = _seed_task(client)
        client.app.state.store.set_result(
            task_id=task_id,
            result={
                "video_url": "https://example.com/video.mp4",
                "local_video_url": "/v1/assets/video.mp4",
                "raw_response": {"huge": {"nested": True}},
                "images": [
                    {"url": "https://example.com/image-1.png", "meta": {"ignored": 1}},
                    {"download_url": "https://example.com/image-2.png", "foo": "bar"},
                ],
            },
        )
        summary_response = client.get("/v1/video/tasks?view=summary")
        full_response = client.get("/v1/video/tasks?view=full")
    assert summary_response.status_code == 200
    assert full_response.status_code == 200
    summary_task = summary_response.json()[0]
    full_task = full_response.json()[0]
    assert "raw_response" not in (summary_task["result"] or {})
    assert summary_task["result"]["video_url"] == "https://example.com/video.mp4"
    assert summary_task["result"]["local_video_url"] == "/v1/assets/video.mp4"
    assert summary_task["result"]["images"] == [
        {"url": "https://example.com/image-1.png"},
        {"download_url": "https://example.com/image-2.png"},
    ]
    assert "raw_response" in (full_task["result"] or {})


def test_create_video_task_persists_estimated_cost(client_factory) -> None:
    with client_factory() as client:
        async def _submit_noop(task_id: str) -> None:
            return None

        client.app.state.worker.submit = _submit_noop
        response = client.post(
            "/v1/video/generations",
            json={
                "provider": "demo_provider",
                "model": "demo-model",
                "operation": "generate",
                "prompt": "test prompt",
                "provider_options": {},
            },
        )
        task = client.app.state.store.get_task(response.json()["task_id"])

    assert response.status_code == 200
    assert task["estimated_cost"] == 1.0
    assert task["actual_cost"] is None
    assert task["cost_source"] == "local_config"


def test_list_video_tasks_summary_view_strips_raw_error_details(client_factory) -> None:
    with client_factory() as client:
        task_id = _seed_task(client)
        client.app.state.store.set_error(
            task_id=task_id,
            code="upstream_error",
            message="failed to generate",
            raw_error={"provider": {"trace": "verbose"}},
        )
        summary_response = client.get("/v1/video/tasks?view=summary")
        full_response = client.get("/v1/video/tasks?view=full")
    assert summary_response.status_code == 200
    assert full_response.status_code == 200
    summary_task = summary_response.json()[0]
    full_task = full_response.json()[0]
    assert summary_task["error"] == {
        "code": "upstream_error",
        "message": "failed to generate",
    }
    assert full_task["error"]["raw_error"] == {"provider": {"trace": "verbose"}}


def test_task_cost_summary_excludes_failed_tasks(client_factory) -> None:
    with client_factory() as client:
        charged_task_id = str(uuid4())
        client.app.state.store.create_task(
            task_id=charged_task_id,
            provider="demo_provider",
            model="demo-model",
            operation="generate",
            prompt="charged task",
            request_payload={
                "provider": "demo_provider",
                "model": "demo-model",
                "operation": "generate",
                "prompt": "charged task",
                "provider_options": {},
            },
            estimated_cost=1.25,
            currency="USD",
            cost_source="local_config",
        )
        client.app.state.store.set_result(
            task_id=charged_task_id,
            result={"video_url": "https://example.com/video.mp4"},
            actual_cost=1.5,
            cost_source="provider_api",
        )

        failed_task_id = str(uuid4())
        client.app.state.store.create_task(
            task_id=failed_task_id,
            provider="demo_provider",
            model="demo-model",
            operation="generate",
            prompt="failed task",
            request_payload={
                "provider": "demo_provider",
                "model": "demo-model",
                "operation": "generate",
                "prompt": "failed task",
                "provider_options": {},
            },
            estimated_cost=0.8,
            currency="USD",
            cost_source="local_config",
        )
        client.app.state.store.set_error(
            task_id=failed_task_id,
            code="upstream_error",
            message="generation failed",
            raw_error={},
        )

        pending_task_id = str(uuid4())
        client.app.state.store.create_task(
            task_id=pending_task_id,
            provider="demo_provider",
            model="demo-model",
            operation="generate",
            prompt="pending task",
            request_payload={
                "provider": "demo_provider",
                "model": "demo-model",
                "operation": "generate",
                "prompt": "pending task",
                "provider_options": {},
            },
            estimated_cost=0.6,
            currency="USD",
            cost_source="local_config",
        )

        response = client.get("/v1/tasks/summary")

    assert response.status_code == 200
    assert response.json() == {
        "charged_cost_total": 1.5,
        "charged_task_count": 1,
        "pending_estimated_cost_total": 0.6,
        "pending_estimated_task_count": 1,
        "currency": "USD",
    }


def _seed_task(client: TestClient) -> str:
    task_id = str(uuid4())
    client.app.state.store.create_task(
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
    )
    return task_id


def _seed_image_task(client: TestClient) -> str:
    task_id = str(uuid4())
    client.app.state.store.create_task(
        task_id=task_id,
        provider="tuzi_image_demo",
        model="gemini-3-pro-image-preview",
        operation="generate",
        prompt="test image prompt",
        request_payload={
            "provider": "tuzi_image_demo",
            "model": "gemini-3-pro-image-preview",
            "operation": "generate",
            "prompt": "test image prompt",
            "provider_options": {},
        },
        asset_type="image",
    )
    return task_id


def test_delete_history_task(client_factory) -> None:
    with client_factory() as client:
        task_id = _seed_task(client)
        client.app.state.store.set_error(
            task_id=task_id,
            code="test_error",
            message="seed failure",
            raw_error={},
        )
        delete_response = client.delete(f"/v1/video/tasks/{task_id}")
        list_response = client.get("/v1/video/tasks?limit=50")
    assert delete_response.status_code == 204
    assert all(task["task_id"] != task_id for task in list_response.json())


def test_delete_in_progress_task_allowed(client_factory) -> None:
    with client_factory() as client:
        task_id = _seed_task(client)
        delete_response = client.delete(f"/v1/video/tasks/{task_id}")
        list_response = client.get("/v1/video/tasks?limit=50")
    assert delete_response.status_code == 204
    assert all(task["task_id"] != task_id for task in list_response.json())


def test_image_generation_rejects_non_image_provider(client_factory) -> None:
    with client_factory() as client:
        response = client.post(
            "/v1/image/generations",
            json={
                "provider": "demo_provider",
                "model": "demo-model",
                "operation": "generate",
                "prompt": "test",
                "provider_options": {},
            },
        )
    assert response.status_code == 400
    assert "not allowed for this route" in response.json()["detail"]


def test_list_image_tasks_only_returns_image_asset_type(client_factory) -> None:
    with client_factory() as client:
        _seed_task(client)
        image_task_id = _seed_image_task(client)
        response = client.get("/v1/image/tasks?limit=20")
    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 1
    assert payload[0]["task_id"] == image_task_id
    assert payload[0]["asset_type"] == "image"


def test_list_image_tasks_supports_offset(client_factory) -> None:
    with client_factory() as client:
        oldest = _seed_image_task(client)
        middle = _seed_image_task(client)
        newest = _seed_image_task(client)
        response = client.get("/v1/image/tasks?limit=1&offset=1")
    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 1
    assert payload[0]["task_id"] == middle
    assert payload[0]["task_id"] != newest
    assert payload[0]["task_id"] != oldest


def test_retry_video_task_keeps_seed_for_supported_provider(
    client_factory,
) -> None:
    with client_factory() as client:
        async def _submit_noop(task_id: str) -> None:
            return None

        client.app.state.worker.submit = _submit_noop
        task_id = str(uuid4())
        client.app.state.store.create_task(
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
                "seed": 12345,
                "provider_options": {},
            },
        )

        response = client.post(
            f"/v1/video/tasks/{task_id}/retry",
            json={"retry_mode": "same_seed"},
        )
        new_task = client.app.state.store.get_task(response.json()["task_id"])

    assert response.status_code == 200
    assert new_task["request"]["seed"] == 12345


def test_retry_image_task_clears_seed_for_tuzi_provider(
    client_factory,
) -> None:
    with client_factory() as client:
        async def _submit_noop(task_id: str) -> None:
            return None

        client.app.state.worker.submit = _submit_noop
        task_id = str(uuid4())
        client.app.state.store.create_task(
            task_id=task_id,
            provider="tuzi_image_demo",
            model="gemini-3-pro-image-preview",
            operation="generate",
            prompt="test image prompt",
            request_payload={
                "provider": "tuzi_image_demo",
                "model": "gemini-3-pro-image-preview",
                "operation": "generate",
                "prompt": "test image prompt",
                "seed": 67890,
                "provider_options": {},
            },
            asset_type="image",
        )

        response = client.post(
            f"/v1/image/tasks/{task_id}/retry",
            json={"retry_mode": "same_seed"},
        )
        new_task = client.app.state.store.get_task(response.json()["task_id"])

    assert response.status_code == 200
    assert new_task["request"]["seed"] is None


def test_scene_generation_retry_creates_linear_versions(client_factory) -> None:
    with client_factory() as client:
        async def _submit_noop(task_id: str) -> None:
            return None

        client.app.state.worker.submit = _submit_noop
        scene_response = client.post(
            "/v1/scenes",
            json={"title": "Rainy station", "description": "Recurring scene"},
        )
        scene_id = scene_response.json()["scene_id"]

        first_response = client.post(
            "/v1/image/generations",
            json={
                "provider": "tuzi_image_demo",
                "model": "gemini-3-pro-image-preview",
                "operation": "generate",
                "scene_id": scene_id,
                "prompt": "first version",
                "provider_options": {},
            },
        )
        first = first_response.json()
        retry_response = client.post(
            f"/v1/image/tasks/{first['task_id']}/retry",
            json={"retry_mode": "same_seed", "prompt": "second version"},
        )
        second = retry_response.json()
        scenes = client.get("/v1/scenes").json()

    assert scene_response.status_code == 201
    assert first_response.status_code == 200
    assert first["scene_id"] == scene_id
    assert first["scene_title"] == "Rainy station"
    assert first["version_number"] == 1
    assert second["generation_id"] == first["generation_id"]
    assert second["parent_version_id"] == first["task_id"]
    assert second["version_number"] == 2
    assert scenes[0]["generation_count"] == 1
    assert scenes[0]["version_count"] == 2


def test_generated_image_can_be_collected_as_subject_anchor(client_factory) -> None:
    with client_factory() as client:
        subject = client.post(
            "/v1/subjects",
            json={
                "kind": "character",
                "name": "Ming",
                "description": "line-art protagonist",
                "fixed_traits": [],
                "variable_traits": [],
                "references": [],
            },
        ).json()
        task_id = str(uuid4())
        archive_dir = client.app.state.config.output_dir / "assets" / task_id
        archive_dir.mkdir(parents=True, exist_ok=True)
        (archive_dir / "image_0.png").write_bytes(b"generated-image")
        client.app.state.store.create_task(
            task_id=task_id,
            provider="tuzi_image_demo",
            model="gemini-3-pro-image-preview",
            operation="generate",
            prompt="candidate",
            request_payload={
                "provider": "tuzi_image_demo",
                "model": "gemini-3-pro-image-preview",
                "operation": "generate",
                "prompt": "candidate",
                "provider_options": {},
            },
            asset_type="image",
        )
        client.app.state.store.set_result(
            task_id,
            {"local_image_urls": [f"/v1/assets/{task_id}/image_0.png"]},
        )

        response = client.post(
            f"/v1/subjects/{subject['subject_id']}/references/from-task",
            json={
                "task_id": task_id,
                "image_index": 0,
                "role": "Identity anchor",
                "is_primary": False,
            },
        )

    assert response.status_code == 200
    references = response.json()["references"]
    assert len(references) == 1
    assert references[0]["role"] == "Identity anchor"
    assert references[0]["is_primary"] is True


def test_generated_image_output_can_be_imported_as_reusable_file(client_factory) -> None:
    with client_factory() as client:
        task_id = str(uuid4())
        archive_dir = client.app.state.config.output_dir / "assets" / task_id
        archive_dir.mkdir(parents=True, exist_ok=True)
        expected = b"generated-image-output"
        (archive_dir / "image_0.png").write_bytes(expected)
        client.app.state.store.create_task(
            task_id=task_id,
            provider="tuzi_image_demo",
            model="gemini-3-pro-image-preview",
            operation="generate",
            prompt="candidate",
            request_payload={
                "provider": "tuzi_image_demo",
                "model": "gemini-3-pro-image-preview",
                "operation": "generate",
                "prompt": "candidate",
                "provider_options": {},
            },
            asset_type="image",
        )
        client.app.state.store.set_result(
            task_id,
            {"local_image_urls": [f"/v1/assets/{task_id}/image_0.png"]},
        )

        response = client.post(f"/v1/image/tasks/{task_id}/outputs/0/file")
        downloaded = client.get(response.json()["url"])

    assert response.status_code == 200
    assert response.json()["mime_type"] == "image/png"
    assert downloaded.status_code == 200
    assert downloaded.content == expected


def test_generated_image_output_recovers_from_remote_url(client_factory) -> None:
    class RemoteImageClient:
        call_count = 0

        async def get(self, url: str, **kwargs) -> httpx.Response:
            self.call_count += 1
            assert url == "https://cdn.example.com/generated/result.webp"
            assert kwargs["follow_redirects"] is True
            if self.call_count == 1:
                raise httpx.RemoteProtocolError(
                    "Server disconnected without sending a response"
                )
            return httpx.Response(
                200,
                content=b"remote-generated-image",
                headers={"content-type": "image/webp"},
            )

    with client_factory() as client:
        task_id = str(uuid4())
        client.app.state.store.create_task(
            task_id=task_id,
            provider="tuzi_image_demo",
            model="gemini-3-pro-image-preview",
            operation="generate",
            prompt="candidate",
            request_payload={
                "provider": "tuzi_image_demo",
                "model": "gemini-3-pro-image-preview",
                "operation": "generate",
                "prompt": "candidate",
                "provider_options": {},
            },
            asset_type="image",
        )
        client.app.state.store.set_result(
            task_id,
            {"image_urls": ["https://cdn.example.com/generated/result.webp"]},
        )
        remote_client = RemoteImageClient()
        client.app.state.http_client = remote_client

        response = client.post(f"/v1/image/tasks/{task_id}/outputs/0/file")
        downloaded = client.get(response.json()["url"])

    assert response.status_code == 200
    assert remote_client.call_count == 2
    assert response.json()["mime_type"] == "image/webp"
    assert downloaded.status_code == 200
    assert downloaded.content == b"remote-generated-image"


def test_generated_image_output_reports_remote_download_failure(client_factory) -> None:
    class FailedRemoteImageClient:
        async def get(self, url: str, **kwargs) -> httpx.Response:
            return httpx.Response(403, content=b"expired")

    with client_factory() as client:
        task_id = str(uuid4())
        client.app.state.store.create_task(
            task_id=task_id,
            provider="tuzi_image_demo",
            model="gemini-3-pro-image-preview",
            operation="generate",
            prompt="candidate",
            request_payload={
                "provider": "tuzi_image_demo",
                "model": "gemini-3-pro-image-preview",
                "operation": "generate",
                "prompt": "candidate",
                "provider_options": {},
            },
            asset_type="image",
        )
        client.app.state.store.set_result(
            task_id,
            {"images": [{"url": "https://cdn.example.com/expired.png"}]},
        )
        client.app.state.http_client = FailedRemoteImageClient()

        response = client.post(f"/v1/image/tasks/{task_id}/outputs/0/file")

    assert response.status_code == 502
    assert response.json()["detail"] == "Failed to download generated image from provider"


def test_scene_can_branch_from_version_and_adopt_result(client_factory) -> None:
    with client_factory() as client:
        async def _submit_noop(task_id: str) -> None:
            return None

        client.app.state.worker.submit = _submit_noop
        scene_id = client.post(
            "/v1/scenes",
            json={"title": "Branching scene", "description": ""},
        ).json()["scene_id"]
        first = client.post(
            "/v1/image/generations",
            json={
                "provider": "tuzi_image_demo",
                "model": "gemini-3-pro-image-preview",
                "operation": "generate",
                "scene_id": scene_id,
                "prompt": "first version",
                "provider_options": {},
            },
        ).json()
        branch_response = client.post(
            "/v1/image/generations",
            json={
                "provider": "tuzi_image_demo",
                "model": "gemini-3-pro-image-preview",
                "operation": "generate",
                "scene_id": scene_id,
                "generation_id": None,
                "parent_version_id": first["task_id"],
                "prompt": "alternate direction",
                "provider_options": {},
            },
        )
        branch = branch_response.json()
        client.app.state.store.set_result(
            branch["task_id"],
            {"local_image_urls": [f"/v1/assets/{branch['task_id']}/image_0.png"]},
        )
        adopt_response = client.post(
            f"/v1/generations/{branch['generation_id']}/adopt/{branch['task_id']}"
        )
        refreshed = client.get(f"/v1/image/tasks/{branch['task_id']}").json()
        scenes = client.get("/v1/scenes").json()

    assert branch_response.status_code == 200
    assert branch["generation_id"] != first["generation_id"]
    assert branch["parent_version_id"] == first["task_id"]
    assert branch["version_number"] == 1
    assert adopt_response.status_code == 200
    assert refreshed["adopted_version_id"] == branch["task_id"]
    assert scenes[0]["generation_count"] == 2


def test_scene_detail_groups_candidates_and_approves_exact_version(client_factory) -> None:
    with client_factory() as client:
        async def _submit_noop(task_id: str) -> None:
            return None

        client.app.state.worker.submit = _submit_noop
        scene_id = client.post(
            "/v1/scenes",
            json={"title": "Candidate board", "description": "Choose a direction"},
        ).json()["scene_id"]
        first = client.post(
            "/v1/image/generations",
            json={
                "provider": "tuzi_image_demo",
                "model": "gemini-3-pro-image-preview",
                "operation": "generate",
                "scene_id": scene_id,
                "prompt": "candidate A",
                "provider_options": {},
            },
        ).json()
        second = client.post(
            "/v1/image/generations",
            json={
                "provider": "tuzi_image_demo",
                "model": "gemini-3-pro-image-preview",
                "operation": "generate",
                "scene_id": scene_id,
                "generation_id": None,
                "parent_version_id": first["task_id"],
                "prompt": "candidate B",
                "provider_options": {},
            },
        ).json()
        client.app.state.store.set_result(first["task_id"], {"image_urls": ["https://example.com/a.png"]})
        client.app.state.store.set_result(second["task_id"], {"image_urls": ["https://example.com/b.png"]})

        approve_response = client.post(
            f"/v1/scenes/{scene_id}/approve/{second['task_id']}"
        )
        detail_response = client.get(f"/v1/scenes/{scene_id}")

    assert approve_response.status_code == 200
    assert approve_response.json()["approved_generation_id"] == second["generation_id"]
    assert approve_response.json()["approved_version_id"] == second["task_id"]
    assert detail_response.status_code == 200
    detail = detail_response.json()
    assert [item["generation_id"] for item in detail["generations"]] == [
        first["generation_id"],
        second["generation_id"],
    ]
    assert [item["versions"][0]["prompt"] for item in detail["generations"]] == [
        "candidate A",
        "candidate B",
    ]
    assert detail["generations"][1]["adopted_version_id"] == second["task_id"]


def test_scene_rejects_approving_unfinished_or_foreign_version(client_factory) -> None:
    with client_factory() as client:
        async def _submit_noop(task_id: str) -> None:
            return None

        client.app.state.worker.submit = _submit_noop
        scene_ids = [
            client.post(
                "/v1/scenes",
                json={"title": title, "description": ""},
            ).json()["scene_id"]
            for title in ("First scene", "Second scene")
        ]
        task = client.post(
            "/v1/image/generations",
            json={
                "provider": "tuzi_image_demo",
                "model": "gemini-3-pro-image-preview",
                "operation": "generate",
                "scene_id": scene_ids[0],
                "prompt": "still queued",
                "provider_options": {},
            },
        ).json()

        unfinished = client.post(
            f"/v1/scenes/{scene_ids[0]}/approve/{task['task_id']}"
        )
        foreign = client.post(
            f"/v1/scenes/{scene_ids[1]}/approve/{task['task_id']}"
        )

    assert unfinished.status_code == 409
    assert foreign.status_code == 400


def test_deleting_only_candidate_version_clears_scene_selection(client_factory) -> None:
    with client_factory() as client:
        async def _submit_noop(task_id: str) -> None:
            return None

        client.app.state.worker.submit = _submit_noop
        scene_id = client.post(
            "/v1/scenes",
            json={"title": "Disposable candidate", "description": ""},
        ).json()["scene_id"]
        task = client.post(
            "/v1/image/generations",
            json={
                "provider": "tuzi_image_demo",
                "model": "gemini-3-pro-image-preview",
                "operation": "generate",
                "scene_id": scene_id,
                "prompt": "only candidate",
                "provider_options": {},
            },
        ).json()
        client.app.state.store.set_result(
            task["task_id"], {"image_urls": ["https://example.com/result.png"]}
        )
        client.post(f"/v1/scenes/{scene_id}/approve/{task['task_id']}")

        delete_response = client.delete(f"/v1/image/tasks/{task['task_id']}")
        detail = client.get(f"/v1/scenes/{scene_id}").json()

    assert delete_response.status_code == 204
    assert detail["approved_generation_id"] is None
    assert detail["approved_version_id"] is None
    assert detail["generation_count"] == 0
    assert detail["version_count"] == 0
    assert detail["generations"] == []


def test_deleting_candidate_direction_removes_all_versions_and_selection(client_factory) -> None:
    with client_factory() as client:
        async def _submit_noop(task_id: str) -> None:
            return None

        client.app.state.worker.submit = _submit_noop
        scene_id = client.post(
            "/v1/scenes",
            json={"title": "Delete direction", "description": ""},
        ).json()["scene_id"]
        first = client.post(
            "/v1/image/generations",
            json={
                "provider": "tuzi_image_demo",
                "model": "gemini-3-pro-image-preview",
                "operation": "generate",
                "scene_id": scene_id,
                "prompt": "version one",
                "provider_options": {},
            },
        ).json()
        second = client.post(
            f"/v1/image/tasks/{first['task_id']}/retry",
            json={"retry_mode": "same_seed", "prompt": "version two"},
        ).json()
        for task in (first, second):
            client.app.state.store.set_result(
                task["task_id"], {"image_urls": ["https://example.com/result.png"]}
            )
            archive_dir = client.app.state.config.output_dir / "assets" / task["task_id"]
            archive_dir.mkdir(parents=True, exist_ok=True)
            (archive_dir / "image_1.png").write_bytes(b"result")
        client.post(f"/v1/scenes/{scene_id}/approve/{second['task_id']}")

        delete_response = client.delete(f"/v1/generations/{first['generation_id']}")
        detail = client.get(f"/v1/scenes/{scene_id}").json()
        task_responses = [
            client.get(f"/v1/image/tasks/{task['task_id']}") for task in (first, second)
        ]

    assert delete_response.status_code == 204
    assert all(response.status_code == 404 for response in task_responses)
    assert detail["approved_version_id"] is None
    assert detail["generation_count"] == 0
    assert detail["version_count"] == 0
    assert detail["generations"] == []
    assert all(
        not (client.app.state.config.output_dir / "assets" / task["task_id"]).exists()
        for task in (first, second)
    )


def test_delete_image_history_task(client_factory) -> None:
    with client_factory() as client:
        task_id = _seed_image_task(client)
        client.app.state.store.set_error(
            task_id=task_id,
            code="test_error",
            message="seed failure",
            raw_error={},
        )
        delete_response = client.delete(f"/v1/image/tasks/{task_id}")
        list_response = client.get("/v1/image/tasks?limit=50")
    assert delete_response.status_code == 204
    assert all(task["task_id"] != task_id for task in list_response.json())


def test_delete_in_progress_image_task_allowed(client_factory) -> None:
    with client_factory() as client:
        task_id = _seed_image_task(client)
        delete_response = client.delete(f"/v1/image/tasks/{task_id}")
        list_response = client.get("/v1/image/tasks?limit=50")
    assert delete_response.status_code == 204
    assert all(task["task_id"] != task_id for task in list_response.json())
