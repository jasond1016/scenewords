import assert from "node:assert/strict";
import test from "node:test";
import { createTranslator, localizeDynamicField } from "../src/i18n";
import type { ProviderOperationField } from "../src/types";

const field: ProviderOperationField = {
  key: "background", label: "背景", target: "provider_options",
  input_type: "select", required: true, default: "auto",
  placeholder: null, help_text: "透明背景仅支持 PNG 或 WebP。",
  min: null, max: null, step: null,
  options: [{ value: "auto", label: "自动" }, { value: "transparent", label: "透明" }],
};

test("dynamic catalog metadata is translated without changing request values or the source", () => {
  const original = structuredClone(field);
  const english = localizeDynamicField(field, createTranslator("en"));
  assert.equal(english.label, "Background");
  assert.equal(english.help_text, "Transparent backgrounds require PNG or WebP.");
  assert.deepEqual(english.options, [
    { value: "auto", label: "Automatic" }, { value: "transparent", label: "Transparent" },
  ]);
  assert.equal(english.default, field.default);
  assert.equal(english.target, field.target);
  assert.deepEqual(field, original);
  assert.deepEqual(localizeDynamicField(field, createTranslator("zh-CN")), field);
});

test("placeholders and existing fidelity copy localize; unknown metadata falls back intact", () => {
  const t = createTranslator("en");
  const source = { ...field, key: "source_video_id", label: "源视频 ID", placeholder: "输入要 remix 的视频 ID" };
  assert.equal(localizeDynamicField(source, t).placeholder, "Enter the video ID to remix");
  assert.equal(localizeDynamicField(source, t).label, "Source video ID");
  const fidelity = localizeDynamicField({ ...field, key: "input_fidelity", options: [{ value: "high", label: "高" }] }, t);
  assert.equal(fidelity.options[0].label, "High fidelity");
  const unknown = { ...field, key: "custom", label: "Custom label", placeholder: "Provider hint", help_text: null, options: [{ value: "custom", label: "Custom option" }] };
  assert.deepEqual(localizeDynamicField(unknown, t), unknown);
});
