// Built-UI regression suite. All API/media requests use disposable fixtures.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const base = "http://127.0.0.1:4198";
const baseline = process.env.UI_BASELINE === "1";
const artifacts = process.env.UI_ARTIFACTS;
if (artifacts) fs.mkdirSync(artifacts, { recursive: true });
const server = spawn(process.execPath, [path.resolve(__dirname, "../node_modules/vite/bin/vite.js"), "preview",
  "--host", "127.0.0.1", "--port", "4198", "--strictPort", "--base", "/",
  ...(process.env.UI_BUILD_DIR ? ["--outDir", process.env.UI_BUILD_DIR] : [])], { cwd: path.resolve(__dirname, ".."), stdio: "pipe" });
const time = "2026-11-03T10:00:00Z";
const field = (key, target, input_type, rest = {}) => ({ key, label: key, target, input_type, required: false,
  default: null, placeholder: null, help_text: null, min: null, max: null, step: null, options: [], ...rest });
const fields = [field("prompt", "request", "textarea", { required: true }),
  field("resolution", "request", "select", { default: "16:9", options: ["16:9", "9:16", "1:1"].map(value => ({ value, label: value })) }),
  field("image_file_ids", "provider_options", "file_list"),
  field("output_format", "provider_options", "select", { options: ["png", "webp"].map(value => ({ value, label: value })) }),
  field("n", "provider_options", "number", { default: 1, min: 1, max: 10 })];
const operations = ["generate", "edit"].map(id => ({ id, display_name: id, is_default: id === "generate", fields }));
const model = { name: "image-model", display_name: "Fixture image", is_default: true, operations };
const catalog = { providers: [{ id: "fixture", type: "tuzi_image", display_name: "Fixture", models: [model] }],
  routing_providers: [{ id: "auto-image", type: "tuzi_image", display_name: "Smart", models: ["1k", "2k", "4k"].map(tier =>
    ({ ...model, name: `auto-image-${tier}`, routing_goal: { resolution_tier: tier } })) }], max_upload_bytes: 10485760 };
const task = (id, version, status = "succeeded") => ({ task_id: id, scene_id: "scene", scene_title: "陶器 / Ceramic study",
  generation_id: "generation", parent_version_id: version > 1 ? "one" : null, version_number: version, status, asset_type: "image",
  provider: "fixture", model: "image-model", operation: "generate", created_at: time, updated_at: time,
  prompt: `陶土花瓶，纸感留白。Terracotta vase in soft daylight. ${id}`, resolution: "1536x1024", seed: null, fps: null,
  negative_prompt: null, duration_sec: null, queue_position: status === "queued" ? 2 : null, provider_options: {}, subject_bindings: [],
  estimated_cost: 0.12, actual_cost: status === "succeeded" ? 0.10 : null, currency: "USD", cost_source: "local_config",
  result: status === "succeeded" ? { local_image_urls: [`/fixture.svg?${id}`] } : null, error: status === "failed" ? "Fixture: temporarily unavailable" : null });
const tasks = [task("two", 2), task("one", 1), task("failed", 3, "failed"), task("queued", 4, "queued")];
tasks[0].result.local_image_urls.push("/fixture.svg?two-variant");
const scene = { scene_id: "scene", title: "陶器 / Ceramic study", description: "", generation_count: 1,
  version_count: tasks.length, created_at: time, updated_at: time };
const subject = { subject_id: "subject", kind: "object", name: "陶土花瓶 / Terracotta vase", description: "Handmade terracotta vase",
  fixed_traits: ["Terracotta"], variable_traits: ["Lighting"], references: [{ file_id: "ref", role: "Front", is_primary: true }], created_at: time, updated_at: time };
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600" fill="#e7dfd1"/><path d="M0 420H900V600H0Z" fill="#cec1ac"/><ellipse cx="480" cy="475" rx="180" ry="24" fill="#b5a288"/><path d="M405 155H495L485 250Q610 400 520 470H380Q295 400 415 250Z" fill="#ab7258"/><ellipse cx="450" cy="155" rx="45" ry="10" fill="#704d3d"/><path d="M427 195Q400 365 403 430" fill="none" stroke="#c28d6a" stroke-width="10"/></svg>`;
const errors = [];
const evidence = [];
let browser;
async function until(fn, label) {
  let error;
  for (let i = 0; i < 100; i++) {
    try { return await fn(); } catch (e) { error = e; await new Promise(resolve => setTimeout(resolve, 60)); }
  }
  throw new Error(`${label}: ${error?.message}`);
}
async function fixture(context, state) {
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== base) return route.abort();
    const p = url.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (p.startsWith("/static/")) return route.continue({ url: request.url().replace("/static/", "/") });
    if (p === "/fixture.svg" || p.startsWith("/v1/files/")) return route.fulfill({ contentType: "image/svg+xml", body: svg });
    if (!p.startsWith("/v1/")) return route.continue();
    if (state.fail === p) return json({ detail: "Fixture: connection unavailable" }, 503);
    if (state.hold === p) await state.gate;
    if (request.method() !== "GET") {
      state.writes.push({ path: p, body: request.postData() });
      if (p === "/v1/subjects" || p === "/v1/subjects/subject") return json({ ...subject, ...request.postDataJSON() });
      if (p.includes("/outputs/") || p === "/v1/files") return json({ file_id: "ref", url: "/v1/files/ref", original_name: "vase.png", mime_type: "image/png", size_bytes: 1024 });
      if (p.endsWith("/generations") || p.endsWith("/retry")) return json(task("accepted", 5, "queued"));
      throw new Error(`Unexpected write ${p}`);
    }
    if (p === "/v1/models") return json(catalog);
    if (p === "/v1/scenes") return json([scene]);
    if (p === "/v1/scenes/scene") return json({ ...scene, generations: [{ generation_id: "generation", asset_type: "image", versions: tasks }] });
    if (p === "/v1/subjects") return json(state.empty ? [] : [subject]);
    if (p === "/v1/tasks/summary") return json({ charged_cost_total: 0.3, pending_estimated_cost_total: 0.12, currency: "USD" });
    if (p.endsWith("/tasks")) return json(state.empty || p.includes("/video/") ? [] : tasks);
    if (p.includes("/tasks/")) return json(tasks.find(task => p.endsWith(task.task_id)) || tasks[0]);
    throw new Error(`Unexpected read ${p}`);
  });
}
async function geometry(page, label) {
  const result = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth,
    clippedStates: Array.from(document.querySelectorAll(".asset-tile-state")).filter(el => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1).map(el => el.textContent),
    unnamed: Array.from(document.querySelectorAll("button,input:not([type=file]),select,textarea")).filter(el =>
      el.getClientRects().length && getComputedStyle(el).visibility !== "hidden" && !el.closest("[aria-hidden=true]") &&
      !(el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.labels?.length || el.textContent?.trim() || el.getAttribute("title"))).map(el => el.outerHTML.slice(0, 180)) }));
  evidence.push({ label, ...result });
  if (!baseline) { assert.ok(result.scroll <= result.width + 1, `${label} horizontal overflow ${JSON.stringify(result)}`); assert.deepEqual(result.unnamed, [], `${label} accessible names`); assert.deepEqual(result.clippedStates, [], `${label} status and recovery fit`); }
}
async function shot(page, name) {
  if (artifacts) await page.screenshot({ path: path.join(artifacts, `${baseline ? "before" : "after"}-${name}.png`), fullPage: false, animations: "disabled" });
}
async function navigate(page, route) { await page.goto(`${base}/#/${route}`); await page.locator("h1,.session-transcript").first().waitFor(); }

(async () => {
  await until(async () => assert.equal((await fetch(base)).status, 200), "preview starts");
  browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || "msedge", headless: true });
  const matrix = [
    { name: "phone", width: 320, height: 740, language: "zh-CN", theme: "light", font: 16 },
    { name: "large-text", width: 390, height: 844, language: "en", theme: "dark", font: 32 },
    { name: "narrow-large-text", width: 320, height: 740, language: "en", theme: "light", font: 32 },
    { name: "landscape", width: 844, height: 390, language: "zh-CN", theme: "dark", font: 32 },
    { name: "tablet", width: 1024, height: 1100, language: "en", theme: "light", font: 16 },
  ];
  for (const variant of matrix) {
    const state = { writes: [], empty: false };
    const context = await browser.newContext({ viewport: { width: variant.width, height: variant.height }, reducedMotion: "reduce" });
    await fixture(context, state);
    await context.addInitScript(variant => {
      localStorage.setItem("scenewords_gateway_settings_v1", JSON.stringify({ version: 4, state: { language: variant.language, theme: variant.theme } }));
      document.addEventListener("DOMContentLoaded", () => { document.documentElement.style.fontSize = `${variant.font}px`; });
    }, variant);
    const page = await context.newPage();
    if (!baseline) {
      const session = await context.newCDPSession(page);
      await session.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 12, bottom: 34, left: variant.name === "landscape" ? 44 : 0, right: variant.name === "landscape" ? 44 : 0 } });
    }
    page.on("pageerror", error => errors.push(error.message));
    page.setDefaultTimeout(5000);
    for (const route of ["create", "works", "subjects", "settings"]) {
      await navigate(page, route);
      if (route === "works") await page.locator(".asset-tile").first().waitFor();
      if (route === "subjects") await page.locator(".subject-card").first().waitFor();
      await geometry(page, `${variant.name}/${route}`);
      await shot(page, `${variant.name}-${route}`);
      if (!baseline) assert.equal(await page.locator(".page-subtitle,.composer-resolution-card__eyebrow").count(), 0);
      if (!baseline && route === "subjects") {
        const boxes = await page.locator(".topbar button:visible").evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().toJSON()));
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
          assert.ok(Math.min(boxes[i].right, boxes[j].right) - Math.max(boxes[i].left, boxes[j].left) <= 1 ||
            Math.min(boxes[i].bottom, boxes[j].bottom) - Math.max(boxes[i].top, boxes[j].top) <= 1, "header controls do not overlap at large text");
        }
      }
      if (!baseline && route === "settings") {
        await page.locator("#settings-gateway-token").scrollIntoViewIfNeeded();
        await geometry(page, `${variant.name}/gateway`); await shot(page, `${variant.name}-gateway`);
        await page.getByRole("button", { name: /显示网关 Token|Show gateway token/ }).click();
        assert.equal(await page.locator("#settings-gateway-token").getAttribute("type"), "text");
        await page.locator("#settings_privacy_storage").scrollIntoViewIfNeeded();
        const toggle = page.getByRole("switch").first();
        const checked = await toggle.getAttribute("aria-checked");
        await toggle.focus(); await page.keyboard.press("Space");
        assert.notEqual(await toggle.getAttribute("aria-checked"), checked);
        await page.keyboard.press("Space");
        await geometry(page, `${variant.name}/privacy`); await shot(page, `${variant.name}-privacy`);
      }
    }
    if (baseline) { await context.close(); continue; }

    await navigate(page, "create");
    await page.locator(".composer-mode").click();
    await page.locator(".composer-popover").waitFor();
    assert.equal(await page.locator(".composer-resolution-card").count(), 3);
    assert.equal(await page.locator(".composer-resolution-card[aria-pressed=true]").count(), 1);
    await geometry(page, `${variant.name}/composer-settings`); await shot(page, `${variant.name}-composer-settings`);
    await page.keyboard.press("Escape"); assert.equal(await page.locator(".composer-mode").evaluate(el => el === document.activeElement), true);
    await page.locator('.topbar-actions button[aria-label]').last().click();
    await page.locator(".conversation-help summary").click();
    assert.ok((await page.locator(".conversation-help p").innerText()).length > 20);
    await geometry(page, `${variant.name}/help`); await shot(page, `${variant.name}-help`);
    await page.keyboard.press("Escape");
    await page.locator(".session-history-toggle").click();
    await page.locator(".session-sidebar-item").waitFor();
    await geometry(page, `${variant.name}/history`); await shot(page, `${variant.name}-history`);
    await page.locator(".session-sidebar-item").click();
    const multi = page.locator('.session-result-card[data-multiple="true"]');
    await multi.getByRole("button", { name: /生成结果操作|Generation result actions/, exact: true }).click();
    await page.locator(".session-result-menu-item").filter({ hasText: /高清|HD candidate/ }).click();
    await page.locator(".session-result-image-picker").waitFor();
    assert.equal(await page.locator(".session-result-image-picker button").count(), 2);
    assert.ok((await page.locator(".session-result-menu-description").innerText()).length > 10, "AI uncertainty remains");
    await geometry(page, `${variant.name}/image-picker`); await shot(page, `${variant.name}-image-picker`);
    await page.keyboard.press("Escape");

    await navigate(page, "works");
    await page.locator(".search-field input").fill("no-match");
    await page.getByRole("button", { name: /清空筛选|Clear Filters/ }).click();
    await page.locator(".asset-tile").first().waitFor();
    if (variant.width <= 640) await page.locator(".app-topbar-more > button").click();
    await page.getByRole("button", { name: /^(选择|Select)$/ }).click();
    await page.locator(".asset-tile").filter({ has: page.locator("img") }).first().click();
    await geometry(page, `${variant.name}/selection`); await shot(page, `${variant.name}-selection`);
    const selectionBounds = await page.locator(".select-bar").boundingBox();
    assert.ok(selectionBounds.x >= 0 && selectionBounds.x + selectionBounds.width <= variant.width && selectionBounds.y + selectionBounds.height <= variant.height - 34 + 1);
    if (variant.width <= 640) await page.locator(".app-topbar-more > button").click();
    await page.getByRole("button", { name: /^(完成|Done)$/ }).click();
    await page.locator(".asset-tile").filter({ has: page.locator("img") }).first().click();
    await page.locator(".media-overlay-frame").waitFor();
    await page.locator(".media-overlay-details-toggle").click();
    await page.locator(".media-detail-section > summary").first().click();
    assert.equal(await page.locator(".media-detail-full-text").count(), 0, "ordinary prompt not duplicated in diagnostics");
    await geometry(page, `${variant.name}/details`); await shot(page, `${variant.name}-details`);
    await page.locator(".media-detail-link").filter({ hasText: /对比|Compare/ }).first().click();
    await page.locator(".media-comparison").waitFor();
    assert.equal(await page.locator(".media-overlay-frame").evaluate(el => el.inert), true);
    await page.locator(".media-comparison select").focus(); await page.keyboard.press("Shift+Tab");
    assert.equal(await page.evaluate(() => !!document.activeElement.closest(".media-comparison")), true);
    await geometry(page, `${variant.name}/compare`); await shot(page, `${variant.name}-compare`);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".media-comparison").count(), 0);
    await page.locator(".media-overlay-sidebar-header button").last().click();
    await page.locator(".media-overlay-image-actions > button").first().click();
    await page.locator("#media-overlay-edit-instruction").fill("保持构图，调整色温 / Warmer light");
    const editActions = await page.locator(".media-overlay-edit-form__actions").boundingBox();
    const scopeHint = await page.locator("#media-overlay-edit-hint").boundingBox();
    assert.ok(scopeHint.width >= Math.min(180, editActions.width) - 1, "editing scope is readable, not squeezed beside submit");
    await geometry(page, `${variant.name}/edit`); await shot(page, `${variant.name}-edit`);
    const focusables = page.locator('.media-overlay-frame button:visible');
    await focusables.last().focus(); await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => !!document.activeElement.closest(".media-overlay-frame")), true);
    await page.locator(".media-overlay-image-actions > button").nth(1).click();
    await page.locator(".media-overlay-resize-menu").waitFor();
    await until(async () => {
      const focus = await page.evaluate(() => ({ inside: !!document.activeElement.closest(".media-overlay-resize-menu"), active: document.activeElement.outerHTML.slice(0, 180) }));
      assert.equal(focus.inside, true, JSON.stringify(focus));
    }, "resize menu initial focus");
    await page.keyboard.press("End");
    assert.equal(await page.locator('.media-overlay-resize-menu [role="menuitemradio"]').last().evaluate(el => el === document.activeElement), true, await page.evaluate(() => document.activeElement.outerHTML));
    await geometry(page, `${variant.name}/resize`); await shot(page, `${variant.name}-resize`);
    const menuBounds = await page.locator(".media-overlay-resize-menu").boundingBox();
    assert.ok(menuBounds.x >= 0 && menuBounds.y >= 12 && menuBounds.x + menuBounds.width <= variant.width && menuBounds.y + menuBounds.height <= variant.height - 34 + 1);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".media-overlay-image-actions > button").nth(1).evaluate(el => el === document.activeElement), true);
    await page.locator(".media-overlay-close").click();
    assert.equal(await page.locator(".asset-tile").filter({ has: page.locator("img") }).first().evaluate(el => el === document.activeElement), true, "viewer restores tile focus");

    await navigate(page, "subjects");
    await page.getByRole("button", { name: subject.name, exact: true }).click();
    await page.getByRole("dialog").waitFor();
    assert.equal(await page.getByRole("textbox", { name: /名称|Name/, exact: true }).evaluate(el => el === document.activeElement), true);
    await geometry(page, `${variant.name}/subject-editor`); await shot(page, `${variant.name}-subject-editor`);
    const referenceRole = page.getByRole("textbox", { name: /角度或用途|Angle or purpose/ });
    const referenceBounds = await referenceRole.boundingBox();
    assert.ok(referenceBounds.width >= Math.min(180, variant.width - 64), "reference purpose remains readable at enlarged text");
    await page.getByRole("dialog").locator("form").evaluate(el => { el.scrollTop = el.scrollHeight; });
    await page.getByRole("button", { name: /保存主体|Save subject/ }).scrollIntoViewIfNeeded();
    await geometry(page, `${variant.name}/subject-editor-end`); await shot(page, `${variant.name}-subject-editor-end`);
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("button", { name: subject.name, exact: true }).evaluate(el => el === document.activeElement), true);
    await page.locator(".subject-use-pill").click(); await page.locator(".composer-textarea").waitFor();
    assert.equal(await page.locator(".composer-refs .ref-chip").count(), 1);
    assert.equal(state.writes.length, 0, "inspection and explicit subject selection do not generate");

    await navigate(page, "settings");
    const beforeCancel = await page.evaluate(() => localStorage.getItem("scenewords_gateway_settings_v1"));
    page.once("dialog", dialog => dialog.dismiss());
    await page.getByRole("button", { name: /清理本地缓存|Clear Local Cache/ }).click();
    assert.equal(await page.evaluate(() => localStorage.getItem("scenewords_gateway_settings_v1")), beforeCancel);

    state.empty = true;
    await navigate(page, "works"); await page.reload();
    await page.getByRole("status").filter({ hasText: /还没有作品|No works yet/ }).waitFor();
    await geometry(page, `${variant.name}/empty-works`); await shot(page, `${variant.name}-empty-works`);
    await page.getByRole("status").getByRole("button").click(); await page.locator(".composer-textarea").waitFor();
    await navigate(page, "subjects"); await page.reload();
    await page.getByRole("button", { name: /建立第一个主体|Create your first subject/ }).click();
    await page.getByRole("textbox", { name: /名称|Name/, exact: true }).fill("New vase");
    await page.getByRole("button", { name: /保存主体|Save subject/ }).click();
    await page.getByRole("dialog").waitFor({ state: "detached" });
    assert.equal(state.writes.length, 1);
    assert.equal(JSON.parse(state.writes[0].body).name, "New vase");

    state.empty = false;
    state.fail = "/v1/subjects";
    await page.reload();
    await page.getByRole("alert").filter({ hasText: "Fixture: connection unavailable" }).waitFor({ timeout: 15000 });
    assert.equal(await page.getByRole("button", { name: /建立第一个主体|Create your first subject/ }).count(), 0, "error is not empty state");
    await geometry(page, `${variant.name}/error`); await shot(page, `${variant.name}-error`);
    state.fail = null;
    await page.getByRole("alert").getByRole("button").click(); await page.locator(".subject-card").waitFor();
    let release;
    state.hold = "/v1/subjects"; state.gate = new Promise(resolve => { release = resolve; });
    await page.reload(); await page.getByRole("status").waitFor();
    await geometry(page, `${variant.name}/loading`); await shot(page, `${variant.name}-loading`);
    state.hold = null; release(); await page.locator(".subject-card").waitFor();
    if (["phone", "large-text"].includes(variant.name)) {
      state.fail = "/v1/tasks/summary";
      await navigate(page, "settings"); await page.reload();
      await page.getByRole("alert").waitFor({ timeout: 15000 });
      assert.deepEqual(await page.locator('[aria-labelledby="settings-costs-title"] strong').allTextContents(), ["—", variant.language === "en" ? "— (est.)" : "— (预估)"]);
      await geometry(page, `${variant.name}/cost-error`); await shot(page, `${variant.name}-cost-error`);
      state.fail = null;
      await page.getByRole("alert").getByRole("button").click();
      await until(async () => assert.ok((await page.locator('[aria-labelledby="settings-costs-title"]').innerText()).includes("USD")), "cost recovery");
      state.fail = "/v1/image/tasks";
      await navigate(page, "works"); await page.reload();
      await page.getByRole("alert").waitFor({ timeout: 15000 });
      assert.equal(await page.getByRole("status").filter({ hasText: /还没有作品|No works yet/ }).count(), 0);
      await geometry(page, `${variant.name}/works-error`); await shot(page, `${variant.name}-works-error`);
      state.fail = null;
      await page.getByRole("alert").getByRole("button").click(); await page.locator(".asset-tile").first().waitFor();
      state.fail = "/v1/models";
      await navigate(page, "create"); await page.reload();
      await page.getByRole("alert").waitFor({ timeout: 15000 });
      assert.equal(await page.getByText(/没有可用的 Provider|No available Provider/).count(), 0, "catalog failure is not an empty catalog");
      await geometry(page, `${variant.name}/catalog-error`); await shot(page, `${variant.name}-catalog-error`);
      state.fail = null;
      await page.getByRole("alert").getByRole("button").click(); await page.locator(".composer-textarea").waitFor();
    }
    await context.close();
    process.stdout.write(`PASS ${variant.name}: routes/settings/help/filtering, details/compare/edit/resize, focus, safe areas, empty/error/loading/recovery, cancel clear, subject save (mock only)\n`);
  }
  assert.deepEqual(errors, []);
  if (artifacts) fs.writeFileSync(path.join(artifacts, `${baseline ? "before" : "after"}-geometry.json`), JSON.stringify(evidence, null, 2));
})().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; }).finally(async () => { await browser?.close(); server.kill(); });
