import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  createVideoTask,
  estimatePricing,
  uploadFile,
} from "../api";
import { useI18n } from "../i18n";
import { useAppSettingsStore, type AppSettingsState } from "../state";
import type {
  ProviderCatalogResponse,
  ProviderModelOperationInfo,
  ProviderOperationField,
  VideoGenerationRequest,
} from "../types";
import {
  durationOptionsFromField,
  fieldKey,
  fieldStorageKey,
  findField,
  isDurationField,
  isFieldEmpty,
  parseFieldValue,
  restoreSession,
  saveSession,
  valueToStoredString,
} from "../utils";

interface Props {
  catalog?: ProviderCatalogResponse;
  loading: boolean;
}

const CORE_FIELD_ORDER = [
  "prompt",
  "negative_prompt",
  "duration_sec",
  "resolution",
  "fps",
  "seed",
  "quality",
];
const RECENT_PROMPTS_KEY = "scenewords_recent_prompts_v1";
const PROMPT_PRESETS_KEY = "scenewords_prompt_presets_v1";
const MAX_RECENT_PROMPTS = 20;
const DEFAULT_PROMPT_PRESETS = [
  "cinematic slow dolly shot of a rainy city street at night, reflections on wet asphalt",
  "minimalist product hero shot with soft studio lighting, smooth camera orbit",
  "aerial sunrise over mountain ridge with drifting clouds, natural color grade",
];
const VEO_PROMPT_GUIDE_LINK_DOCS =
  "https://docs.cloud.google.com/vertex-ai/generative-ai/docs/video/video-gen-prompt-guide?hl=zh-cn";
const VEO_PROMPT_GUIDE_LINK_BLOG =
  "https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-veo-3-1";

interface RecentPromptEntry {
  text: string;
  provider: string;
  model: string;
  operation: string;
  usedAt: string;
  pinned: boolean;
}

export function CreatePage(props: Props) {
  const { catalog, loading } = props;
  const { t } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const settings = useAppSettingsStore();
  const providers = catalog?.providers ?? [];

  const [providerId, setProviderId] = useState("");
  const [modelName, setModelName] = useState("");
  const [operationId, setOperationId] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, File[]>>({});
  const [hint, setHint] = useState("");
  const [recentPromptVersion, setRecentPromptVersion] = useState(0);
  const [presetVersion, setPresetVersion] = useState(0);

  const selectedProvider = useMemo(
    () => providers.find((provider) => provider.id === providerId) ?? null,
    [providerId, providers],
  );
  const selectedModel = useMemo(
    () => selectedProvider?.models.find((model) => model.name === modelName) ?? null,
    [modelName, selectedProvider],
  );
  const selectedOperation = useMemo(() => {
    if (!selectedModel) {
      return null;
    }
    return (
      selectedModel.operations.find((operation) => operation.id === operationId) ??
      selectedModel.operations.find((operation) => operation.is_default) ??
      selectedModel.operations[0] ??
      null
    );
  }, [operationId, selectedModel]);
  const showVeoPromptGuide = useMemo(() => {
    const providerType = selectedProvider?.type?.toLowerCase() ?? "";
    const modelLower = modelName.toLowerCase();
    return providerType.includes("veo") || modelLower.includes("veo");
  }, [modelName, selectedProvider?.type]);
  const coreFields = useMemo(
    () => getCoreFields(selectedOperation),
    [selectedOperation],
  );
  const advancedFields = useMemo(() => {
    if (!selectedOperation) {
      return [];
    }
    const coreIds = new Set(coreFields.map((field) => fieldKey(field)));
    return selectedOperation.fields.filter((field) => !coreIds.has(fieldKey(field)));
  }, [coreFields, selectedOperation]);
  const promptField = useMemo(
    () =>
      selectedOperation?.fields.find(
        (field) => field.target === "request" && field.key === "prompt",
      ) ?? null,
    [selectedOperation],
  );
  const recentPrompts = useMemo(
    () =>
      listRecentPrompts({
        provider: providerId,
        model: modelName,
        operation: selectedOperation?.id ?? operationId,
        retentionDays: settings.historyRetentionDays,
        version: recentPromptVersion,
      }),
    [
      modelName,
      operationId,
      providerId,
      recentPromptVersion,
      selectedOperation?.id,
      settings.historyRetentionDays,
    ],
  );
  const promptPresets = useMemo(
    () => listPromptPresets(presetVersion),
    [presetVersion],
  );

  useEffect(() => {
    if (!providers.length || providerId) {
      return;
    }
    const defaultProvider =
      providers.find((provider) => provider.id === settings.defaultProvider) ??
      providers[0];
    const defaultModel =
      defaultProvider.models.find((model) => model.is_default) ??
      defaultProvider.models[0] ??
      null;
    const defaultOperation =
      defaultModel?.operations.find((operation) => operation.is_default) ??
      defaultModel?.operations[0] ??
      null;
    setProviderId(defaultProvider.id);
    setModelName(defaultModel?.name ?? "");
    setOperationId(defaultOperation?.id ?? "");
  }, [providerId, providers, settings.defaultProvider]);

  useEffect(() => {
    const pending = settings.pendingReuseDraft;
    if (!pending || !providers.length) {
      return;
    }
    if (providerId !== pending.provider) {
      setProviderId(pending.provider);
    }
    if (modelName !== pending.model) {
      setModelName(pending.model);
    }
    if (operationId !== pending.operation) {
      setOperationId(pending.operation);
    }
  }, [modelName, operationId, providerId, providers.length, settings.pendingReuseDraft]);

  useEffect(() => {
    if (!selectedProvider) {
      return;
    }
    if (selectedProvider.models.some((model) => model.name === modelName)) {
      return;
    }
    const nextModel =
      selectedProvider.models.find((model) => model.is_default) ??
      selectedProvider.models[0] ??
      null;
    const nextOperation =
      nextModel?.operations.find((operation) => operation.is_default) ??
      nextModel?.operations[0] ??
      null;
    setModelName(nextModel?.name ?? "");
    setOperationId(nextOperation?.id ?? "");
  }, [modelName, selectedProvider]);

  useEffect(() => {
    if (!selectedModel) {
      return;
    }
    if (selectedModel.operations.some((operation) => operation.id === operationId)) {
      return;
    }
    const nextOperation =
      selectedModel.operations.find((operation) => operation.is_default) ??
      selectedModel.operations[0] ??
      null;
    setOperationId(nextOperation?.id ?? "");
  }, [operationId, selectedModel]);

  useEffect(() => {
    if (!selectedOperation) {
      return;
    }
    const hydrated: Record<string, string> = {};
    for (const field of selectedOperation.fields) {
      const key = fieldKey(field);
      const stored = localStorage.getItem(
        fieldStorageKey(providerId, modelName, selectedOperation.id, field),
      );
      if (stored != null) {
        hydrated[key] = stored;
        continue;
      }
      if (field.default != null) {
        hydrated[key] = valueToStoredString(field.default);
      }
    }

    const session = restoreSession(settings.restoreLastSession);
    if (
      session &&
      session.provider === providerId &&
      session.model === modelName &&
      session.operation === selectedOperation.id
    ) {
      Object.assign(hydrated, session.values);
    }
    applySettingDefaults(hydrated, selectedOperation, settings);

    const pending = settings.pendingReuseDraft;
    if (
      pending &&
      pending.provider === providerId &&
      pending.model === modelName &&
      pending.operation === selectedOperation.id
    ) {
      applyDraft(hydrated, selectedOperation, pending);
      settings.setPendingReuseDraft(null);
      setHint(t("create.hintReusedDraft"));
      navigate("/create");
    }

    setValues(hydrated);
    setFiles({});
  }, [
    modelName,
    navigate,
    providerId,
    selectedOperation,
    settings.defaultDurationSec,
    settings.defaultNegativePrompt,
    settings.pendingReuseDraft,
    settings.restoreLastSession,
    settings.setPendingReuseDraft,
  ]);

  const duration = parseNumberValue(selectedOperation, values, "duration_sec");
  const resolution = parseStringValue(selectedOperation, values, "resolution");
  const quality = parseStringValue(selectedOperation, values, "quality") ?? settings.defaultQuality;

  const estimateQuery = useQuery({
    queryKey: [
      "estimate",
      settings.gatewayToken,
      providerId,
      modelName,
      duration,
      resolution,
      quality,
    ],
    queryFn: () =>
      estimatePricing(
        {
          provider: providerId,
          model: modelName,
          duration_sec: duration,
          resolution,
          quality,
        },
        settings.gatewayToken,
      ),
    enabled: Boolean(providerId && modelName),
  });

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!selectedOperation) {
        throw new Error(t("create.errorNoOperation"));
      }
      const payload: VideoGenerationRequest = {
        provider: providerId,
        model: modelName,
        operation: selectedOperation.id,
        provider_options: {},
      };
      const requestPayload = payload as unknown as Record<string, unknown>;

      for (const field of selectedOperation.fields) {
        const key = fieldKey(field);
        if (field.input_type === "file" || field.input_type === "file_list") {
          const selectedFiles = files[key] ?? [];
          if (!selectedFiles.length) {
            if (field.required) {
              throw new Error(t("create.errorMissingRequiredFile", { label: field.label }));
            }
            continue;
          }
          const uploadedIds: string[] = [];
          for (let index = 0; index < selectedFiles.length; index += 1) {
            setHint(
              t("create.hintUploading", {
                index: index + 1,
                total: selectedFiles.length,
              }),
            );
            const uploaded = await uploadFile(selectedFiles[index], settings.gatewayToken);
            uploadedIds.push(uploaded.file_id);
          }
          const uploadedValue =
            field.input_type === "file" ? (uploadedIds[0] ?? null) : uploadedIds;
          if (field.target === "request") {
            requestPayload[field.key] = uploadedValue;
          } else {
            payload.provider_options[field.key] = uploadedValue;
          }
          continue;
        }

        const raw = values[key] ?? "";
        const parsed = parseFieldValue(field, raw, {
          numberRequired: (label) => t("error.numberRequired", { label }),
          invalidJson: (label) => t("error.invalidJson", { label }),
        });
        if (!field.required && isFieldEmpty(parsed, field)) {
          continue;
        }
        if (field.target === "request") {
          requestPayload[field.key] = parsed;
        } else {
          payload.provider_options[field.key] = parsed;
        }
      }
      return createVideoTask(payload, settings.gatewayToken);
    },
    onSuccess: async (response) => {
      setHint(t("create.hintCreated", { taskId: response.task_id.slice(0, 8) }));
      settings.setSettings({ defaultProvider: providerId });
      if (settings.savePromptHistory && promptField) {
        const promptValue = (values[fieldKey(promptField)] ?? "").trim();
        if (promptValue) {
          appendRecentPrompt({
            text: promptValue,
            provider: providerId,
            model: modelName,
            operation: selectedOperation?.id ?? operationId,
          });
          setRecentPromptVersion((current) => current + 1);
        }
      }
      saveSession({
        provider: providerId,
        model: modelName,
        operation: selectedOperation?.id ?? operationId,
        values,
      });
      await queryClient.invalidateQueries({
        queryKey: ["tasks", settings.gatewayToken],
      });
    },
    onError: (error: Error) => {
      setHint(t("create.hintSubmitFailed", { message: error.message }));
    },
  });

  const onFieldChanged = (
    field: ProviderOperationField,
    nextValue: string,
  ) => {
    const key = fieldKey(field);
    setValues((current) => ({ ...current, [key]: nextValue }));
    if (field.input_type === "password" || field.input_type === "file" || field.input_type === "file_list") {
      return;
    }
    localStorage.setItem(
      fieldStorageKey(providerId, modelName, operationId || selectedOperation?.id || "", field),
      nextValue,
    );
  };

  if (loading) {
    return <section className="panel">{t("create.loadingCatalog")}</section>;
  }
  if (!selectedProvider || !selectedModel || !selectedOperation) {
    return <section className="panel">{t("create.noAvailable")}</section>;
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2>{t("create.title")}</h2>
        <p>{t("create.subtitle")}</p>
      </div>

      <form
        className="form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          void submitMutation.mutateAsync();
        }}
      >
        <div className="grid-3">
          <label>
            {t("create.provider")}
            <select
              value={providerId}
              onChange={(event) => setProviderId(event.target.value)}
            >
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.display_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("create.model")}
            <select
              value={modelName}
              onChange={(event) => setModelName(event.target.value)}
            >
              {selectedProvider.models.map((model) => (
                <option key={model.name} value={model.name}>
                  {model.display_name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("create.operation")}
            <select
              value={operationId}
              onChange={(event) => setOperationId(event.target.value)}
            >
              {selectedModel.operations.map((operation) => (
                <option key={operation.id} value={operation.id}>
                  {operation.display_name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <section className="core-section">
          <h3>{t("create.coreInputs")}</h3>
          <div className="dynamic-grid">
            {coreFields.map((field) => renderField(field, values, onFieldChanged, setFiles))}
          </div>
        </section>

        {showVeoPromptGuide ? (
          <section className="veo-guide">
            <h4>{t("create.veoPromptGuideTitle")}</h4>
            <p>{t("create.veoPromptGuideDesc")}</p>
            <div className="veo-guide-links">
              <a href={VEO_PROMPT_GUIDE_LINK_DOCS} target="_blank" rel="noreferrer">
                {t("create.veoPromptGuideLinkDocs")}
              </a>
              <a href={VEO_PROMPT_GUIDE_LINK_BLOG} target="_blank" rel="noreferrer">
                {t("create.veoPromptGuideLinkBlog")}
              </a>
            </div>
          </section>
        ) : null}

        {promptField ? (
          <section className="prompt-presets">
            <div className="prompt-presets-header">
              <h4>{t("create.promptPresets")}</h4>
              <div className="inline-actions">
                <button
                  type="button"
                  onClick={() => {
                    onFieldChanged(promptField, "");
                  }}
                >
                  {t("create.clearPrompt")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const promptValue = (values[fieldKey(promptField)] ?? "").trim();
                    if (!promptValue) {
                      setHint(t("create.hintPromptEmpty"));
                      return;
                    }
                    const added = appendPromptPreset(promptValue);
                    if (!added) {
                      setHint(t("create.hintPresetExists"));
                      return;
                    }
                    setPresetVersion((current) => current + 1);
                    setHint(t("create.hintPresetSaved"));
                  }}
                >
                  {t("create.saveCurrentPreset")}
                </button>
              </div>
            </div>
            <div className="prompt-preset-list">
              {promptPresets.map((preset) => (
                <div key={preset} className="prompt-preset-item">
                  <button
                    type="button"
                    className="prompt-preset-chip"
                    onClick={() => {
                      onFieldChanged(promptField, preset);
                      setHint(t("create.hintPresetApplied"));
                    }}
                  >
                    {preset}
                  </button>
                  {!DEFAULT_PROMPT_PRESETS.includes(preset) ? (
                    <button
                      type="button"
                      className="mini-button"
                      onClick={() => {
                        removePromptPreset(preset);
                        setPresetVersion((current) => current + 1);
                      }}
                    >
                      {t("create.removePreset")}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {promptField && settings.savePromptHistory ? (
          <section className="recent-prompts">
            <div className="recent-prompts-header">
              <h4>{t("create.recentPrompts")}</h4>
              <button
                type="button"
                onClick={() => {
                  clearRecentPrompts();
                  setRecentPromptVersion((current) => current + 1);
                }}
              >
                {t("common.clear")}
              </button>
            </div>
            {recentPrompts.length ? (
              <div className="recent-prompt-list">
                {recentPrompts.map((entry) => (
                  <div
                    key={`${entry.usedAt}_${entry.text}`}
                    className="recent-prompt-item"
                  >
                    <button
                      type="button"
                      className="recent-prompt-chip"
                      onClick={() => {
                        onFieldChanged(promptField, entry.text);
                        setHint(t("create.hintRecentPromptApplied"));
                      }}
                    >
                      {entry.text}
                    </button>
                    <button
                      type="button"
                      className={entry.pinned ? "mini-button pinned" : "mini-button"}
                      onClick={() => {
                        toggleRecentPromptPinned({
                          provider: entry.provider,
                          model: entry.model,
                          operation: entry.operation,
                          text: entry.text,
                        });
                        setRecentPromptVersion((current) => current + 1);
                      }}
                    >
                      {entry.pinned ? t("create.unpin") : t("create.pin")}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="hint">{t("create.noRecentPrompts")}</p>
            )}
          </section>
        ) : null}

        {advancedFields.length ? (
          <details className="advanced-section">
            <summary>{t("create.advancedOptions", { count: advancedFields.length })}</summary>
            <div className="dynamic-grid">
              {advancedFields.map((field) =>
                renderField(field, values, onFieldChanged, setFiles),
              )}
            </div>
          </details>
        ) : null}

        <div className="submit-area">
          <button
            type="submit"
            className="primary-button"
            disabled={submitMutation.isPending}
          >
            {submitMutation.isPending ? t("create.submitting") : t("create.generateVideo")}
          </button>
          <p className="hint">
            {settings.showEstimatedCostPreSubmit && estimateQuery.data?.estimated_cost != null
              ? t("create.estimated", {
                  cost: estimateQuery.data.estimated_cost.toFixed(3),
                  currency: estimateQuery.data.currency ?? settings.currency,
                })
              : t("create.estimatedUnavailable")}
          </p>
          <p className="hint">{hint}</p>
        </div>
      </form>
    </section>
  );
}

function DynamicInput(props: {
  field: ProviderOperationField;
  value: string;
  onValueChange: (value: string) => void;
  onFileChange: (files: File[]) => void;
}) {
  const { field, value, onValueChange, onFileChange } = props;
  const durationOptions = isDurationField(field) ? durationOptionsFromField(field) : [];

  if (durationOptions.length) {
    return (
      <select
        value={value}
        required={field.required}
        onChange={(event) => onValueChange(event.target.value)}
      >
        {durationOptions.map((seconds) => (
          <option key={seconds} value={String(seconds)}>
            {seconds}
          </option>
        ))}
      </select>
    );
  }

  if (field.input_type === "textarea" || field.input_type === "json" || field.input_type === "string_list") {
    return (
      <textarea
        rows={field.input_type === "json" ? 8 : 4}
        value={value}
        required={field.required}
        placeholder={field.placeholder ?? ""}
        onChange={(event) => onValueChange(event.target.value)}
      />
    );
  }
  if (field.input_type === "select") {
    return (
      <select
        value={value}
        required={field.required}
        onChange={(event) => onValueChange(event.target.value)}
      >
        {(field.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
  if (field.input_type === "boolean") {
    return (
      <input
        type="checkbox"
        checked={value === "true"}
        onChange={(event) => onValueChange(event.target.checked ? "true" : "false")}
      />
    );
  }
  if (field.input_type === "file" || field.input_type === "file_list") {
    return (
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple={field.input_type === "file_list"}
        onChange={(event) => onFileChange(Array.from(event.target.files ?? []))}
      />
    );
  }
  if (field.input_type === "number") {
    return (
      <input
        type="number"
        value={value}
        required={field.required}
        min={field.min ?? undefined}
        max={field.max ?? undefined}
        step={field.step ?? undefined}
        placeholder={field.placeholder ?? ""}
        onChange={(event) => onValueChange(event.target.value)}
      />
    );
  }
  return (
    <input
      type={field.input_type === "password" ? "password" : "text"}
      value={value}
      required={field.required}
      placeholder={field.placeholder ?? ""}
      onChange={(event) => onValueChange(event.target.value)}
    />
  );
}

function getCoreFields(
  operation: ProviderModelOperationInfo | null,
): ProviderOperationField[] {
  if (!operation) {
    return [];
  }
  const fields: ProviderOperationField[] = [];
  for (const key of CORE_FIELD_ORDER) {
    const matched = operation.fields.find((field) => field.key === key);
    if (matched) {
      fields.push(matched);
    }
  }
  return fields;
}

function renderField(
  field: ProviderOperationField,
  values: Record<string, string>,
  onFieldChanged: (field: ProviderOperationField, nextValue: string) => void,
  setFiles: Dispatch<SetStateAction<Record<string, File[]>>>,
) {
  const key = fieldKey(field);
  const value = values[key] ?? "";
  return (
    <label key={key} className={isPromptLike(field) ? "field field-wide" : "field"}>
      <span>{field.label}</span>
      <DynamicInput
        field={field}
        value={value}
        onValueChange={(next) => onFieldChanged(field, next)}
        onFileChange={(nextFiles) =>
          setFiles((current) => ({ ...current, [key]: nextFiles }))
        }
      />
      {field.help_text ? <small>{field.help_text}</small> : null}
    </label>
  );
}

function isPromptLike(field: ProviderOperationField): boolean {
  return field.target === "request" && (field.key === "prompt" || field.key === "negative_prompt");
}

function applySettingDefaults(
  values: Record<string, string>,
  operation: ProviderModelOperationInfo,
  settings: AppSettingsState,
): void {
  const durationField = findField(operation, "duration_sec");
  if (durationField) {
    const key = fieldKey(durationField);
    if (!values[key]) {
      values[key] = String(settings.defaultDurationSec);
    }
  }
  const negativeField = findField(operation, "negative_prompt");
  if (negativeField && settings.defaultNegativePrompt) {
    const key = fieldKey(negativeField);
    if (!values[key]) {
      values[key] = settings.defaultNegativePrompt;
    }
  }
}

function applyDraft(
  values: Record<string, string>,
  operation: ProviderModelOperationInfo,
  draft: NonNullable<AppSettingsState["pendingReuseDraft"]>,
): void {
  for (const field of operation.fields) {
    const key = fieldKey(field);
    if (field.target === "request") {
      if (field.key === "prompt") {
        values[key] = draft.prompt;
      } else if (field.key === "negative_prompt") {
        values[key] = draft.negativePrompt;
      } else if (field.key === "duration_sec" && draft.durationSec != null) {
        values[key] = String(draft.durationSec);
      } else if (field.key === "resolution" && draft.resolution) {
        values[key] = draft.resolution;
      } else if (field.key === "fps" && draft.fps != null) {
        values[key] = String(draft.fps);
      } else if (field.key === "seed" && draft.seed != null) {
        values[key] = String(draft.seed);
      }
    } else {
      const optionValue = draft.providerOptions[field.key];
      if (optionValue == null) {
        continue;
      }
      values[key] = valueToStoredString(optionValue);
    }
  }
}

function parseNumberValue(
  operation: ProviderModelOperationInfo | null,
  values: Record<string, string>,
  key: string,
): number | null {
  const field = findField(operation, key);
  if (!field) {
    return null;
  }
  const raw = values[fieldKey(field)] ?? "";
  if (!raw.trim()) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseStringValue(
  operation: ProviderModelOperationInfo | null,
  values: Record<string, string>,
  key: string,
): string | null {
  const field = findField(operation, key);
  if (!field) {
    return null;
  }
  const raw = values[fieldKey(field)] ?? "";
  const trimmed = raw.trim();
  return trimmed || null;
}

function appendRecentPrompt(input: {
  text: string;
  provider: string;
  model: string;
  operation: string;
}): void {
  const current = readRecentPrompts();
  const normalizedText = input.text.trim();
  if (!normalizedText) {
    return;
  }
  const deduped = current.filter(
    (entry) =>
      !(
        entry.text === normalizedText &&
        entry.provider === input.provider &&
        entry.model === input.model &&
        entry.operation === input.operation
      ),
  );
  const existing = current.find(
    (entry) =>
      entry.text === normalizedText &&
      entry.provider === input.provider &&
      entry.model === input.model &&
      entry.operation === input.operation,
  );
  const next: RecentPromptEntry = {
    text: normalizedText,
    provider: input.provider,
    model: input.model,
    operation: input.operation,
    usedAt: new Date().toISOString(),
    pinned: Boolean(existing?.pinned),
  };
  const compacted = [next, ...deduped].slice(0, MAX_RECENT_PROMPTS);
  localStorage.setItem(RECENT_PROMPTS_KEY, JSON.stringify(compacted));
}

function listRecentPrompts(input: {
  provider: string;
  model: string;
  operation: string;
  retentionDays: number;
  version: number;
}): RecentPromptEntry[] {
  void input.version;
  const all = readRecentPrompts();
  const now = Date.now();
  const keepMillis = Math.max(1, input.retentionDays) * 24 * 60 * 60 * 1000;
  const alive = all.filter((entry) => {
    const ts = Date.parse(entry.usedAt);
    return Number.isFinite(ts) && now - ts <= keepMillis;
  });
  if (alive.length !== all.length) {
    localStorage.setItem(RECENT_PROMPTS_KEY, JSON.stringify(alive));
  }
  return alive
    .filter(
      (entry) =>
        entry.provider === input.provider &&
        entry.model === input.model &&
        entry.operation === input.operation,
    )
    .sort((left, right) => {
      if (left.pinned && !right.pinned) {
        return -1;
      }
      if (!left.pinned && right.pinned) {
        return 1;
      }
      return Date.parse(right.usedAt) - Date.parse(left.usedAt);
    });
}

function readRecentPrompts(): RecentPromptEntry[] {
  const raw = localStorage.getItem(RECENT_PROMPTS_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item) => {
        if (!item || typeof item !== "object") {
          return null;
        }
        const text = typeof item.text === "string" ? item.text.trim() : "";
        const provider = typeof item.provider === "string" ? item.provider : "";
        const model = typeof item.model === "string" ? item.model : "";
        const operation = typeof item.operation === "string" ? item.operation : "";
        const usedAt = typeof item.usedAt === "string" ? item.usedAt : "";
        const pinned = Boolean(item.pinned);
        if (!text || !provider || !model || !operation || !usedAt) {
          return null;
        }
        return { text, provider, model, operation, usedAt, pinned };
      })
      .filter((entry): entry is RecentPromptEntry => entry !== null);
  } catch {
    return [];
  }
}

function toggleRecentPromptPinned(input: {
  provider: string;
  model: string;
  operation: string;
  text: string;
}): void {
  const list = readRecentPrompts();
  const next = list.map((entry) => {
    if (
      entry.provider !== input.provider ||
      entry.model !== input.model ||
      entry.operation !== input.operation ||
      entry.text !== input.text
    ) {
      return entry;
    }
    return { ...entry, pinned: !entry.pinned };
  });
  localStorage.setItem(RECENT_PROMPTS_KEY, JSON.stringify(next));
}

function listPromptPresets(version: number): string[] {
  void version;
  const custom = readPromptPresets();
  const merged = [...DEFAULT_PROMPT_PRESETS];
  for (const item of custom) {
    if (!merged.includes(item)) {
      merged.push(item);
    }
  }
  return merged;
}

function appendPromptPreset(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }
  if (DEFAULT_PROMPT_PRESETS.includes(normalized)) {
    return false;
  }
  const current = readPromptPresets();
  if (current.includes(normalized)) {
    return false;
  }
  const next = [normalized, ...current].slice(0, MAX_RECENT_PROMPTS);
  localStorage.setItem(PROMPT_PRESETS_KEY, JSON.stringify(next));
  return true;
}

function removePromptPreset(text: string): void {
  const current = readPromptPresets();
  const next = current.filter((item) => item !== text);
  localStorage.setItem(PROMPT_PRESETS_KEY, JSON.stringify(next));
}

function readPromptPresets(): string[] {
  const raw = localStorage.getItem(PROMPT_PRESETS_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item): item is string => Boolean(item));
  } catch {
    return [];
  }
}

function clearRecentPrompts(): void {
  localStorage.removeItem(RECENT_PROMPTS_KEY);
}
