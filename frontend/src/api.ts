import type {
  PricingCatalogResponse,
  PricingEstimateRequest,
  PricingEstimateResponse,
  ProviderCatalogResponse,
  RetryMode,
  UploadedFileResponse,
  VideoGenerationRequest,
  VideoTaskDetail,
  VideoTaskResponse,
} from "./types";

function toErrorMessage(detail: unknown, fallback: string): string {
  if (typeof detail === "string") {
    return detail;
  }
  if (detail && typeof detail === "object") {
    try {
      return JSON.stringify(detail);
    } catch {
      return fallback;
    }
  }
  return fallback;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  token = "",
): Promise<T> {
  const headers = new Headers(init.headers);
  if (token.trim()) {
    headers.set("Authorization", `Bearer ${token.trim()}`);
  }
  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    let detail: unknown = null;
    try {
      const parsed = await response.json();
      detail = parsed?.detail;
    } catch {
      detail = null;
    }
    throw new Error(toErrorMessage(detail, `HTTP ${response.status}`));
  }
  if (response.status === 204) {
    return {} as T;
  }
  return (await response.json()) as T;
}

export function fetchCatalog(token: string): Promise<ProviderCatalogResponse> {
  return request<ProviderCatalogResponse>("/v1/models", {}, token);
}

export function createVideoTask(
  payload: VideoGenerationRequest,
  token: string,
): Promise<VideoTaskResponse> {
  return request<VideoTaskResponse>(
    "/v1/video/generations",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    token,
  );
}

export function retryVideoTask(
  taskId: string,
  retryMode: RetryMode,
  prompt: string | null,
  token: string,
): Promise<VideoTaskResponse> {
  return request<VideoTaskResponse>(
    `/v1/video/tasks/${encodeURIComponent(taskId)}/retry`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        retry_mode: retryMode,
        prompt,
      }),
    },
    token,
  );
}

export function fetchTasks(limit: number, token: string): Promise<VideoTaskDetail[]> {
  return request<VideoTaskDetail[]>(
    `/v1/video/tasks?limit=${encodeURIComponent(String(limit))}`,
    {},
    token,
  );
}

export function fetchPricing(token: string): Promise<PricingCatalogResponse> {
  return request<PricingCatalogResponse>("/v1/pricing", {}, token);
}

export function estimatePricing(
  payload: PricingEstimateRequest,
  token: string,
): Promise<PricingEstimateResponse> {
  return request<PricingEstimateResponse>(
    "/v1/pricing/estimate",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    token,
  );
}

export async function uploadFile(file: File, token: string): Promise<UploadedFileResponse> {
  const formData = new FormData();
  formData.append("file", file);
  return request<UploadedFileResponse>(
    "/v1/files",
    {
      method: "POST",
      body: formData,
    },
    token,
  );
}
