import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fetchCatalog } from "../src/api";
import { prepareMediaFile, shareMedia } from "../src/mediaExport";
import { MediaDetailSidebar } from "../src/components/MediaDetailSidebar";
import { MediaOverlayResizeComposer } from "../src/components/MediaOverlayActions";
import { SessionImage } from "../src/components/SessionImage";
import {
  getImageResizeOptions,
  runRetryTask,
  submitHighResolutionCandidate,
  submitImageEdit,
  submitImageResize,
} from "../src/overlayTaskActions";
import type { ProviderCatalogResponse, ProviderModelOperationInfo, VideoTaskDetail } from "../src/types";

const task: VideoTaskDetail = {
  task_id: "source/17", status: "succeeded", asset_type: "image",
  provider: "test", model: "image-model", operation: "custom",
  scene_id: "scene-2", scene_title: "Scene", generation_id: "generation-3",
  parent_version_id: null, version_number: 2,
  queue_position: null,
  created_at: "", updated_at: "", prompt: "Original scene", negative_prompt: null,
  duration_sec: null, resolution: null, fps: null, seed: 19,
  provider_options: {
    image_file_ids: ["old"], input_reference_file_ids: ["old"], image: "old",
    images: ["old"], input_references: ["old"], mask_file_id: "old-mask", quality: "high",
    api_key: "old-key", timeout_sec: 300, response_format: "b64_json", moderation: "low", watermark: true,
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

test("regeneration retries the whole source image request without importing a result image", async (t) => {
  const calls = mockFetch(t, [Response.json({ task_id: "regenerated-task", scene_id: "scene-2" })]);
  const source = { ...task, provider_options: { ...task.provider_options, n: 3 } };
  const response = await runRetryTask({ task: source, mode: "new_seed" }, " token ");
  assert.equal(response.task_id, "regenerated-task");
  assert.deepEqual(calls.map((call) => call.path), ["/v1/image/tasks/source%2F17/retry"]);
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
    retry_mode: "new_seed", prompt: "Original scene",
  });
  assert.equal(new Headers(calls[0].init.headers).get("Authorization"), "Bearer token");
  assert.deepEqual(source.provider_options.image_file_ids, ["old"]);
  assert.equal(source.provider_options.n, 3);
});

for (const assetType of ["image", "video"] as const) {
  test(`failed ${assetType} retry preserves the source prompt and seed mode`, async (t) => {
    const calls = mockFetch(t, [Response.json({ task_id: "retried-task", scene_id: "scene-2" })]);
    const source: VideoTaskDetail = { ...task, asset_type: assetType, status: "failed", prompt: "失败任务的原始提示词" };
    await runRetryTask({ task: source, mode: "same_seed" }, "");
    assert.deepEqual(calls.map((call) => call.path), [`/v1/${assetType}/tasks/source%2F17/retry`]);
    assert.equal(calls[0].init.method, "POST");
    assert.deepEqual(JSON.parse(String(calls[0].init.body)), {
      retry_mode: "same_seed", prompt: "失败任务的原始提示词",
    });
    assert.equal(source.seed, 19);
    assert.deepEqual(source.provider_options.image_file_ids, ["old"]);
  });
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
      response_format: "url", moderation: "auto", watermark: false,
    });
    assert.equal(submitted.resolution, "1536x1024");
    assert.equal(submitted.scene_id, "scene-2");
    assert.equal(submitted.generation_id, "generation-3");
    assert.equal(submitted.parent_version_id, "source/17");
    assert.match(submitted.prompt, /Original scene/);
    assert.match(submitted.prompt, /Modification request:\nChange lighting$/);
    assert.equal(new Headers(calls[0].init.headers).get("Authorization"), "Bearer token");
    assert.deepEqual(task.provider_options.image_file_ids, ["old"]);
    assert.equal(task.provider_options.response_format, "b64_json");
    assert.equal(task.provider_options.mask_file_id, "old-mask");
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

test("ratio resize preserves the API value and mapped label without changing model quality", async (t) => {
  const edit = operation("edit", "image_file_ids");
  edit.fields.find((field) => field.key === "resolution")!.options = [
    { value: "16:9", label: "16:9 (1672x941)" },
  ];
  const capabilities = catalog([edit]);
  const option = getImageResizeOptions(task, capabilities)[0];
  const calls = mockFetch(t, [Response.json({ file_id: "ratio-reference" }), Response.json({ task_id: "ratio-task" })]);
  await submitImageResize({ task, imageIndex: 2, resolution: option.value,
    resolutionLabel: option.label, catalog: capabilities }, "");
  const submitted = JSON.parse(String(calls[1].init.body));
  assert.equal(submitted.resolution, "16:9");
  assert.match(submitted.prompt, /Requested output size: 16:9 \(1672x941\)$/);
  assert.deepEqual(submitted.provider_options, {
    quality: "high", image_file_ids: ["ratio-reference"], response_format: "url", moderation: "auto", watermark: false,
  });
  assert.equal(submitted.model, task.model);
  assert.equal(submitted.parent_version_id, task.task_id);
  assert.equal(calls[0].path, "/v1/image/tasks/source%2F17/outputs/2/file");
});

test("resize ratio choices render true-scale outlined icons, unlike pixel presets", () => {
  const ratios = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "16:9", "9:16", "21:9", "9:21"];
  const edit = operation("edit", "image_file_ids");
  const field = edit.fields.find((field) => field.key === "resolution")!;
  const render = () => renderToStaticMarkup(createElement(MediaOverlayResizeComposer, {
    task, catalog: catalog([edit]), loading: false, catalogError: false,
    onReload: () => undefined, pending: false, disabled: false, onSubmit: () => undefined,
  }));
  field.options = ratios.map((value) => ({ value, label: `${value} (target pixels)` }));
  const choices = [...render().matchAll(/<label>(.*?)<\/label>/gs)].map((match) => match[1]);
  assert.equal(choices.length, ratios.length);
  for (const [index, choice] of choices.entries()) {
    assert.match(choice, new RegExp(`<span>${ratios[index]}</span>`));
    assert.ok(!choice.includes("target pixels"));
    const svg = choice.match(/<svg[^>]*>/)![0];
    assert.match(svg, /aria-hidden="true"/);
    assert.match(svg, /fill="none"/);
    const rect = choice.match(/<rect[^>]*>/)![0];
    const width = Number(rect.match(/width="([^"]+)"/)![1]);
    const height = Number(rect.match(/height="([^"]+)"/)![1]);
    const [horizontal, vertical] = ratios[index].split(":").map(Number);
    assert.ok(Math.abs(width * vertical - height * horizontal) < 1e-8, ratios[index]);
    assert.equal(Math.max(width, height), 24);
    assert.ok(Math.min(width, height) >= 10, "extreme ratios remain visible");
    assert.equal(Number(rect.match(/x="([^"]+)"/)![1]) + width / 2, 16);
    assert.equal(Number(rect.match(/y="([^"]+)"/)![1]) + height / 2, 16);
  }
  field.options = [{ value: "2048x1152", label: "2K" }];
  const pixelChoice = render().match(/<label>(.*?)<\/label>/s)![1];
  assert.match(pixelChoice, /2048 × 1152/);
  assert.ok(!pixelChoice.includes("<svg"));
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

test("details show the user's latest modification and honest request dimensions/cost without diagnostic clutter", async (t) => {
  const capabilities = catalog([operation("edit", "image_file_ids")]);
  const calls = mockFetch(t, [Response.json({ file_id: "reference" }), Response.json({ task_id: "edited" })]);
  await submitImageEdit({ task, imageIndex: 0, instruction: "Warm lighting\nKeep the blue vase", catalog: capabilities }, "");
  const prompt = JSON.parse(String(calls[1].init.body)).prompt;
  const render = (overrides: Partial<VideoTaskDetail>) => renderToStaticMarkup(createElement(MediaDetailSidebar, {
    task: { ...task, prompt, resolution: "1536x1000", actual_cost: 0.14, estimated_cost: 0.2, currency: "USD", cost_source: "provider_api", ...overrides },
    catalog: capabilities, downloadUrl: "/image.png", statusLabel: "Succeeded", updatedAtLabel: "Yesterday",
    onReuse() {}, onDelete() {},
  }));
  const html = render({});
  assert.match(html, /Warm lighting\s+Keep the blue vase/);
  assert.match(html, /本次修改|This modification/);
  assert.match(render({ prompt: "A quiet scene" }), /我的描述|My description/);
  assert.match(html, /<dd>Image<\/dd>/);
  assert.match(html, /192:125/);
  assert.match(html, /1536 × 1000/);
  assert.match(html, /实际费用|Actual cost/);
  assert.match(html, /0\.14/);
  for (const hidden of ["Original scene", "Modification request:", "source/17", "Yesterday", "Diagnostics", "诊断信息", "Raw Result", "原始结果", "N/A", "Succeeded", "0.2"]) {
    assert.ok(!html.includes(hidden), `Not default detail content: ${hidden}`);
  }
  const estimated = render({ actual_cost: null, resolution: "16:9" });
  assert.match(estimated, /预估费用|Estimated cost/);
  assert.match(estimated, /16:9/);
  assert.doesNotMatch(estimated, /目标尺寸|Target size/, "a ratio is not an actual or inferred pixel size");
  const localSettlement = render({ cost_source: "local_config" });
  assert.match(localSettlement, /预估费用|Estimated cost/);
  assert.doesNotMatch(localSettlement, /实际费用|Actual cost/, "settled local estimates are not provider-reported charges");
  assert.match(render({ cost_source: "unknown" }), /参考费用|Indicative cost/);
  const unknown = render({ resolution: "auto", actual_cost: null, estimated_cost: null });
  assert.doesNotMatch(unknown, /目标尺寸|Target size|N\/A/);
});

test("high-resolution candidate submits Sunburst edit with source size and preservation options", async (t) => {
  const capabilities: ProviderCatalogResponse = {
    providers: [{
      id: "sunburst-provider",
      display_name: "Sunburst",
      type: "tuzi_image",
      supports_custom_endpoint: false,
      models: [{
        name: "gpt-image-2.5-sunburst",
        display_name: "GPT Image 2.5 Sunburst",
        is_default: false,
        operations: [operation("edit", "image_file_ids")],
      }],
    }],
  };
  const calls = mockFetch(t, [
    Response.json({ file_id: "candidate-source" }),
    Response.json({ task_id: "candidate-task" }),
  ]);
  const response = await submitHighResolutionCandidate({
    task: { ...task, resolution: "2800x1260" },
    imageIndex: 2,
    catalog: capabilities,
  }, "token");

  assert.equal(response.task_id, "candidate-task");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].path, "/v1/image/tasks/source%2F17/outputs/2/file");
  assert.equal(calls[1].path, "/v1/image/generations");
  const submitted = JSON.parse(String(calls[1].init.body));
  assert.equal(submitted.provider, "sunburst-provider");
  assert.equal(submitted.model, "gpt-image-2.5-sunburst");
  assert.equal(submitted.operation, "edit");
  assert.equal(submitted.resolution, "2800x1260");
  assert.deepEqual(submitted.provider_options, {
    image_file_ids: ["candidate-source"],
    quality: "xhigh",
    background: "auto",
    output_format: "png",
    input_fidelity: "high",
    response_format: "url", moderation: "auto", watermark: false,
  });
  assert.match(submitted.prompt, /Create a high-resolution candidate/);
  assert.match(submitted.prompt, /Small visual differences may occur/);
  assert.match(submitted.prompt, /Original brief for context only/);
  assert.equal(submitted.scene_id, task.scene_id);
  assert.equal(submitted.generation_id, task.generation_id);
  assert.equal(submitted.parent_version_id, task.task_id);
});

test("high-resolution candidate creates a scene for standalone images", async (t) => {
  const capabilities: ProviderCatalogResponse = {
    providers: [{
      id: "sunburst-provider",
      display_name: "Sunburst",
      type: "tuzi_image",
      supports_custom_endpoint: false,
      models: [{
        name: "gpt-image-2.5-sunburst",
        display_name: "GPT Image 2.5 Sunburst",
        is_default: false,
        operations: [operation("edit", "image_file_ids")],
      }],
    }],
  };
  const calls = mockFetch(t, [
    Response.json({ file_id: "candidate-source" }),
    Response.json({ scene_id: "new-scene" }),
    Response.json({ task_id: "candidate-task" }),
  ]);
  await submitHighResolutionCandidate({
    task: { ...task, scene_id: null, generation_id: null },
    imageIndex: 0,
    catalog: capabilities,
  }, "");
  assert.deepEqual(calls.map((call) => call.path), [
    "/v1/image/tasks/source%2F17/outputs/0/file",
    "/v1/scenes",
    "/v1/image/generations",
  ]);
  const submitted = JSON.parse(String(calls[2].init.body));
  assert.equal(submitted.scene_id, "new-scene");
  assert.equal(submitted.generation_id, null);
  assert.equal(submitted.parent_version_id, null);
});

test("high-resolution candidate fails before importing when Sunburst edit is unavailable", async (t) => {
  const calls = mockFetch(t, []);
  await assert.rejects(
    submitHighResolutionCandidate({ task, imageIndex: 0, catalog: catalog([]) }, ""),
    /Sunburst editing is not available/,
  );
  assert.equal(calls.length, 0);
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

test("export preserves original file bytes and MIME type, and rejects failed downloads", async (t) => {
  mockFetch(t, [new Response(new Uint8Array([137, 80, 78, 71, 13, 10]), { headers: { "Content-Type": "image/png" } }), new Response("Denied", { status: 403 })]);
  const file = await prepareMediaFile("/result.png", task, new AbortController().signal);
  assert.equal(file.type, "image/png");
  assert.match(file.name, /\.png$/);
  assert.deepEqual([...new Uint8Array(await file.arrayBuffer())], [137, 80, 78, 71, 13, 10]);
  await assert.rejects(prepareMediaFile("/denied.png", task, new AbortController().signal), /HTTP 403/);
});

test("session media uses target proportions across states without mistaking references for generated results", () => {
  const render = (overrides: Partial<VideoTaskDetail>, src = "/reference.png") => renderToStaticMarkup(createElement(SessionImage, {
    task: { ...task, ...overrides }, src, statusLabel: "Generating",
  }));
  for (const status of ["failed", "queued", "running", "canceled"] as const) {
    const html = render({ status, resolution: "9:16" });
    assert.doesNotMatch(html, /<img|<video|reference\.png/, "uncompleted tasks must never display real/reference media");
    assert.equal(Number(html.match(/aspect-ratio:([\d.]+)/)?.[1]), 9 / 16);
    if (status === "failed") assert.match(html, /未生成图片|No image generated/);
  }
  const video = render({ asset_type: "video", status: "failed", resolution: null });
  assert.match(video, /未生成视频|No video generated/);
  assert.equal(Number(video.match(/aspect-ratio:([\d.]+)/)?.[1]), 4 / 3, "unknown target ratios use the same neutral fallback for both media kinds");
  assert.match(render({ status: "succeeded", resolution: "16:9" }, "/result.png"), /<img[^>]*src="\/result.png"/);
  assert.match(render({ status: "succeeded", asset_type: "video", resolution: "16:9" }, "/result.mp4"), /<video[^>]*src="\/result.mp4"[^>]*controls=""/);
  for (const [provider_options, expected] of [
    [{ size: "1536x1024" }, 3 / 2], [{ aspect_ratio: "3:4" }, 3 / 4],
    [{ orientation: "portrait" }, 9 / 16], [{ width: 800, height: 500 }, 8 / 5],
  ] as const) {
    assert.equal(Number(render({ status: "failed", resolution: null, provider_options }).match(/aspect-ratio:([\d.]+)/)?.[1]), expected);
  }
});

test("export shares files or absolute URLs, copies only on unsupported sharing, and distinguishes cancellation from real failures", async (t) => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  t.after(() => {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { href: "https://studio.test/create" } } });
  const file = new File(["image bytes"], "portrait.png", { type: "image/png" });
  let shared: ShareData | undefined;
  let copied: string | undefined;
  let complete: (() => void) | undefined;
  let handedOff = false;
  const browser = {
    canShare: (data: ShareData) => !!data.files,
    share: async (data: ShareData) => { shared = data; await new Promise<void>((resolve) => { complete = resolve; }); },
    clipboard: { writeText: async (value: string) => { copied = value; } },
  };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: browser });
  const result = shareMedia("/result.png", "My image", file, () => { handedOff = true; });
  assert.equal(handedOff, true, "preparation ends when handed to the browser, not when the user closes its sheet");
  assert.equal(shared?.files?.[0], file);
  assert.equal(shared?.title, "My image");
  complete!();
  assert.equal(await result, "shared");
  assert.equal(copied, undefined);

  browser.canShare = (data) => !!data.url;
  browser.share = async (data) => { shared = data; };
  assert.equal(await shareMedia("/result.png", "URL only", file, () => {}), "shared");
  assert.deepEqual(shared, { title: "URL only", url: "https://studio.test/result.png" });
  browser.canShare = () => false;
  assert.equal(await shareMedia("/result.png", "Copy", file, () => {}), "copied");
  assert.equal(copied, "https://studio.test/result.png");
  copied = undefined;

  browser.canShare = () => true;
  for (const name of ["AbortError", "NotAllowedError", "DataError"]) {
    browser.share = async () => { throw new DOMException("Native failure", name); };
    if (name === "AbortError") assert.equal(await shareMedia("/result.png", "Cancel", file, () => {}), "canceled");
    else await assert.rejects(shareMedia("/result.png", "Failure", file, () => {}), { name });
    assert.equal(copied, undefined, "native rejection must not silently become a link-copy success");
  }
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: browser.clipboard } });
  assert.equal(await shareMedia("/result.png", "No Web Share", null, () => {}), "copied");
  assert.equal(copied, "https://studio.test/result.png");
  browser.clipboard.writeText = async () => { throw new DOMException("Clipboard denied", "NotAllowedError"); };
  await assert.rejects(shareMedia("/result.png", "Denied", null, () => {}), { name: "NotAllowedError" });
});
