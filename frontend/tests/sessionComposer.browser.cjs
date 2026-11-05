// Run against a built Vite preview. All /v1 traffic is intercepted: no real
// database, gateway credentials, imports or upstream generation is used.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

const base = "http://127.0.0.1:4197";
const server = spawn(process.execPath, [path.resolve(__dirname, "../node_modules/vite/bin/vite.js"),
  "preview", "--base", "/", "--host", "127.0.0.1", "--port", "4197", "--strictPort"], { cwd: path.resolve(__dirname, ".."), stdio: "pipe" });
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
const field = (key, target, input_type, extra = {}) => ({ key, label: key, target, input_type,
  required: false, default: null, placeholder: null, help_text: null, min: null, max: null, step: null, options: [], ...extra });
const fields = [field("prompt", "request", "textarea", { required: true }),
  field("resolution", "request", "select", { required: true, default: "16:9", options: ["16:9", "9:16"].map(value => ({ value, label: value })) }),
  field("image_file_ids", "provider_options", "file_list"),
  field("output_format", "provider_options", "select", { options: ["", "png", "webp"].map(value => ({ value, label: value || "Default" })) })];
const operations = ["generate", "edit"].map(id => ({ id, display_name: id, description: "", is_default: id === "generate", fields }));
const provider = { id: "auto-image", type: "tuzi_image", display_name: "Smart", supports_custom_endpoint: false,
  models: ["1k", "2k", "4k"].map((tier, i) => ({ name: `auto-image-${tier}`, display_name: tier.toUpperCase(), is_default: !i,
    routing_goal: { resolution_tier: tier }, operations })) };
const videoProvider = { ...provider, id: "auto-video", type: "tuzi_veo", models: [{ name: "auto-video-720p", display_name: "720P",
  is_default: true, routing_goal: { resolution_tier: "720p" }, operations: [{ id: "generate", display_name: "Video", is_default: true,
    fields: [fields[0], field("duration_sec", "request", "number", { default: 8, required: true, min: 1, max: 20 }),
      field("resolution", "request", "select", { default: "1280x720", required: true, options: [{ value: "1280x720", label: "Landscape" }] })] }] }] };
const catalog = { providers: [{ ...provider, id: "fixture-provider", models: [{ name: "gemini-3-pro-image-preview", display_name: "Fixture", is_default: true, operations }] }],
  routing_providers: [provider, videoProvider], max_upload_bytes: 10485760 };
const time = "2026-10-01T10:00:00Z";
const scene = (id, title) => ({ scene_id: id, title, description: "", generation_count: 1, version_count: 1, created_at: time, updated_at: time });
const scenes = [scene("a", "花瓶的配色迭代"), scene("b", "客厅灯光实验"), scene("v", "视频分镜")];
const task = (id, sceneId, prompt, status = "succeeded") => ({ task_id: id, scene_id: sceneId, scene_title: scenes.find(s => s.scene_id === sceneId)?.title,
  generation_id: `g-${sceneId}`, parent_version_id: null, version_number: 1, status, asset_type: "image", provider: "fixture-provider", model: "gemini-3-pro-image-preview",
  operation: "generate", created_at: time, updated_at: time, queue_position: null, prompt, negative_prompt: null, duration_sec: null, resolution: "16:9", fps: null, seed: null,
  provider_options: {}, subject_bindings: [], estimated_cost: null, actual_cost: null, currency: "USD", cost_source: "unknown",
  result: status === "succeeded" ? { local_image_urls: [`/fixture.png?${id}-0`, `/fixture.png?${id}-1`] } : null, error: null });
const tasks = [task("old-a", "a", "已发送的旧提示词 A"), task("old-b", "b", "已发送的旧提示词 B")];
tasks.push({ ...task("old-v", "v", "旧视频描述", "failed"), asset_type: "video", provider: "auto-video", model: "auto-video-720p", resolution: "1280x720", duration_sec: 8 });
const settingsKey = "scenewords_gateway_settings_v1";
const writes = [];
let nextSubmit, nextScene;
let listGate, mediaGate, sceneFailure, listFailure;
const sceneGates = new Map();
const reads = [];
const failures = [];
let browser;
async function until(check, label) {
  let error;
  for (let i = 0; i < 100; i++) {
    try { await check(); return; } catch (e) { error = e; await new Promise(resolve => setTimeout(resolve, 60)); }
  }
  throw new Error(`${label}: ${error?.message}`);
}
async function fixture(context) {
  await context.route("**/*", route => new URL(route.request().url()).origin === base ? route.fallback() : route.abort());
  await context.route("**/static/**", route => route.continue({ url: route.request().url().replace("/static/", "/") }));
  await context.route("**/fixture.png*", async route => {
    if (mediaGate) await mediaGate;
    await route.fulfill({ contentType: "image/png", body: png });
  });
  await context.route("**/v1/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const p = url.pathname;
    const json = body => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    if (request.method() === "POST") {
      writes.push({ path: p, body: p === "/v1/files" ? null : request.postDataJSON() });
      if (p.endsWith("/generations")) {
        if (nextSubmit) { const callback = nextSubmit; nextSubmit = null; return callback(route, json); }
        return json(task(`new-${writes.length}`, request.postDataJSON().scene_id, request.postDataJSON().prompt, "queued"));
      }
      if (p === "/v1/scenes") return json(scene("new-scene", "New chat"));
      if (p.includes("/outputs/") || p === "/v1/files") return json({ file_id: "explicit-file", original_name: "reference.png", mime_type: "image/png", size_bytes: png.length, url: "/v1/files/explicit-file" });
      throw new Error(`Unexpected write ${p}`);
    }
    reads.push({ path: p, token: request.headers().authorization, at: Date.now() });
    if (p === "/v1/models") return json(catalog);
    if (p === "/v1/scenes") {
      if (listGate) await listGate;
      if (listFailure) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "History unavailable" }) });
      return json(scenes);
    }
    if (p.startsWith("/v1/scenes/")) {
      if (nextScene) { const callback = nextScene; nextScene = null; await callback(); }
      const id = p.split("/").at(-1);
      if (sceneGates.has(id)) await sceneGates.get(id);
      if (sceneFailure === id) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ detail: "Scene unavailable" }) });
      return json({ ...(scenes.find(s => s.scene_id === id) || scene(id, "New chat")), generations: [{ generation_id: `g-${id}`, asset_type: "image", created_at: time, versions: tasks.filter(t => t.scene_id === id) }] });
    }
    if (p.startsWith("/v1/files/")) return route.fulfill({ contentType: "image/png", body: png });
    if (p === "/v1/tasks/summary") return json({ total_tasks: 2, total_estimated_cost: 0, total_actual_cost: 0 });
    if (/\/tasks\//.test(p)) return json(tasks.find(t => p.endsWith(t.task_id)) || tasks[0]);
    if (p.endsWith("/tasks")) return json(tasks.filter(task => p.includes(task.asset_type)));
    if (p === "/v1/subjects") return json([]);
    throw new Error(`Unexpected read ${p}`);
  });
}
async function selectSession(page, id) {
  await page.getByRole("button", { name: "展开会话历史", exact: true }).click();
  await page.locator(".session-sidebar-item").filter({ hasText: scenes.find(s => s.scene_id === id).title }).click();
}
async function open(page, id) {
  await selectSession(page, id);
  await until(async () => assert.equal(await page.locator(".session-sidebar").count(), 0), "history closed");
  await until(async () => assert.equal(await page.locator(".composer-textarea").count(), 1), "composer ready");
}
const value = page => page.locator(".composer-textarea").inputValue();
const fill = (page, text) => page.locator(".composer-textarea").fill(text);
const send = page => page.locator(".composer-submit").click();
async function expectValue(page, text) { await until(async () => assert.equal(await value(page), text), `draft ${text}`); }
const pass = name => process.stdout.write(`PASS ${name}\n`);
async function capture(page, name) {
  if (!process.env.UI_ARTIFACTS) return;
  fs.mkdirSync(process.env.UI_ARTIFACTS, { recursive: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} no horizontal overflow`);
  await page.screenshot({ path: path.join(process.env.UI_ARTIFACTS, `${name}.png`), animations: "disabled" });
}

(async () => {
  await until(async () => assert.equal((await fetch(base)).status, 200), "Vite preview starts");
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge", headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  context.setDefaultTimeout(3000);
  await fixture(context);
  const page = await context.newPage();
  page.on("pageerror", error => failures.push(error.message));
  await context.addInitScript(key => {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, JSON.stringify({ version: 4, state: { language: "zh-CN", theme: "light", restoreLastSession: true, defaultRatio: "9:16",
      providerDefaults: { "auto-image": { defaultRatio: "9:16", defaultDurationSec: 8, defaultQuality: "standard", defaultOutputFormat: "webp" } } } }));
    localStorage.setItem("scenewords_field_v3__auto-image__auto-image-1k__generate__request__prompt", "不应复活的旧缓存");
    localStorage.setItem("scenewords_last_session_v3", JSON.stringify({ image: { provider: "auto-image", model: "auto-image-1k", prompt: "不应恢复的快照" } }));
  }, settingsKey);
  // A cold deep link must not wait for the history index, IndexedDB or images.
  let releaseList, releaseColdScene, releaseMedia;
  listGate = new Promise(resolve => { releaseList = resolve; });
  mediaGate = new Promise(resolve => { releaseMedia = resolve; });
  sceneGates.set("a", new Promise(resolve => { releaseColdScene = resolve; }));
  await page.goto(`${base}/#/create?sceneId=a`, { waitUntil: "domcontentloaded" });
  await until(() => assert.ok(reads.some(read => read.path === "/v1/scenes/a")), "detail starts while index held");
  assert.equal(await page.locator(".session-transcript").getAttribute("aria-busy"), "true");
  assert.equal(await page.locator(".composer-submit").count(), 0);
  await capture(page, "cold-loading");
  await page.keyboard.press("Control+Enter"); assert.equal(writes.length, 0);
  sceneGates.delete("a"); releaseColdScene();
  await expectValue(page, "");
  assert.equal(await page.locator(".session-transcript").getAttribute("aria-busy"), "false");
  assert.ok(await page.locator('.session-image[data-state="loading"]').count());
  await capture(page, "image-loading");
  assert.equal(reads.filter(read => read.path === "/v1/scenes/a").length, 1, "single owned scene request");
  mediaGate = null; releaseMedia(); listGate = null; releaseList();
  pass("cold scene opens before history index/images; unknown context cannot submit; one detail request");

  await fill(page, "navigation A draft");
  let releaseB;
  sceneGates.set("b", new Promise(resolve => { releaseB = resolve; }));
  await selectSession(page, "b");
  assert.ok(page.url().endsWith("sceneId=b"));
  assert.equal(await page.locator(".session-sidebar").count(), 0);
  assert.equal(await page.locator(".session-transcript").evaluate(el => el === document.activeElement), true, "focus enters target, not removed history item");
  assert.equal(await page.locator(".session-transcript").getAttribute("aria-busy"), "true");
  assert.equal(await page.getByText(tasks[0].prompt, { exact: true }).count(), 0, "never shows A in B");
  assert.equal(await page.locator(".composer-textarea").count(), 0, "cannot edit wrong-kind draft before context");
  await page.getByRole("button", { name: "展开会话历史", exact: true }).click();
  assert.ok((await page.locator('.session-sidebar-item[aria-current="page"]').innerText()).includes(scenes[1].title));
  await page.locator(".session-sidebar-item").filter({ hasText: scenes[0].title }).click();
  await expectValue(page, "navigation A draft");
  assert.ok((await page.locator(".session-transcript").innerText()).includes(tasks[0].prompt));
  sceneFailure = "b"; sceneGates.delete("b"); releaseB();
  await page.goBack();
  await page.getByRole("alert").filter({ hasText: "Scene unavailable" }).waitFor();
  await capture(page, "scene-error");
  assert.ok(page.url().endsWith("sceneId=b"));
  assert.equal(await page.locator(".composer-submit").count(), 0);
  assert.equal(await page.getByText(tasks[0].prompt, { exact: true }).count(), 0);
  sceneFailure = null;
  await page.getByRole("alert").getByRole("button", { name: "重试", exact: true }).click();
  await expectValue(page, ""); await fill(page, "navigation B draft");
  await page.goForward(); await expectValue(page, "navigation A draft");
  const bReads = reads.filter(read => read.path === "/v1/scenes/b").length;
  await open(page, "b"); await expectValue(page, "navigation B draft");
  await capture(page, "cached-session");
  assert.equal(reads.filter(read => read.path === "/v1/scenes/b").length, bReads, "fresh scene cache avoids duplicate request");
  pass("immediate selection, A → B → A, back/forward, scoped cache, inline failure/retry and drafts");

  await context.setOffline(true);
  await page.evaluate(() => { location.hash = "/create?sceneId=offline"; });
  await page.getByRole("alert").filter({ hasText: "网络已断开" }).waitFor();
  await capture(page, "offline");
  assert.equal(await page.locator(".composer-submit").count(), 0);
  assert.equal(await page.getByText(tasks[1].prompt, { exact: true }).count(), 0);
  await page.keyboard.press("Control+Enter"); assert.equal(writes.length, 0);
  sceneFailure = "offline"; await context.setOffline(false);
  await page.getByRole("alert").waitFor();
  await page.getByRole("button", { name: "新建会话", exact: true }).click();
  await expectValue(page, "");
  assert.equal(await page.locator(".session-transcript").count(), 0);
  sceneFailure = null;
  let releaseUnmountScene;
  sceneGates.set("departed", new Promise(resolve => { releaseUnmountScene = resolve; }));
  await page.evaluate(() => { location.hash = "/create?sceneId=departed"; });
  await until(() => assert.ok(reads.some(read => read.path === "/v1/scenes/departed")), "unmount request starts");
  await page.evaluate(() => { location.hash = "/works"; });
  sceneGates.delete("departed"); releaseUnmountScene();
  await page.evaluate(() => { location.hash = "/create?sceneId=a"; });
  await expectValue(page, "navigation A draft");
  assert.equal(await page.getByText(tasks[1].prompt, { exact: true }).count(), 0);
  pass("offline target/new chat and unmount invalidate pending history without old content or writes");

  await page.evaluate(() => { location.hash = "/settings"; });
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "清理本地缓存", exact: true }).click();
  await until(async () => assert.ok((await page.locator("body").innerText()).includes("已清理本地会话缓存")), "navigation drafts cleared");
  await page.goto(`${base}/#/create?sceneId=a`);
  await expectValue(page, "");
  assert.equal(await page.locator(".composer-refs").count(), 0);
  assert.equal(writes.length, 0);
  pass("history/sceneId entry: no sent prompt, auto attachment or import; legacy caches ignored");

  await fill(page, "A 尚未发送");
  await open(page, "b"); await expectValue(page, "");
  await fill(page, "B 尚未发送");
  await open(page, "a"); await expectValue(page, "A 尚未发送");
  pass("A → B → A isolates unsent drafts");

  await page.locator('.composer-card input[type="file"]').setInputFiles({ name: "reference.png", mimeType: "image/png", buffer: png });
  await until(async () => assert.equal(await page.locator(".composer-refs .ref-chip").count(), 1), "attachment visible");
  await page.reload(); await open(page, "a");
  await expectValue(page, "A 尚未发送");
  await until(async () => assert.equal(await page.locator(".composer-refs .ref-chip").count(), 1), "attachment survives reload");
  await page.locator(".composer-refs .ref-chip-preview").click();
  await until(async () => assert.equal(await page.locator(".yarl__root").count(), 1), "attachment preview");
  await page.keyboard.press("Escape");
  await send(page);
  await expectValue(page, "");
  const explicit = writes.findLast(w => w.path.endsWith("/generations")).body;
  assert.equal(explicit.image_context, undefined);
  assert.deepEqual(explicit.provider_options.image_file_ids, ["explicit-file"]);
  assert.equal(explicit.resolution, "9:16");
  assert.equal(explicit.provider_options.output_format, "webp");
  pass("IndexedDB restores real File; explicit attachment preview and submit override auto context");

  await fill(page, "仅修改灯光");
  let release, submitted;
  const gate = new Promise(resolve => { release = resolve; });
  nextSubmit = async (_route, json) => { submitted = true; await gate; return json(task("delayed", "a", "仅修改灯光", "queued")); };
  await send(page);
  await until(() => assert.ok(submitted), "submission held");
  await fill(page, "提交期间的新输入");
  release();
  await until(async () => assert.equal(await page.locator(".composer-submit").isDisabled(), false), "accepted");
  await expectValue(page, "提交期间的新输入");
  assert.deepEqual(writes.findLast(w => w.path.endsWith("/generations")).body.image_context, { mode: "latest" });
  pass("ordinary continuation sends latest; delayed acceptance cannot erase newer input");

  nextSubmit = route => route.fulfill({ status: 503, contentType: "application/json", body: '{"detail":"fixture unavailable"}' });
  await send(page);
  await until(async () => assert.ok((await page.locator("body").innerText()).includes("fixture unavailable")), "failure visible");
  await expectValue(page, "提交期间的新输入");
  pass("failed submission retains unsent content");

  let releaseOther, otherStarted;
  const otherGate = new Promise(resolve => { releaseOther = resolve; });
  nextSubmit = async (_route, json) => { otherStarted = true; await otherGate; return json(task("delayed-other", "a", "submitted", "queued")); };
  await send(page); await until(() => assert.ok(otherStarted), "second submission held");
  await open(page, "b"); await expectValue(page, "B 尚未发送");
  releaseOther();
  await until(async () => assert.equal(await page.locator(".composer-submit").isDisabled(), false), "other scene accepted");
  await expectValue(page, "B 尚未发送");
  await open(page, "a"); await expectValue(page, "");
  pass("acceptance clears only submitted scene/revision, never the other scene");

  await fill(page, "跨完成保留的草稿");
  tasks.push(task("completed-later", "a", "另一任务刚完成"));
  await open(page, "b"); await open(page, "a");
  await expectValue(page, "跨完成保留的草稿");
  assert.equal(await page.locator(".composer-refs").count(), 0);
  await page.getByRole("button", { name: "新建会话", exact: true }).click();
  await expectValue(page, "");
  await fill(page, "全新创作"); await send(page); await expectValue(page, "");
  assert.equal(writes.findLast(w => w.path.endsWith("/generations")).body.image_context, undefined);
  assert.equal(writes.findLast(w => w.path.endsWith("/generations")).body.provider_options.output_format, "webp");
  pass("other task completion never fills composer; new chat has no historical reference");

  await open(page, "a"); await fill(page, "重开时不恢复");
  await page.evaluate(key => { const data = JSON.parse(localStorage.getItem(key)); data.state.restoreLastSession = false; localStorage.setItem(key, JSON.stringify(data)); }, settingsKey);
  await page.reload(); await open(page, "a"); await expectValue(page, "");
  await fill(page, "关闭恢复仍保留当前内存草稿");
  await open(page, "b"); await open(page, "a"); await expectValue(page, "关闭恢复仍保留当前内存草稿");
  pass("restore off skips disk on reopen without dropping in-memory A → B → A draft");

  await fill(page, "");
  await page.locator('.composer-card input[type="file"]').setInputFiles({ name: "remove.png", mimeType: "image/png", buffer: png });
  await page.locator(".composer-refs .ref-chip-remove").click();
  assert.equal(await page.locator(".composer-refs").count(), 0);
  await fill(page, "移除主动附件后恢复普通续图"); await send(page); await expectValue(page, "");
  assert.deepEqual(writes.findLast(w => w.path.endsWith("/generations")).body.image_context, { mode: "latest" });
  pass("attachment removal returns to ordinary latest context without stale uploaded IDs");

  await page.locator("#session-task-old-a .session-turn-image-button").nth(1).click();
  await page.locator('.media-overlay-image-actions button[aria-label="编辑"]').click();
  await page.locator("#media-overlay-edit-instruction").fill("只调整第二张图的色温");
  await page.locator('#media-overlay-edit-form button[type="submit"]').click();
  await until(() => assert.equal(writes.findLast(w => w.path.endsWith("/generations"))?.body.operation, "edit"), "explicit edit submitted");
  assert.ok(writes.some(w => w.path === "/v1/image/tasks/old-a/outputs/1/file"));
  const selectedEdit = writes.findLast(w => w.path.endsWith("/generations")).body;
  assert.deepEqual(selectedEdit.provider_options.image_file_ids, ["explicit-file"]);
  assert.equal(selectedEdit.image_context, undefined);
  assert.equal(selectedEdit.parent_version_id, "old-a");
  pass("explicit edit pins selected older output index 1, not the latest result");
  await page.keyboard.press("Escape");

  // Force a late history response after New chat, rather than relying on timing.
  await page.reload();
  let releaseScene, sceneStarted;
  const sceneGate = new Promise(resolve => { releaseScene = resolve; });
  nextScene = async () => { sceneStarted = true; await sceneGate; };
  await page.getByRole("button", { name: "展开会话历史", exact: true }).click();
  await page.locator(".session-sidebar-item").filter({ hasText: scenes[1].title }).click();
  await until(() => assert.ok(sceneStarted), "history request held");
  await page.locator(".session-new-button").click();
  await expectValue(page, ""); await fill(page, "新会话独立草稿");
  releaseScene();
  await until(async () => assert.equal(await page.locator(".composer-submit").isDisabled(), false), "history response released");
  await expectValue(page, "新会话独立草稿");
  assert.equal(await page.locator(".session-transcript").count(), 0);
  pass("new chat invalidates a late history request");

  await open(page, "a"); await fill(page, "卸载期间提交");
  let releaseUnmount, unmountStarted;
  const unmountGate = new Promise(resolve => { releaseUnmount = resolve; });
  nextSubmit = async (_route, json) => { unmountStarted = true; await unmountGate; return json(task("unmounted", "a", "submitted", "queued")); };
  await send(page); await until(() => assert.ok(unmountStarted), "unmount submission held");
  await page.evaluate(() => { location.hash = "/works"; });
  await until(async () => assert.equal(await page.locator(".composer-textarea").count(), 0), "composer unmounted");
  await page.goto(`${base}/#/create?sceneId=a`);
  await expectValue(page, "卸载期间提交");
  releaseUnmount();
  await expectValue(page, "");
  pass("accepted submission clears its draft even when composer unmounts");

  await open(page, "v"); await expectValue(page, "");
  await fill(page, "新的视频描述"); await send(page); await expectValue(page, "");
  assert.equal(writes.at(-1).path, "/v1/video/generations");
  assert.equal(writes.at(-1).body.image_context, undefined);
  pass("video history selects video composition without image continuation");

  await open(page, "a"); await fill(page, "网关 A 的私有草稿");
  await page.evaluate(() => { location.hash = "/settings"; });
  await page.locator('input[type="password"]').fill("fixture-gateway-b");
  let releaseGateway;
  sceneGates.set("a", new Promise(resolve => { releaseGateway = resolve; }));
  await page.evaluate(() => { location.hash = "/create?sceneId=a"; });
  await until(() => assert.ok(reads.some(read => read.path === "/v1/scenes/a" && read.token === "Bearer fixture-gateway-b")), "other gateway scene starts");
  assert.equal(await page.getByText(tasks[0].prompt, { exact: true }).count(), 0, "other gateway never borrows cached scene");
  assert.equal(await page.locator(".composer-textarea").count(), 0);
  sceneGates.delete("a"); releaseGateway(); await expectValue(page, "");
  await fill(page, "网关 B 的私有草稿");
  await page.evaluate(() => { location.hash = "/settings"; });
  await page.locator('input[type="password"]').fill("");
  await page.evaluate(() => { location.hash = "/create?sceneId=a"; }); await expectValue(page, "网关 A 的私有草稿");
  pass("gateway identities isolate cached scenes and drafts even for the same scene ID");

  await page.evaluate(() => { location.hash = "/settings"; });
  page.once("dialog", dialog => dialog.accept());
  await page.getByRole("button", { name: "清理本地缓存", exact: true }).click();
  await until(async () => assert.ok((await page.locator("body").innerText()).includes("已清理本地会话缓存")), "cache cleared");
  await page.goto(`${base}/#/create?sceneId=a`); await expectValue(page, "");
  pass("Clear local cache removes IndexedDB and in-memory drafts");

  await page.getByRole("button", { name: "新建会话", exact: true }).click();
  await fill(page, "首条消息提交中再次点新建");
  let releaseNew, newStarted;
  const newGate = new Promise(resolve => { releaseNew = resolve; });
  nextSubmit = async (_route, json) => { newStarted = true; await newGate; return json(task("first-accepted", "new-scene", "submitted", "queued")); };
  await send(page); await until(() => assert.ok(newStarted), "first new-chat submission held");
  await page.getByRole("button", { name: "新建会话", exact: true }).click();
  releaseNew();
  await until(async () => assert.equal(await page.locator(".composer-submit").isDisabled(), false), "first new-chat submission accepted");
  await expectValue(page, "");
  assert.equal(await page.locator(".session-transcript").count(), 0);
  pass("New chat during first submission prevents late navigation into its accepted scene");

  await context.close();
  const largeTextContext = await browser.newContext({ viewport: { width: 320, height: 740 } });
  await fixture(largeTextContext);
  await largeTextContext.addInitScript(key => {
    localStorage.setItem(key, JSON.stringify({ version: 4, state: { language: "en", theme: "dark" } }));
    document.addEventListener("DOMContentLoaded", () => { document.documentElement.style.fontSize = "32px"; });
  }, settingsKey);
  const largeTextPage = await largeTextContext.newPage();
  largeTextPage.on("pageerror", error => failures.push(error.message));
  let releaseLargeText;
  listFailure = true;
  sceneGates.set("b", new Promise(resolve => { releaseLargeText = resolve; }));
  await largeTextPage.goto(`${base}/#/create?sceneId=b`, { waitUntil: "domcontentloaded" });
  await largeTextPage.locator('.session-transcript[aria-busy="true"]').waitFor();
  await largeTextPage.locator(".session-history-toggle").click();
  await largeTextPage.getByRole("alert").filter({ hasText: "History unavailable" }).waitFor();
  await capture(largeTextPage, "large-text-history-error");
  listFailure = false;
  await largeTextPage.getByRole("alert").getByRole("button", { name: "Retry", exact: true }).click();
  await largeTextPage.locator(".session-sidebar-item").first().waitFor();
  await largeTextPage.locator(".session-sidebar-backdrop").click({ position: { x: 310, y: 10 } });
  await capture(largeTextPage, "large-text-loading");
  sceneFailure = "b"; sceneGates.delete("b"); releaseLargeText();
  await largeTextPage.getByRole("alert").waitFor();
  await capture(largeTextPage, "large-text-error");
  sceneFailure = null;
  await largeTextPage.getByRole("button", { name: "Retry", exact: true }).click();
  await expectValue(largeTextPage, "");
  assert.equal(await largeTextPage.locator(".composer-refs").count(), 0);
  await largeTextContext.close();
  pass("320px dark English 200% loading/error/retry retains empty composer; history-index failure independent");

  const videoOnlyContext = await browser.newContext();
  await fixture(videoOnlyContext);
  await videoOnlyContext.route("**/v1/models", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ...catalog, routing_providers: [videoProvider] }) }));
  const videoOnlyPage = await videoOnlyContext.newPage();
  videoOnlyPage.on("pageerror", error => failures.push(error.message));
  await videoOnlyPage.goto(`${base}/#/create`, { waitUntil: "domcontentloaded" });
  await expectValue(videoOnlyPage, "");
  assert.equal(await videoOnlyPage.locator(".composer-submit").getAttribute("aria-label"), "生成视频");
  await videoOnlyPage.evaluate(() => { location.hash = "/create?sceneId=a"; });
  await videoOnlyPage.getByRole("alert").filter({ hasText: "没有可用的 Provider" }).waitFor();
  assert.equal(await videoOnlyPage.locator(".composer-submit").count(), 0, "unsupported historical image is not silently converted to video");
  await videoOnlyContext.close();
  pass("video-only gateway can start fresh video but cannot silently convert historical image context");

  assert.deepEqual(failures, []);
  pass("no browser runtime errors");
})().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; }).finally(async () => {
  await browser?.close();
  server.kill();
});
