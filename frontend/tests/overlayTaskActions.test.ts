import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { fetchCatalog } from "../src/api";
import { getImageResizeOptions, submitImageEdit, submitImageResize } from "../src/overlayTaskActions";
import type { ProviderCatalogResponse, ProviderModelOperationInfo, VideoTaskDetail } from "../src/types";

const task: VideoTaskDetail = {
  task_id: "source/17", status: "succeeded", asset_type: "image",
  provider: "test", model: "image-model", operation: "custom",
  scene_id: "scene-2", scene_title: "Scene", generation_id: "generation-3",
  parent_version_id: null, version_number: 2, adopted_version_id: null,
  task_stage: "draft", final_source_task_id: null, queue_position: null,
  created_at: "", updated_at: "", prompt: "Original scene", negative_prompt: null,
  duration_sec: null, resolution: null, fps: null, seed: 19,
  provider_options: {
    image_file_ids: ["old"], input_reference_file_ids: ["old"], image: "old",
    images: ["old"], input_references: ["old"], mask_file_id: "old-mask", quality: "high",
  },
  subject_bindings: [], estimated_cost: null, actual_cost: null, currency: null,
  cost_source: "unknown", result: null, error: null,
};

function operation(id: string, referenceKey: string): ProviderModelOperationInfo {
  const field = {
    label: "", required: false, default: null, placeholder: null, help_text: null,
    min: null, max: null, step: null, options: [],
  };
  return {
    id, display_name: id, description: null, is_default: false,
    fields: [
      { ...field, key: referenceKey, target: "provider_options", input_type: "file_list" },
      { ...field, key: "resolution", target: "request", input_type: "select",
        default: "1536x1024", options: [{ value: "3072x2048", label: "3K" }] },
    ],
  };
}

function catalog(operations: ProviderModelOperationInfo[]): ProviderCatalogResponse {
  return { providers: [{
    id: "test", display_name: "Test", type: "tuzi_image", supports_custom_endpoint: false,
    models: [{ name: "image-model", display_name: "Image", is_default: true, operations }],
  }] };
}

function mockFetch(t: TestContext, responses: Response[]) {
  const calls: { path: string; init: RequestInit }[] = [];
  t.mock.method(globalThis, "fetch", async (path: string, init: RequestInit) => {
    calls.push({ path, init });
    const response = responses.shift();
    assert.ok(response, `Unexpected request: ${path}`);
    return response;
  });
  return calls;
}

for (const selected of ["edit", "custom", "generate"]) {
  test(`image edit selects ${selected} and replaces stale references`, async (t) => {
    const operations = [operation("generate", "input_reference_file_ids")];
    if (selected !== "generate") operations.push(operation("custom", "image_file_ids"));
    // An edit operation without a supported reference must not mask a valid fallback.
    operations.push(operation("edit", selected === "edit" ? "image_file_ids" : "other_files"));
    const calls = mockFetch(t, [Response.json({ file_id: "new-reference" }), Response.json({ task_id: "new-task" })]);
    await submitImageEdit({ task, imageIndex: 2, instruction: "  Change lighting  ", catalog: catalog(operations) }, " token ");
    assert.deepEqual(calls.map((call) => call.path), [
      "/v1/image/tasks/source%2F17/outputs/2/file", "/v1/image/generations",
    ]);
    const submitted = JSON.parse(String(calls[1].init.body));
    assert.equal(submitted.operation, selected);
    assert.deepEqual(submitted.provider_options, {
      quality: "high", [selected === "generate" ? "input_reference_file_ids" : "image_file_ids"]: ["new-reference"],
    });
    assert.equal(submitted.resolution, "1536x1024");
    assert.equal(submitted.scene_id, "scene-2");
    assert.equal(submitted.generation_id, "generation-3");
    assert.equal(submitted.parent_version_id, "source/17");
    assert.match(submitted.prompt, /Original scene/);
    assert.match(submitted.prompt, /Modification request:\nChange lighting$/);
    assert.equal(new Headers(calls[0].init.headers).get("Authorization"), "Bearer token");
    assert.deepEqual(task.provider_options.image_file_ids, ["old"]);
  });
}

test("resize creates a scene when absent and preserves explicit resolution", async (t) => {
  const capabilities = catalog([operation("generate", "input_reference_file_ids")]);
  assert.deepEqual(getImageResizeOptions(task, capabilities), [{ value: "3072x2048", label: "3K" }]);
  const calls = mockFetch(t, [Response.json({ file_id: "ref" }), Response.json({ scene_id: "new-scene" }), Response.json({})]);
  await submitImageResize({ task: { ...task, scene_id: null }, imageIndex: 0,
    resolution: "3072x2048", resolutionLabel: "3K", catalog: capabilities }, "");
  assert.equal(calls[1].path, "/v1/scenes");
  const submitted = JSON.parse(String(calls[2].init.body));
  assert.equal(submitted.resolution, "3072x2048");
  assert.equal(submitted.scene_id, "new-scene");
  assert.equal(submitted.generation_id, null);
  assert.equal(submitted.parent_version_id, null);
});

test("unsupported references fail before upload or task creation", async (t) => {
  const calls = mockFetch(t, []);
  await assert.rejects(submitImageEdit({ task, imageIndex: 0, instruction: "Edit",
    catalog: catalog([operation("edit", "other_files")]) }, ""), /does not support editing/);
  assert.equal(calls.length, 0);
});

test("reference import failure prevents scene and generation requests", async (t) => {
  const calls = mockFetch(t, [Response.json({ detail: "Reference expired" }, { status: 410 })]);
  await assert.rejects(submitImageEdit({ task: { ...task, scene_id: null }, imageIndex: 0,
    instruction: "Edit", catalog: catalog([operation("edit", "image_file_ids")]) }, ""), /Reference expired/);
  assert.equal(calls.length, 1);
});

for (const [body, message] of [
  ['{"detail":"Denied"}', "Denied"],
  ['{"detail":{"reason":"invalid","fields":["model"]}}', '{"reason":"invalid","fields":["model"]}'],
  ['{"detail":null}', "HTTP 400"],
  ["not JSON", "HTTP 400"],
  [`{"detail":${"[".repeat(10000)}0${"]".repeat(10000)}}`, "HTTP 400"],
]) {
  test(`API error preserves ${message}`, async (t) => {
    mockFetch(t, [new Response(body, { status: 400 })]);
    await assert.rejects(fetchCatalog(""), { message });
  });
}
