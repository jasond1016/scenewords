import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanComposerStorage, FIELD_STORAGE_PREFIX, SESSION_STORAGE_KEY, parseFieldValue, restoreSession, saveSession } from "../src/utils";
import type { ProviderOperationField } from "../src/types";

test("ordinary composer reuse and persisted sessions discard hidden overrides without rewriting history", async (t) => {
  const data = new Map<string, string>();
  const storage: Storage = {
    get length() { return data.size; },
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
    clear: () => data.clear(),
  };
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: storage } });
  t.after(() => { Reflect.deleteProperty(globalThis, "localStorage"); Reflect.deleteProperty(globalThis, "window"); });
  const legacyOptions = {
    api_key: "old-credential", user: "old-user", timeout_sec: 150, submit_timeout_sec: 100,
    poll_interval_sec: 2, response_format: "b64_json", moderation: "low", watermark: true,
    output_compression: 70, image: ["https://example.com/manual.png"], input_references: ["manual"],
    mask_file_id: "old-mask", __debug: true, extra_body: { secret: true },
    n: 4, output_format: "webp", input_fidelity: "high", image_file_ids: ["ref-a", "ref-b"],
  };
  const session = { provider: "image", model: "model", operation: "edit", values: {
    "request:prompt": "Keep my description", "request:negative_prompt": "old negative", "request:seed": "42",
    ...Object.fromEntries(Object.entries(legacyOptions).map(([key, value]) => [`provider_options:${key}`, String(value)])),
  } };
  storage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ image: session, video: session }));
  for (const [key, value] of Object.entries(session.values)) {
    const [target, name] = key.split(":");
    storage.setItem(`${FIELD_STORAGE_PREFIX}__image__model__edit__${target}__${name}`, value);
  }
  storage.setItem("unrelated-preference", "keep");
  storage.setItem("scenewords_gateway_settings_v1", JSON.stringify({ version: 3, state: {
    gatewayToken: "keep-gateway", defaultNegativePrompt: "old negative",
    providerDefaults: { image: { defaultRatio: "16:9", defaultNegativePrompt: "old negative" } },
    pendingReuseDraft: { providerOptions: legacyOptions },
  } }));
  const { useAppSettingsStore } = await import("../src/state");
  const settings = useAppSettingsStore.getState();
  settings.setPendingReuseDraft({
    provider: "image", model: "model", operation: "edit", prompt: "Original",
    negativePrompt: "old negative", fps: 24, seed: 42, durationSec: null, resolution: "16:9",
    sceneId: "scene", generationId: "generation", parentVersionId: "version", providerOptions: legacyOptions,
  });
  const draft = useAppSettingsStore.getState().pendingReuseDraft!;
  assert.deepEqual(draft.providerOptions, {
    n: 4, output_format: "webp", input_fidelity: "high", image_file_ids: ["ref-a", "ref-b"],
    response_format: "url", moderation: "auto", watermark: false,
  });
  assert.equal(draft.negativePrompt, "");
  assert.equal(draft.seed, null);
  assert.equal(draft.sceneId, "scene");
  assert.equal(legacyOptions.mask_file_id, "old-mask");
  assert.equal(legacyOptions.moderation, "low");
  cleanComposerStorage();
  assert.equal(restoreSession(true, "image")?.values["request:prompt"], "Keep my description");
  assert.equal(restoreSession(true, "image")?.values["provider_options:n"], "4");
  const saved = storage.getItem(SESSION_STORAGE_KEY)!;
  assert.doesNotMatch(saved, /old-mask|old-credential|manual|old negative|__debug|timeout|compression/);
  assert.equal([...data.keys()].some((key) => key.endsWith("__mask_file_id")), false);
  assert.equal(storage.getItem("unrelated-preference"), "keep");
  const persistedSettings = JSON.parse(storage.getItem("scenewords_gateway_settings_v1")!);
  assert.equal(persistedSettings.state.gatewayToken, "keep-gateway");
  assert.doesNotMatch(JSON.stringify(persistedSettings), /old negative|pendingReuseDraft/);
  saveSession("image", { ...session, values: { "request:prompt": "new", "provider_options:mask_file_id": "mask" } });
  assert.deepEqual(restoreSession(true, "image")?.values, { "request:prompt": "new" });
});

test("image counts enforce inclusive 1–10 integer bounds, including fractional and nonfinite inputs", () => {
  const field: ProviderOperationField = {
    key: "n", target: "provider_options", input_type: "number", required: true, label: "Image count",
    min: 1, max: 10, step: 1, default: 1, placeholder: null, help_text: null, options: [],
  };
  for (const raw of ["0", "11", "3.5", "NaN", "Infinity"]) assert.throws(() => parseFieldValue(field, raw));
  assert.equal(parseFieldValue(field, "1"), 1);
  assert.equal(parseFieldValue(field, "10"), 10);
  assert.equal(parseFieldValue({ ...field, min: 0.2, step: 0.2 }, "0.6"), 0.6);
});
