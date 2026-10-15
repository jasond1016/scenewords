// Ordinary composer drafts are not exact retries. Never carry hidden transport,
// credential, mask or provider-debug overrides into a new composition.
const REQUEST_KEYS = new Set(["prompt", "resolution", "duration_sec"]);
const OPTION_KEYS = new Set([
  "quality", "resolution_tier", "background", "aspect_ratio", "orientation_mode",
  "output_format", "n", "input_fidelity", "image_file_ids", "input_reference_file_ids",
  "start_frame_file_id", "end_frame_file_id",
]);

export function isComposerField(target: string, key: string): boolean {
  return (target === "request" ? REQUEST_KEYS : OPTION_KEYS).has(key);
}

export function sanitizeComposerOptions(options: Record<string, unknown>): Record<string, unknown> {
  return {
    ...Object.fromEntries(Object.entries(options).filter(([key]) => OPTION_KEYS.has(key))),
    response_format: "url",
    moderation: "auto",
    watermark: false,
  };
}

export function sanitizeComposerValues(values: Record<string, string>): Record<string, string> {
  const clean = Object.fromEntries(Object.entries(values).filter(([key]) => {
    const [target, name] = key.split(":");
    return isComposerField(target, name);
  }));
  if (clean["provider_options:background"] === "transparent" && clean["provider_options:output_format"] === "jpeg") {
    clean["provider_options:output_format"] = "png";
  }
  return clean;
}
