import type {
  ProviderInfo,
  ProviderModelOperationInfo,
  ProviderOperationField,
  VideoTaskDetail,
} from "./types";

export const SESSION_STORAGE_KEY = "scenewords_last_session_v3";
export const FIELD_STORAGE_PREFIX = "scenewords_field_v3";
export type SessionKind = "image" | "video";

export interface SessionSnapshot {
  provider: string;
  model: string;
  operation: string;
  values: Record<string, string>;
}

interface SessionSnapshotMap {
  image?: SessionSnapshot;
  video?: SessionSnapshot;
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

export function isDurationField(field: ProviderOperationField): boolean {
  return field.target === "request" && field.key === "duration_sec";
}

export function durationOptionsFromField(field: ProviderOperationField): number[] {
  if (!isDurationField(field)) {
    return [];
  }
  const fromOptions = (field.options ?? [])
    .map((option) => Number(option.value))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (fromOptions.length) {
    return sortUniqueNumbers(fromOptions);
  }

  const min = field.min ?? 1;
  const max = field.max ?? min;
  const step = field.step ?? 1;
  if (!(Number.isFinite(min) && Number.isFinite(max) && Number.isFinite(step)) || step <= 0) {
    return [];
  }
  if (max < min) {
    return [];
  }
  const count = Math.floor((max - min) / step) + 1;
  if (count <= 0 || count > 200) {
    return [];
  }
  const values: number[] = [];
  for (let index = 0; index < count; index += 1) {
    const value = Number((min + step * index).toFixed(6));
    if (value > 0) {
      values.push(value);
    }
  }
  return sortUniqueNumbers(values);
}

export function supportedDurationOptions(providers: ProviderInfo[]): number[] {
  const optionSets: number[][] = [];
  for (const provider of providers) {
    for (const model of provider.models) {
      for (const operation of model.operations) {
        const durationField = operation.fields.find(isDurationField);
        if (!durationField) {
          continue;
        }
        const options = durationOptionsFromField(durationField);
        if (options.length) {
          optionSets.push(options);
        }
      }
    }
  }
  if (!optionSets.length) {
    return [8];
  }

  const intersection = optionSets.slice(1).reduce((current, set) => {
    const nextSet = new Set(set);
    return current.filter((value) => nextSet.has(value));
  }, optionSets[0]);
  if (intersection.length) {
    return sortUniqueNumbers(intersection);
  }

  const union = optionSets.flat();
  return sortUniqueNumbers(union);
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
    result.local_video_url,
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

export function extractImageUrls(task: VideoTaskDetail): string[] {
  const result = task.result;
  if (!result || typeof result !== "object") {
    return [];
  }
  const localUrls: string[] = [];
  const pushLocalUrl = (value: unknown) => {
    if (typeof value === "string" && value.trim()) {
      localUrls.push(value.trim());
    }
  };
  const local = (result as Record<string, unknown>).local_image_urls;
  if (Array.isArray(local)) {
    for (const item of local) {
      pushLocalUrl(item);
    }
  }
  if (localUrls.length) {
    return Array.from(new Set(localUrls));
  }
  return extractOriginalImageUrls(task);
}

export function extractOriginalImageUrls(task: VideoTaskDetail): string[] {
  const result = task.result;
  if (!result || typeof result !== "object") {
    return [];
  }
  const urls: string[] = [];

  const pushUrl = (value: unknown) => {
    if (typeof value === "string" && value.trim()) {
      urls.push(value.trim());
    }
  };

  const direct = (result as Record<string, unknown>).image_urls;
  if (Array.isArray(direct)) {
    for (const item of direct) {
      pushUrl(item);
    }
  }

  const images = (result as Record<string, unknown>).images;
  if (Array.isArray(images)) {
    for (const item of images) {
      if (item && typeof item === "object") {
        pushUrl((item as Record<string, unknown>).url);
      }
    }
  }

  if (!urls.length) {
    pushUrl((result as Record<string, unknown>).url);
    pushUrl((result as Record<string, unknown>).download_url);
  }
  return Array.from(new Set(urls));
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

export type TaskCostStateKind = "charged" | "estimated" | "not_charged" | "unavailable";

export interface TaskCostState {
  kind: TaskCostStateKind;
  amount: number | null;
  currency: string | null;
}

export function resolveTaskCostState(task: VideoTaskDetail): TaskCostState {
  const currency = typeof task.currency === "string" && task.currency.trim()
    ? task.currency.trim()
    : null;

  if (typeof task.actual_cost === "number" && Number.isFinite(task.actual_cost)) {
    return {
      kind: "charged",
      amount: task.actual_cost,
      currency,
    };
  }

  if (
    typeof task.estimated_cost === "number" &&
    Number.isFinite(task.estimated_cost) &&
    (task.status === "queued" || task.status === "running" || task.status === "succeeded")
  ) {
    return {
      kind: "estimated",
      amount: task.estimated_cost,
      currency,
    };
  }

  if (task.status === "failed" || task.status === "canceled") {
    return {
      kind: "not_charged",
      amount: null,
      currency,
    };
  }

  return {
    kind: "unavailable",
    amount: null,
    currency,
  };
}

export function formatCostAmount(
  amount: number,
  currency: string | null,
  locale = "en-US",
): string {
  const absolute = Math.abs(amount);
  const maximumFractionDigits = absolute >= 100 ? 2 : absolute >= 1 ? 3 : 4;
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(amount);
  const normalizedCurrency = currency?.trim() ?? "";
  return normalizedCurrency ? `${formatted} ${normalizedCurrency}` : formatted;
}

export function summarizeTaskCosts(tasks: VideoTaskDetail[]): {
  chargedCostTotal: number;
  chargedTaskCount: number;
  pendingEstimatedCostTotal: number;
  pendingEstimatedTaskCount: number;
} {
  return tasks.reduce(
    (summary, task) => {
      const costState = resolveTaskCostState(task);
      if (costState.kind === "charged" && typeof costState.amount === "number") {
        summary.chargedCostTotal += costState.amount;
        summary.chargedTaskCount += 1;
      }
      if (
        costState.kind === "estimated" &&
        typeof costState.amount === "number" &&
        (task.status === "queued" || task.status === "running")
      ) {
        summary.pendingEstimatedCostTotal += costState.amount;
        summary.pendingEstimatedTaskCount += 1;
      }
      return summary;
    },
    {
      chargedCostTotal: 0,
      chargedTaskCount: 0,
      pendingEstimatedCostTotal: 0,
      pendingEstimatedTaskCount: 0,
    },
  );
}

export function errorMessage(
  task: VideoTaskDetail,
  options?: {
    fallbackMessage?: string;
    providerRetryRecommendedMessage?: string;
  },
): string | null {
  if (!task.error) {
    return null;
  }
  const providerRetryRecommendedMessage =
    typeof options?.providerRetryRecommendedMessage === "string"
      ? options.providerRetryRecommendedMessage.trim()
      : "";
  if (providerRetryRecommendedMessage && hasRetryRecommendedProviderError(task.error)) {
    return providerRetryRecommendedMessage;
  }
  const providerErrorMessage = readProviderErrorMessage(task.error);
  if (providerErrorMessage) {
    return providerErrorMessage;
  }
  return options?.fallbackMessage ?? "Generation failed. Please try again later.";
}

function hasRetryRecommendedProviderError(error: Record<string, unknown>): boolean {
  const providerFailureMessage =
    typeof (error.raw_error as { error?: { message?: unknown } } | null)?.error?.message === "string"
      ? (error.raw_error as { error: { message: string } }).error.message.trim().toLowerCase()
      : "";
  if (providerFailureMessage.includes("recaptcha evaluation failed")) {
    return true;
  }

  const requestFailureMessage =
    typeof error.raw_error === "string" ? error.raw_error.trim().toLowerCase() : "";
  return requestFailureMessage.includes("all connection attempts failed");
}

function readProviderErrorMessage(error: Record<string, unknown>): string {
  const message =
    typeof (error.raw_error as { error?: { message?: unknown } } | null)?.error?.message === "string"
      ? (error.raw_error as { error: { message: string } }).error.message.trim()
      : "";
  return message;
}

function sortUniqueNumbers(values: number[]): number[] {
  return Array.from(new Set(values)).sort((left, right) => left - right);
}

export function saveSession(kind: SessionKind, snapshot: SessionSnapshot): void {
  const current = readSessionSnapshotMap();
  current[kind] = snapshot;
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(current));
}

export function restoreSession(enabled: boolean, kind: SessionKind): SessionSnapshot | null {
  if (!enabled) {
    return null;
  }
  const parsed = readSessionSnapshotMap();
  const snapshot = parsed[kind];
  if (!snapshot) {
    return null;
  }
  return isSessionSnapshot(snapshot) ? snapshot : null;
}

function readSessionSnapshotMap(): SessionSnapshotMap {
  const raw = localStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as SessionSnapshotMap | SessionSnapshot;
    if (isSessionSnapshot(parsed)) {
      return {
        image: parsed,
        video: parsed,
      };
    }
    return parsed;
  } catch {
    return {};
  }
}

function isSessionSnapshot(value: unknown): value is SessionSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as SessionSnapshot;
  return Boolean(candidate.provider && candidate.model && candidate.operation);
}
