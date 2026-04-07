import type {
  AssetType,
  ProviderCatalogResponse,
  RetryMode,
  UploadedFileResponse,
  VideoGenerationRequest,
  VideoTaskDetail,
  VideoTaskResponse,
} from "./types";

export type TasksView = "full" | "summary";

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
  providerType?: string,
): Promise<VideoTaskResponse> {
  const assetType = resolveAssetType(providerType);
  return request<VideoTaskResponse>(
    generationPath(assetType),
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
  assetType: AssetType = "video",
): Promise<VideoTaskResponse> {
  return request<VideoTaskResponse>(
    retryPath(taskId, assetType),
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

export function fetchTasks(
  limit: number,
  token: string,
  view: TasksView = "summary",
): Promise<VideoTaskDetail[]> {
  const query = `limit=${encodeURIComponent(String(limit))}&view=${encodeURIComponent(view)}`;
  return Promise.all([
    request<VideoTaskDetail[]>(
      `/v1/video/tasks?${query}`,
      {},
      token,
    ),
    request<VideoTaskDetail[]>(
      `/v1/image/tasks?${query}`,
      {},
      token,
    ),
  ]).then(([videoTasks, imageTasks]) =>
    [...videoTasks, ...imageTasks].sort((left, right) => {
      const leftTs = Date.parse(left.created_at);
      const rightTs = Date.parse(right.created_at);
      const safeLeft = Number.isFinite(leftTs) ? leftTs : 0;
      const safeRight = Number.isFinite(rightTs) ? rightTs : 0;
      return safeRight - safeLeft;
    }),
  );
}

export function fetchTaskDetail(
  taskId: string,
  token: string,
  assetType: AssetType,
): Promise<VideoTaskDetail> {
  const root = assetType === "image" ? "/v1/image/tasks" : "/v1/video/tasks";
  return request<VideoTaskDetail>(`${root}/${encodeURIComponent(taskId)}`, {}, token);
}

export function deleteVideoTask(
  taskId: string,
  token: string,
  assetType: AssetType = "video",
): Promise<void> {
  return request<void>(
    deletePath(taskId, assetType),
    {
      method: "DELETE",
    },
    token,
  );
}

export function cancelVideoTask(
  taskId: string,
  token: string,
  assetType: AssetType = "video",
): Promise<VideoTaskDetail> {
  return request<VideoTaskDetail>(
    cancelPath(taskId, assetType),
    {
      method: "POST",
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

export async function fetchUploadedFileBinary(
  fileId: string,
  token: string,
): Promise<{ blob: Blob; fileName: string | null; contentType: string | null }> {
  const headers = new Headers();
  if (token.trim()) {
    headers.set("Authorization", `Bearer ${token.trim()}`);
  }
  const response = await fetch(`/v1/files/${encodeURIComponent(fileId)}`, { headers });
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
  const blob = await response.blob();
  const contentDisposition = response.headers.get("content-disposition");
  return {
    blob,
    fileName: parseFilenameFromContentDisposition(contentDisposition),
    contentType: response.headers.get("content-type"),
  };
}

function resolveAssetType(providerType?: string): AssetType {
  if (providerType?.toLowerCase() === "tuzi_image") {
    return "image";
  }
  return "video";
}

function generationPath(assetType: AssetType): string {
  return assetType === "image" ? "/v1/image/generations" : "/v1/video/generations";
}

function retryPath(taskId: string, assetType: AssetType): string {
  const root = assetType === "image" ? "/v1/image/tasks" : "/v1/video/tasks";
  return `${root}/${encodeURIComponent(taskId)}/retry`;
}

function deletePath(taskId: string, assetType: AssetType): string {
  const root = assetType === "image" ? "/v1/image/tasks" : "/v1/video/tasks";
  return `${root}/${encodeURIComponent(taskId)}`;
}

function cancelPath(taskId: string, assetType: AssetType): string {
  const root = assetType === "image" ? "/v1/image/tasks" : "/v1/video/tasks";
  return `${root}/${encodeURIComponent(taskId)}/cancel`;
}

function parseFilenameFromContentDisposition(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]).trim() || null;
    } catch {
      return utf8Match[1].trim() || null;
    }
  }
  const plainMatch = value.match(/filename=\"?([^\";]+)\"?/i);
  if (plainMatch?.[1]) {
    return plainMatch[1].trim() || null;
  }
  return null;
}
