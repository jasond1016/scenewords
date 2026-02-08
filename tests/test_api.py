from __future__ import annotations

import json
from pathlib import Path
from uuid import uuid4

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
                        "quality": "standard",
                        "resolution": "1280x720",
                        "duration_sec": 4,
                        "fixed_cost": 1.25,
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


def test_pricing_estimate_returns_local_config_cost(client_factory) -> None:
    with client_factory() as client:
        response = client.post(
            "/v1/pricing/estimate",
            json={
                "provider": "demo_provider",
                "model": "demo-model",
                "duration_sec": 4,
                "resolution": "1280x720",
                "quality": "standard",
            },
        )
    assert response.status_code == 200
    payload = response.json()
    assert payload["estimated_cost"] == 1.25
    assert payload["currency"] == "USD"
    assert payload["cost_source"] == "local_config"
    assert payload["pricing_version"] == "test-version"


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


def test_list_video_tasks_default_empty(client_factory) -> None:
    with client_factory() as client:
        response = client.get("/v1/video/tasks")
    assert response.status_code == 200
    assert response.json() == []


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


def test_delete_in_progress_task_rejected(client_factory) -> None:
    with client_factory() as client:
        task_id = _seed_task(client)
        delete_response = client.delete(f"/v1/video/tasks/{task_id}")
    assert delete_response.status_code == 409
    assert "cannot be deleted" in delete_response.json()["detail"]


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
