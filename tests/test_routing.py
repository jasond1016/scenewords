from __future__ import annotations

import base64
import io
import json
import time
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image

import app.main as main


@pytest.fixture
def routed_client(tmp_path, monkeypatch):
    root = Path(__file__).resolve().parents[1]
    for key, value in {
        "CONFIG": root / "config/providers.json", "PRICING_CONFIG": root / "config/pricing.json",
        "ROUTING_CONFIG": root / "config/routing.json", "DB_PATH": tmp_path / "tasks.db",
        "OUTPUT_DIR": tmp_path / "outputs", "UPLOAD_DIR": tmp_path / "uploads", "BEARER_TOKEN": "",
    }.items():
        monkeypatch.setenv(f"VIDEO_GATEWAY_{key}", str(value))
    monkeypatch.setattr(main, "STATIC_DIR", tmp_path / "static")
    buffer = io.BytesIO()
    Image.new("RGB", (32, 24), "white").save(buffer, format="PNG")
    image = buffer.getvalue()
    state = {"posts": [], "failure": None, "poll_failure": False}

    def transport(request):
        if request.method == "POST":
            state["posts"].append(request)
            failure = state["failure"]
            if failure:
                status = failure.pop(0) if isinstance(failure, list) else failure
                if status == "timeout":
                    raise httpx.ReadTimeout("upstream-secret-must-not-leak", request=request)
                if status == "unexpected":
                    raise RuntimeError("upstream-secret-must-not-leak")
                if status:
                    return httpx.Response(status, json={"error": "upstream-secret-must-not-leak"})
            if request.url.path == "/v1/videos":
                return httpx.Response(200, json={"id": "accepted-job"})
            return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(image).decode()}]})
        if state["poll_failure"]:
            return httpx.Response(503, json={"error": "upstream-secret-must-not-leak"})
        if request.url.host == "mock.invalid":
            return httpx.Response(200, content=b"")
        return httpx.Response(200, json={"status": "completed", "video_url": "https://mock.invalid/result.mp4"})

    original = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda: original(transport=httpx.MockTransport(transport)))
    with TestClient(main.create_app()) as client:
        yield client, state, image


def completed(client, task_id, kind="image"):
    for _ in range(200):
        result = client.get(f"/v1/{kind}/tasks/{task_id}").json()
        if result["status"] not in {"queued", "running"}:
            return result
        time.sleep(0.01)
    pytest.fail("Task did not finish")


def create(client, payload, kind="image"):
    response = client.post(f"/v1/{kind}/generations", json={"prompt": "asymmetric test scene", **payload})
    assert response.status_code == 200, response.text
    return completed(client, response.json()["task_id"], kind)


def test_smart_image_price_ranking_fallback_and_retry(routed_client):
    client, state, _ = routed_client
    state["failure"] = [429, None]
    scene = client.post("/v1/scenes", json={"title": "Routing versions"}).json()
    result = create(client, {"resolution": "4:5", "scene_id": scene["scene_id"]})
    assert result["status"] == "succeeded"
    assert result["model"] == "gemini-3-pro-image-preview"
    assert result["estimated_cost"] == 0.2996
    assert [a["model"] for a in result["routing"]["attempts"]] == ["gpt-image-2.5-1k", "gemini-3-pro-image-preview"]
    assert len(result["routing"]["candidates"]) + len(result["routing"]["excluded"]) == 15
    assert "upstream-secret" not in json.dumps(result)
    assert len(state["posts"]) == 2
    response = client.post(f"/v1/image/tasks/{result['task_id']}/retry", json={"routing_mode": "auto"})
    assert response.status_code == 200
    retry = completed(client, response.json()["task_id"])
    assert retry["model"] == "gpt-image-2.5-1k"
    assert retry["parent_version_id"] == result["task_id"]
    assert retry["generation_id"] == result["generation_id"]
    assert retry["version_number"] == result["version_number"] + 1
    assert retry["resolution"] == "4:5"


@pytest.mark.parametrize("status,budget,posts", [(503, 1, 1), (429, 0.02, 1), (429, 1, 2), ("timeout", 1, 1), ("unexpected", 1, 1)])
def test_no_ambiguous_resubmit_and_bounded_budget(routed_client, status, budget, posts):
    client, state, _ = routed_client
    state["failure"] = status
    result = create(client, {"routing_budget": budget})
    assert result["status"] == "failed"
    assert len(state["posts"]) == posts
    assert sum(a["cost"] for a in result["routing"]["attempts"]) <= budget
    assert "upstream-secret" not in json.dumps(result)


def test_official_hd_reference_count_format_and_tie_priority(routed_client):
    client, state, image = routed_client
    ref = client.post("/v1/files", files={"file": ("ref.png", image, "image/png")}).json()["file_id"]
    state["failure"] = [429, None]
    result = create(client, {"resolution_tier": "4k", "resolution": "9:16", "provider_options": {
        "quality": "high", "n": 3, "output_format": "webp", "background": "transparent", "image_file_ids": [ref],
    }})
    assert result["status"] == "succeeded"
    assert [a["model"] for a in result["routing"]["attempts"]] == ["gpt-image-2.5", "gpt-image-2.5-flare"]
    assert result["estimated_cost"] == 0.441
    first, second = [json.loads(r.content) for r in state["posts"]]
    assert first["size"] == "2160x3840"
    assert first["n"] == 3 and first["quality"] == "high" and first["output_format"] == "webp"
    assert first["image"].startswith("data:image/png;base64,")
    assert {k: v for k, v in first.items() if k != "model"} == {k: v for k, v in second.items() if k != "model"}


def test_edit_hd_candidate_preserves_operation_and_reference(routed_client):
    client, state, image = routed_client
    ref = client.post("/v1/files", files={"file": ("ref.png", image, "image/png")}).json()["file_id"]
    result = create(client, {"operation": "edit", "resolution": "3:4", "resolution_tier": "4k",
                             "provider_options": {"image_file_ids": [ref]}})
    assert result["status"] == "succeeded" and result["model"] == "gemini-3-pro-image-preview-4k"
    body = state["posts"][0].content
    assert b'name="image"' in body and b"image/png" in body and b"3x4" in body
    assert result["operation"] == "edit" and result["provider_options"]["image_file_ids"] == [ref]
    assert len(result["routing"]["plan"]) == 1
    assert any(e["reason"] == "price_unknown_or_currency_mismatch" for e in result["routing"]["excluded"])


@pytest.mark.parametrize("payload", [
    {"provider_options": {"quality": "impossible"}}, {"provider_options": {"api_key": "never-save-me"}},
    {"provider_options": {"model": "gpt-image-2.5"}}, {"provider_options": {"__routing": {}}},
    {"seed": 42}, {"fps": 25}, {"negative_prompt": "keep this"},
    {"operation": "edit", "resolution_tier": "4k", "provider_options": {"output_format": "webp", "image_file_ids": ["ref"]}},
    {"resolution": "4096x4096", "resolution_tier": "1k"},
])
def test_required_semantics_are_rejected_not_dropped(routed_client, payload):
    client, state, _ = routed_client
    response = client.post("/v1/image/generations", json={"prompt": "test", **payload})
    assert response.status_code == 400
    assert not state["posts"]
    assert client.get("/v1/image/tasks").json() == []


@pytest.mark.parametrize("components", [False, True])
def test_video_modes_seed_and_accepted_failure_never_resubmit(routed_client, components):
    client, state, image = routed_client
    ref = client.post("/v1/files", files={"file": ("ref.png", image, "image/png")}).json()["file_id"]
    state["poll_failure"] = True
    result = create(client, {"resolution_tier": "4k", "seed": 1234, "duration_sec": 8,
        "provider_options": {"orientation_mode": "portrait", "input_reference_file_ids" if components else "start_frame_file_id": [ref] if components else ref}}, "video")
    assert result["status"] == "failed"
    assert result["model"] == ("veo3.1-components-4k" if components else "veo3.1-4k")
    assert result["provider_job_id"] == "accepted-job" and result["resolution"] == "720x1280"
    assert len(state["posts"]) == 1 and b"1234" in state["posts"][0].content
    assert result["routing"]["stop_reason"] == "unsafe_to_resubmit"


def test_catalog_exposes_goals_without_replacing_legacy_models(routed_client):
    client, _, _ = routed_client
    catalog = client.get("/v1/models").json()
    assert sum(len(p["models"]) for p in catalog["providers"]) == 15
    assert [m["routing_goal"]["resolution_tier"] for m in catalog["routing_providers"][0]["models"]] == ["1k", "2k", "4k"]


def test_legacy_explicit_retry_and_smart_retry_preserve_hd_and_seed(routed_client):
    client, state, _ = routed_client
    first = create(client, {"provider": "veo31", "model": "veo3.1-4k", "seed": 7654}, "video")
    assert first["status"] == "succeeded"
    assert first["routing"] is None
    retry = client.post(f"/v1/video/tasks/{first['task_id']}/retry", json={"routing_mode": "auto", "retry_mode": "same_seed"})
    assert retry.status_code == 200, retry.text
    result = completed(client, retry.json()["task_id"], "video")
    assert result["status"] == "succeeded"
    assert result["model"] == "veo3.1-4k" and result["seed"] == 7654
    assert result["routing"]["goal"]["resolution_tier"] == "4k"
    assert result["routing"]["fallback_disabled_reason"] == "seed_model_specific"
    assert len(result["routing"]["plan"]) == 1
    assert len(state["posts"]) == 2


def test_async_image_reference_is_not_changed_to_sync_edit(routed_client):
    client, state, image = routed_client
    ref = client.post("/v1/files", files={"file": ("ref.png", image, "image/png")}).json()["file_id"]
    state["poll_failure"] = True
    result = create(client, {"resolution_tier": "2k", "resolution": "4:3", "provider_options": {"input_reference_file_ids": [ref]}})
    assert result["model"] == "gemini-3-pro-image-preview-2k-async"
    assert result["operation"] == "generate" and result["status"] == "failed"
    assert result["provider_job_id"] == "accepted-job"
    assert len(state["posts"]) == 1 and b'name="input_reference"' in state["posts"][0].content
    assert len(result["routing"]["plan"]) == 1


def test_restart_resumes_checkpoint_but_never_resubmits_ambiguous_job(routed_client):
    client, state, _ = routed_client
    async def queue_without_execution(task_id):
        pass
    client.app.state.worker.submit = queue_without_execution
    ids = []
    for mode in ("queued", "checkpoint", "ambiguous"):
        response = client.post("/v1/video/generations", json={"prompt": mode})
        assert response.status_code == 200
        task_id = response.json()["task_id"]
        ids.append(task_id)
        if mode == "queued":
            continue
        store = client.app.state.store
        saved = store.get_task(task_id)
        route = saved["request"]["provider_options"]["__routing"]
        route["attempts"].append({**route["plan"][0], "status": "submitting"})
        store.update_execution(task_id, saved["request"], saved["estimated_cost"])
        store.set_status(task_id, "running")
        if mode == "checkpoint":
            store.set_provider_progress(task_id, provider_job_id="accepted-job", provider_query_endpoint="https://api.tu-zi.com/v1/videos/accepted-job")
    with TestClient(main.create_app()) as restarted:
        queued, resumed, ambiguous = [completed(restarted, task_id, "video") for task_id in ids]
        assert queued["status"] == "succeeded", queued["error"]
        assert resumed["status"] == "succeeded", resumed["error"]
        assert len(resumed["routing"]["attempts"]) == 1
        assert ambiguous["status"] == "failed" and ambiguous["error"]["code"] == "worker_interrupted"
        assert len(state["posts"]) == 1
