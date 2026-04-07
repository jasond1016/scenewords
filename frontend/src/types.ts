export type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";
export type AssetType = "video" | "image";

export type RetryMode = "same_seed" | "new_seed";

export interface ProviderOperationOption {
  value: string;
  label: string;
}

export type ProviderFieldInputType =
  | "text"
  | "textarea"
  | "number"
  | "select"
  | "boolean"
  | "password"
  | "json"
  | "string_list"
  | "file"
  | "file_list";

export interface ProviderOperationField {
  key: string;
  label: string;
  target: "request" | "provider_options";
  input_type: ProviderFieldInputType;
  required: boolean;
  default: unknown;
  placeholder: string | null;
  help_text: string | null;
  min: number | null;
  max: number | null;
  step: number | null;
  options: ProviderOperationOption[];
}

export interface ProviderModelOperationInfo {
  id: string;
  display_name: string;
  description: string | null;
  is_default: boolean;
  fields: ProviderOperationField[];
}

export interface ProviderModelInfo {
  name: string;
  display_name: string;
  is_default: boolean;
  operations: ProviderModelOperationInfo[];
}

export interface ProviderInfo {
  id: string;
  display_name: string;
  type: string;
  models: ProviderModelInfo[];
  supports_custom_endpoint: boolean;
}

export interface ProviderCatalogResponse {
  providers: ProviderInfo[];
}

export interface VideoGenerationRequest {
  provider: string;
  model: string;
  operation?: string | null;
  prompt?: string | null;
  negative_prompt?: string | null;
  duration_sec?: number | null;
  resolution?: string | null;
  fps?: number | null;
  seed?: number | null;
  provider_options: Record<string, unknown>;
}

export interface VideoTaskResponse {
  task_id: string;
  status: TaskStatus;
  asset_type: AssetType;
  provider: string;
  model: string;
  queue_position: number | null;
  created_at: string;
  updated_at: string;
}

export interface VideoTaskDetail extends VideoTaskResponse {
  operation: string | null;
  provider_job_id?: string | null;
  provider_status?: string | null;
  provider_query_endpoint?: string | null;
  prompt: string;
  negative_prompt: string | null;
  duration_sec: number | null;
  resolution: string | null;
  fps: number | null;
  seed: number | null;
  provider_options: Record<string, unknown>;
  estimated_cost: number | null;
  actual_cost: number | null;
  currency: string | null;
  cost_source: "provider_api" | "local_config" | "unknown";
  result: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
}

export interface RetryTaskRequest {
  retry_mode: RetryMode;
  prompt?: string | null;
}

export interface PricingEntry {
  provider: string;
  model: string;
  quality: string | null;
  resolution: string | null;
  duration_sec: number | null;
  fixed_cost: number | null;
  cost_per_second: number | null;
  currency: string;
  effective_from: string | null;
}

export interface UploadedFileResponse {
  file_id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  created_at: string;
  url: string;
}
