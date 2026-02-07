import type {
  ProviderModelOperationInfo,
  ProviderOperationField,
  VideoTaskDetail,
} from "./types";

export const SESSION_STORAGE_KEY = "scenewords_last_session_v3";
export const FIELD_STORAGE_PREFIX = "scenewords_field_v3";

export interface SessionSnapshot {
  provider: string;
  model: string;
  operation: string;
  values: Record<string, string>;
}

export function fieldKey(field: ProviderOperationField): string {
  return `${field.target}:${field.key}`;
}

export function isPromptField(field: ProviderOperationField): boolean {
  return field.target === "request" && (field.key === "prompt" || field.key === "negative_prompt");
}

export function fieldStorageKey(
  providerId: string,
  modelName: string,
  operationId: string,
  field: ProviderOperationField,
): string {
  return `${FIELD_STORAGE_PREFIX}__${providerId}__${modelName}__${operationId}__${field.target}__${field.key}`;
}

export function parseFieldValue(
  field: ProviderOperationField,
  raw: string,
  texts?: {
    numberRequired?: (label: string) => string;
    invalidJson?: (label: string) => string;
  },
): unknown {
  if (field.input_type === "boolean") {
    return raw === "true";
  }
  if (field.input_type === "number") {
    if (!raw.trim()) {
      return null;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      throw new Error(
        texts?.numberRequired?.(field.label) ?? `${field.label} must be a number`,
      );
    }
    return parsed;
  }
  if (field.input_type === "json") {
    if (!raw.trim()) {
      return null;
    }
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error(
        texts?.invalidJson?.(field.label) ?? `${field.label} is not valid JSON`,
      );
    }
  }
  if (field.input_type === "string_list") {
    if (!raw.trim()) {
      return [];
    }
    return raw
      .split("\r")
      .join("")
      .split(/\n|,/)
      .map((item: string) => item.trim())
      .filter(Boolean);
  }
  return raw.trim() || null;
}

export function isFieldEmpty(value: unknown, field: ProviderOperationField): boolean {
  if (field.input_type === "boolean") {
    return false;
  }
  if (value == null) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim().length === 0;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  return false;
}

export function valueToStoredString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return JSON.stringify(value);
}

export function numberOrNull(value: string): number | null {
  const raw = value.trim();
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function extractVideoUrl(task: VideoTaskDetail): string | null {
  const result = task.result;
  if (!result || typeof result !== "object") {
    return null;
  }
  const candidates = [
    result.video_url,
    result.url,
    result.download_url,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }
  return null;
}

export function findField(
  operation: ProviderModelOperationInfo | null,
  key: string,
): ProviderOperationField | null {
  if (!operation) {
    return null;
  }
  return operation.fields.find((field) => field.key === key) ?? null;
}

export function formatTaskStatus(
  task: VideoTaskDetail,
  options?: { queuedWithPosition?: (position: number) => string },
): string {
  if (task.status === "queued" && task.queue_position != null) {
    return (
      options?.queuedWithPosition?.(task.queue_position) ?? `queued (#${task.queue_position})`
    );
  }
  return task.status;
}

export function formatTime(value: string, locale = "en-US"): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString(locale);
}

export function errorMessage(
  task: VideoTaskDetail,
  options?: {
    mapErrorCode?: (code: string) => string | null;
    fallbackMessage?: string;
  },
): string | null {
  if (!task.error) {
    return null;
  }
  const rawCode = task.error.code;
  const code = typeof rawCode === "string" ? rawCode.trim() : "";
  const mapped = options?.mapErrorCode?.(code) ?? mapErrorCode(code);
  const message = typeof task.error.message === "string" ? task.error.message.trim() : "";
  if (mapped && message) {
    return `${mapped} (${message})`;
  }
  if (mapped) {
    return mapped;
  }
  if (message) {
    return message;
  }
  return options?.fallbackMessage ?? "Generation failed. Please try again later.";
}

function mapErrorCode(code: string): string | null {
  if (!code) {
    return null;
  }
  const mappings: Record<string, string> = {
    unknown_provider: "Provider not found or disabled",
    provider_not_initialized: "Provider is not initialized",
    timeout: "Request timeout",
    invalid_response: "Invalid upstream response",
    unauthorized: "Unauthorized. Check API key",
    quota_exceeded: "Quota exceeded",
    rate_limited: "Rate limited. Please retry later",
    internal_error: "Gateway internal error",
    upstream_error: "Upstream service error",
    bad_request: "Invalid request parameters",
  };
  return mappings[code] ?? null;
}

export function saveSession(snapshot: SessionSnapshot): void {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(snapshot));
}

export function restoreSession(enabled: boolean): SessionSnapshot | null {
  if (!enabled) {
    return null;
  }
  const raw = localStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as SessionSnapshot;
    if (!parsed.provider || !parsed.model || !parsed.operation) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
