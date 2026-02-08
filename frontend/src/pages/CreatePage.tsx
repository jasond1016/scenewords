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
  ProviderInfo,
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
const HIDDEN_VIDEO_PROVIDER_IDS = new Set(["veo31_rightcodes"]);
const VIDEO_PROVIDER_PRIORITY = ["veo31", "sora2", "local_comfy"];

interface RecentPromptEntry {
  text: string;
  provider: string;
  model: string;
  operation: string;
  usedAt: string;
  pinned: boolean;
}

interface AdvancedGroup {
  id: "prompt" | "inputs" | "behavior" | "runtime" | "developer" | "misc";
  fields: ProviderOperationField[];
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
  const [openQuickKey, setOpenQuickKey] = useState<string | null>(null);

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
  const promptField = useMemo(
    () =>
      selectedOperation?.fields.find(
        (field) => field.target === "request" && field.key === "prompt",
      ) ?? null,
    [selectedOperation],
  );
  const durationField = useMemo(
    () => findField(selectedOperation, "duration_sec"),
    [selectedOperation],
  );
  const resolutionField = useMemo(
    () => findField(selectedOperation, "resolution"),
    [selectedOperation],
  );
  const qualityField = useMemo(
    () =>
      selectedOperation?.fields.find(
        (field) => field.target === "provider_options" && field.key === "quality",
      ) ?? null,
    [selectedOperation],
  );
  const quickMediaFields = useMemo(() => {
    if (!selectedOperation) {
      return [];
    }
    const excluded = new Set<string>();
    if (promptField) {
      excluded.add(fieldKey(promptField));
    }
    if (durationField) {
      excluded.add(fieldKey(durationField));
    }
    if (resolutionField) {
      excluded.add(fieldKey(resolutionField));
    }
    if (qualityField) {
      excluded.add(fieldKey(qualityField));
    }
    const fileFields = selectedOperation.fields.filter((field) => {
      if (excluded.has(fieldKey(field))) {
        return false;
      }
      return field.input_type === "file" || field.input_type === "file_list";
    });
    const required = fileFields.filter((field) => field.required);
    if (required.length) {
      return required;
    }
    return fileFields.slice(0, 1);
  }, [durationField, promptField, qualityField, resolutionField, selectedOperation]);
  const advancedFields = useMemo(() => {
    if (!selectedOperation) {
      return [];
    }
    const excluded = new Set<string>();
    if (promptField) {
      excluded.add(fieldKey(promptField));
    }
    if (durationField) {
      excluded.add(fieldKey(durationField));
    }
    if (resolutionField) {
      excluded.add(fieldKey(resolutionField));
    }
    if (qualityField) {
      excluded.add(fieldKey(qualityField));
    }
    for (const field of quickMediaFields) {
      excluded.add(fieldKey(field));
    }
    return selectedOperation.fields.filter((field) => !excluded.has(fieldKey(field)));
  }, [durationField, promptField, qualityField, quickMediaFields, resolutionField, selectedOperation]);
  const advancedGroups = useMemo(
    () => groupAdvancedFields(advancedFields),
    [advancedFields],
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
  const imageProviders = useMemo(
    () => listVisibleProvidersByKind(providers, "image"),
    [providers],
  );
  const videoProviders = useMemo(
    () => listVisibleProvidersByKind(providers, "video"),
    [providers],
  );
  const currentGenerationKind: "image" | "video" = useMemo(
    () => (selectedProvider && isImageProviderType(selectedProvider.type) ? "image" : "video"),
    [selectedProvider],
  );
  const canSwitchGenerationKind = imageProviders.length > 0 && videoProviders.length > 0;
  const providerChoices = useMemo(
    () => listVisibleProvidersByKind(providers, currentGenerationKind),
    [currentGenerationKind, providers],
  );
  const resolutionValue = resolutionField ? values[fieldKey(resolutionField)] ?? "" : "";
  const qualityValue = qualityField ? values[fieldKey(qualityField)] ?? "" : "";
  const durationValue = durationField ? values[fieldKey(durationField)] ?? "" : "";
  const durationChoices = useMemo(
    () => (durationField ? durationOptionsFromField(durationField) : []),
    [durationField],
  );
  const resolutionChoices = useMemo(
    () => buildResolutionChoices(resolutionField, resolutionValue),
    [resolutionField, resolutionValue],
  );
  const resolutionMeta = useMemo(
    () => parseResolutionMeta(resolutionValue),
    [resolutionValue],
  );
  const ratioChoices = useMemo(
    () => Array.from(new Set(resolutionChoices.map((item) => item.ratio).filter(Boolean))),
    [resolutionChoices],
  );
  const sizeChoices = useMemo(
    () => Array.from(new Set(resolutionChoices.map((item) => item.size).filter(Boolean))),
    [resolutionChoices],
  );
  const qualityChoices = useMemo(
    () => (qualityField?.options ?? []).map((option) => option.value).filter(Boolean),
    [qualityField?.options],
  );
  const currentRatioDisplay = useMemo(() => {
    if (!resolutionField) {
      return "-";
    }
    if (resolutionMeta.ratio) {
      return resolutionMeta.ratio;
    }
    if (resolutionValue) {
      return resolutionValue;
    }
    return "-";
  }, [resolutionField, resolutionMeta.ratio, resolutionValue]);
  const currentSizeDisplay = useMemo(() => {
    if (qualityField) {
      if (!qualityValue) {
        return "-";
      }
      const matched = qualityField.options.find((option) => option.value === qualityValue);
      return matched?.label || qualityValue;
    }
    if (!resolutionField) {
      return "-";
    }
    if (resolutionMeta.size) {
      return resolutionMeta.size;
    }
    if (resolutionValue) {
      return resolutionValue;
    }
    return "-";
  }, [qualityField, qualityValue, resolutionField, resolutionMeta.size, resolutionValue]);
  const promptPlaceholder = useMemo(() => {
    if (!promptField) {
      return "";
    }
    if (promptField.placeholder?.trim()) {
      return promptField.placeholder;
    }
    return t("create.promptPlaceholder");
  }, [promptField, t]);

  useEffect(() => {
    if (currentGenerationKind !== "video" || !videoProviders.length) {
      return;
    }
    if (!videoProviders.some((provider) => provider.id === providerId)) {
      setProviderId(videoProviders[0].id);
    }
  }, [currentGenerationKind, providerId, videoProviders]);

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
      return createVideoTask(payload, settings.gatewayToken, selectedProvider?.type);
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
  const onGenerationKindChanged = (nextKind: "image" | "video") => {
    if (nextKind === currentGenerationKind) {
      return;
    }
    const nextProvider = pickProviderByKind(providers, nextKind, settings.defaultProvider);
    if (!nextProvider) {
      return;
    }
    setProviderId(nextProvider.id);
  };
  const toggleQuickItem = (key: string) => {
    setOpenQuickKey((current) => (current === key ? null : key));
  };
  const closeQuickItem = () => {
    setOpenQuickKey(null);
  };
  const onRatioChanged = (nextRatio: string) => {
    if (!resolutionField) {
      return;
    }
    const nextResolution = pickResolutionValue(resolutionField, resolutionValue, { ratio: nextRatio });
    if (!nextResolution) {
      return;
    }
    onFieldChanged(resolutionField, nextResolution);
  };
  const onSizeChanged = (nextSize: string) => {
    if (qualityField) {
      onFieldChanged(qualityField, nextSize);
      return;
    }
    if (!resolutionField) {
      return;
    }
    const nextResolution = pickResolutionValue(resolutionField, resolutionValue, { size: nextSize });
    if (!nextResolution) {
      return;
    }
    onFieldChanged(resolutionField, nextResolution);
  };

  if (loading) {
    return <section className="panel">{t("create.loadingCatalog")}</section>;
  }
  if (!selectedProvider || !selectedModel || !selectedOperation) {
    return <section className="panel">{t("create.noAvailable")}</section>;
  }

  return (
    <section className="panel create-panel">
      <form
        className="create-flow"
        onSubmit={(event) => {
          event.preventDefault();
          void submitMutation.mutateAsync();
        }}
      >
        <section className="focus-composer">
          {promptField ? (
            <label
              className="prompt-editor"
              onClick={closeQuickItem}
              onFocusCapture={closeQuickItem}
            >
              <div className="prompt-editor-head">
                <span>{promptField.label}</span>
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
              <DynamicInput
                field={promptField}
                value={values[fieldKey(promptField)] ?? ""}
                onValueChange={(next) => onFieldChanged(promptField, next)}
                onFileChange={() => undefined}
                placeholder={promptPlaceholder}
              />
              {promptField.help_text ? <small>{promptField.help_text}</small> : null}
            </label>
          ) : (
            <p className="hint">{t("create.promptNotSupported")}</p>
          )}

          <section className="quick-bar">
            <div className={openQuickKey === "kind" ? "quick-item open" : "quick-item"}>
              <button
                type="button"
                className="quick-trigger"
                onClick={() => toggleQuickItem("kind")}
              >
                <span>{t("create.quickType")}</span>
                <strong>
                  {currentGenerationKind === "image"
                    ? t("create.quickImage")
                    : t("create.quickVideo")}
                </strong>
              </button>
              {openQuickKey === "kind" ? (
                <div className="quick-popover quick-popover-segment">
                  <button
                    type="button"
                    className={currentGenerationKind === "video" ? "chip-button active" : "chip-button"}
                    onClick={() => {
                      onGenerationKindChanged("video");
                      closeQuickItem();
                    }}
                    disabled={!canSwitchGenerationKind}
                  >
                    {t("create.quickVideo")}
                  </button>
                  <button
                    type="button"
                    className={currentGenerationKind === "image" ? "chip-button active" : "chip-button"}
                    onClick={() => {
                      onGenerationKindChanged("image");
                      closeQuickItem();
                    }}
                    disabled={!canSwitchGenerationKind}
                  >
                    {t("create.quickImage")}
                  </button>
                </div>
              ) : null}
            </div>

            <div className={openQuickKey === "provider" ? "quick-item open" : "quick-item"}>
              <button
                type="button"
                className="quick-trigger"
                onClick={() => toggleQuickItem("provider")}
              >
                <span>{t("create.provider")}</span>
                <strong>{selectedProvider.display_name}</strong>
              </button>
              {openQuickKey === "provider" ? (
                <div className="quick-popover">
                  <div className="quick-option-list">
                    {providerChoices.map((provider) => (
                      <button
                        type="button"
                        key={provider.id}
                        className={
                          provider.id === providerId
                            ? "quick-option-button active"
                            : "quick-option-button"
                        }
                        onClick={() => {
                          setProviderId(provider.id);
                          closeQuickItem();
                        }}
                      >
                        <strong>{provider.display_name}</strong>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className={openQuickKey === "model" ? "quick-item open" : "quick-item"}>
              <button
                type="button"
                className="quick-trigger"
                onClick={() => toggleQuickItem("model")}
              >
                <span>{t("create.model")}</span>
                <strong>{selectedModel.display_name}</strong>
              </button>
              {openQuickKey === "model" ? (
                <div className="quick-popover">
                  <div className="quick-option-list">
                    {selectedProvider.models.map((model) => (
                      <button
                        type="button"
                        key={model.name}
                        className={
                          model.name === modelName ? "quick-option-button active" : "quick-option-button"
                        }
                        onClick={() => {
                          setModelName(model.name);
                          closeQuickItem();
                        }}
                      >
                        <strong>{model.display_name}</strong>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className={openQuickKey === "mode" ? "quick-item open" : "quick-item"}>
              <button
                type="button"
                className="quick-trigger"
                onClick={() => toggleQuickItem("mode")}
              >
                <span>{t("create.quickMode")}</span>
                <strong>{selectedOperation.display_name}</strong>
              </button>
              {openQuickKey === "mode" ? (
                <div className="quick-popover">
                  <div className="quick-option-list">
                    {selectedModel.operations.map((operation) => (
                      <button
                        type="button"
                        key={operation.id}
                        className={
                          operation.id === selectedOperation.id
                            ? "quick-option-button active"
                            : "quick-option-button"
                        }
                        onClick={() => {
                          setOperationId(operation.id);
                          closeQuickItem();
                        }}
                      >
                        <strong>{operation.display_name}</strong>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            <div className={openQuickKey === "ratio" ? "quick-item open" : "quick-item"}>
              <button
                type="button"
                className="quick-trigger"
                onClick={() => toggleQuickItem("ratio")}
              >
                <span>{t("create.quickRatio")}</span>
                <strong>{currentRatioDisplay}</strong>
              </button>
              {openQuickKey === "ratio" ? (
                <div className="quick-popover quick-popover-grid">
                  {(ratioChoices.length ? ratioChoices : [resolutionValue]).filter(Boolean).map((ratio) => (
                    <button
                      type="button"
                      key={ratio}
                      className={currentRatioDisplay === ratio ? "chip-button active" : "chip-button"}
                      onClick={() => {
                        onRatioChanged(ratio);
                        closeQuickItem();
                      }}
                      disabled={!resolutionField}
                    >
                      {ratio}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className={openQuickKey === "size" ? "quick-item open" : "quick-item"}>
              <button
                type="button"
                className="quick-trigger"
                onClick={() => toggleQuickItem("size")}
              >
                <span>{t("create.quickSize")}</span>
                <strong>{currentSizeDisplay}</strong>
              </button>
              {openQuickKey === "size" ? (
                <div className="quick-popover quick-popover-grid">
                  {(qualityField ? qualityChoices : sizeChoices).map((size) => {
                    const active = qualityField ? qualityValue === size : currentSizeDisplay === size;
                    const display = qualityField
                      ? qualityField.options.find((option) => option.value === size)?.label ?? size
                      : size;
                    return (
                      <button
                        type="button"
                        key={size}
                        className={active ? "chip-button active" : "chip-button"}
                        onClick={() => {
                          onSizeChanged(size);
                          closeQuickItem();
                        }}
                      >
                        {display}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>

            {durationField ? (
              <div className={openQuickKey === "duration" ? "quick-item open" : "quick-item"}>
                <button
                  type="button"
                  className="quick-trigger"
                  onClick={() => toggleQuickItem("duration")}
                >
                  <span>{t("create.quickDuration")}</span>
                  <strong>{durationValue ? `${durationValue}s` : "-"}</strong>
                </button>
                {openQuickKey === "duration" ? (
                  durationChoices.length ? (
                    <div className="quick-popover quick-popover-grid">
                      {durationChoices.map((seconds) => (
                        <button
                          type="button"
                          key={seconds}
                          className={
                            durationValue === String(seconds) ? "chip-button active" : "chip-button"
                          }
                          onClick={() => {
                            onFieldChanged(durationField, String(seconds));
                            closeQuickItem();
                          }}
                        >
                          {seconds}s
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="quick-popover">
                      <DynamicInput
                        field={durationField}
                        value={durationValue}
                        onValueChange={(next) => onFieldChanged(durationField, next)}
                        onFileChange={() => undefined}
                      />
                    </div>
                  )
                ) : null}
              </div>
            ) : null}
          </section>

          {quickMediaFields.length ? (
            <section className="quick-media-fields">
              {quickMediaFields.map((field) =>
                renderField(field, values, onFieldChanged, setFiles, "compact"),
              )}
            </section>
          ) : null}

          <div className="focus-actions">
            <div className="status-line">
              <p className="hint">
                {settings.showEstimatedCostPreSubmit && estimateQuery.data?.estimated_cost != null
                  ? t("create.estimated", {
                      cost: estimateQuery.data.estimated_cost.toFixed(3),
                      currency: estimateQuery.data.currency ?? settings.currency,
                    })
                  : t("create.estimatedUnavailable")}
              </p>
              {hint ? <p className="hint">{hint}</p> : null}
            </div>
            <button
              type="submit"
              className="primary-button"
              disabled={submitMutation.isPending}
            >
              {submitMutation.isPending
                ? t("create.submitting")
                : selectedProvider.type === "tuzi_image"
                  ? t("create.generateImage")
                  : t("create.generateVideo")}
            </button>
          </div>
        </section>

        {promptField ? (
          <section className="support-sections">
            <details className="support-details">
              <summary>{t("create.promptPresets")}</summary>
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
            </details>

            {settings.savePromptHistory ? (
              <details className="support-details">
                <summary>{t("create.recentPrompts")}</summary>
                <div className="recent-prompts-header">
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
              </details>
            ) : null}
          </section>
        ) : null}

        <details className="advanced-drawer">
          <summary>{t("create.advancedOptions", { count: advancedFields.length })}</summary>
          <div className="advanced-panel">
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

            {advancedGroups.length
              ? (
                  <section className="advanced-groups">
                    {advancedGroups.map((group, index) => (
                      <details
                        key={group.id}
                        className="advanced-group"
                        open={index === 0}
                      >
                        <summary>
                          {t(`create.advancedGroup.${group.id}`)} ({group.fields.length})
                        </summary>
                        <div className="dynamic-grid">
                          {group.fields.map((field) =>
                            renderField(field, values, onFieldChanged, setFiles),
                          )}
                        </div>
                      </details>
                    ))}
                  </section>
                )
              : null}
          </div>
        </details>
      </form>
    </section>
  );
}

function DynamicInput(props: {
  field: ProviderOperationField;
  value: string;
  onValueChange: (value: string) => void;
  onFileChange: (files: File[]) => void;
  placeholder?: string;
}) {
  const { field, value, onValueChange, onFileChange, placeholder } = props;
  const resolvedPlaceholder = placeholder ?? field.placeholder ?? "";
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
        placeholder={resolvedPlaceholder}
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
        placeholder={resolvedPlaceholder}
        onChange={(event) => onValueChange(event.target.value)}
      />
    );
  }
  return (
    <input
      type={field.input_type === "password" ? "password" : "text"}
      value={value}
      required={field.required}
      placeholder={resolvedPlaceholder}
      onChange={(event) => onValueChange(event.target.value)}
    />
  );
}

function isImageProviderType(providerType: string): boolean {
  return providerType.toLowerCase().includes("image");
}

function pickProviderByKind(
  providers: ProviderInfo[],
  kind: "image" | "video",
  preferredProviderId: string,
): ProviderInfo | null {
  const matches = listVisibleProvidersByKind(providers, kind);
  if (!matches.length) {
    return null;
  }
  return matches.find((provider) => provider.id === preferredProviderId) ?? matches[0];
}

function listVisibleProvidersByKind(
  providers: ProviderInfo[],
  kind: "image" | "video",
): ProviderInfo[] {
  const filtered = providers.filter((provider) =>
    kind === "image" ? isImageProviderType(provider.type) : !isImageProviderType(provider.type),
  );
  if (kind === "image") {
    return filtered;
  }
  const visible = filtered.filter((provider) => !HIDDEN_VIDEO_PROVIDER_IDS.has(provider.id));
  if (!visible.length) {
    return [];
  }
  return sortProvidersByPriority(visible, VIDEO_PROVIDER_PRIORITY);
}

function sortProvidersByPriority(
  providers: ProviderInfo[],
  priority: string[],
): ProviderInfo[] {
  const rank = new Map(priority.map((id, index) => [id, index]));
  const indexed = providers.map((provider, index) => ({ provider, index }));
  indexed.sort((left, right) => {
    const leftRank = rank.get(left.provider.id);
    const rightRank = rank.get(right.provider.id);
    const leftOrder = leftRank == null ? Number.MAX_SAFE_INTEGER : leftRank;
    const rightOrder = rightRank == null ? Number.MAX_SAFE_INTEGER : rightRank;
    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }
    return left.index - right.index;
  });
  return indexed.map((item) => item.provider);
}

interface ResolutionChoice {
  value: string;
  ratio: string;
  size: string;
}

function buildResolutionChoices(
  field: ProviderOperationField | null,
  currentValue: string,
): ResolutionChoice[] {
  if (!field) {
    return [];
  }
  const values = (field.options ?? []).map((option) => option.value).filter(Boolean);
  if (!values.length && currentValue.trim()) {
    values.push(currentValue.trim());
  }
  return values.map((value) => {
    const parsed = parseResolutionMeta(value);
    return {
      value,
      ratio: parsed.ratio,
      size: parsed.size,
    };
  });
}

function pickResolutionValue(
  field: ProviderOperationField,
  currentValue: string,
  matcher: { ratio?: string; size?: string },
): string | null {
  const choices = buildResolutionChoices(field, currentValue);
  if (!choices.length) {
    return null;
  }
  const current = parseResolutionMeta(currentValue);
  const targetRatio = matcher.ratio ?? current.ratio;
  const targetSize = matcher.size ?? current.size;

  const fullMatch = choices.find(
    (item) =>
      (!targetRatio || item.ratio === targetRatio) &&
      (!targetSize || item.size === targetSize),
  );
  if (fullMatch) {
    return fullMatch.value;
  }
  const ratioMatch = choices.find((item) => !targetRatio || item.ratio === targetRatio);
  if (ratioMatch) {
    return ratioMatch.value;
  }
  const sizeMatch = choices.find((item) => !targetSize || item.size === targetSize);
  if (sizeMatch) {
    return sizeMatch.value;
  }
  return choices[0].value;
}

function parseResolutionMeta(raw: string): { ratio: string; size: string } {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    return { ratio: "", size: "" };
  }
  const ratioMatch = normalized.match(/^(\d+)\s*:\s*(\d+)$/);
  if (ratioMatch) {
    return {
      ratio: `${Number(ratioMatch[1])}:${Number(ratioMatch[2])}`,
      size: "",
    };
  }

  const resolutionMatch = normalized.match(/^(\d+)\s*[x]\s*(\d+)$/);
  if (resolutionMatch) {
    const width = Number(resolutionMatch[1]);
    const height = Number(resolutionMatch[2]);
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return {
        ratio: normalizeAspectRatio(width, height),
        size: `${Math.min(width, height)}P`,
      };
    }
  }

  const sizeMatch = normalized.match(/^(\d+)\s*p$/);
  if (sizeMatch) {
    return {
      ratio: "",
      size: `${Number(sizeMatch[1])}P`,
    };
  }
  return {
    ratio: raw.trim(),
    size: raw.trim(),
  };
}

function normalizeAspectRatio(width: number, height: number): string {
  const target = width / height;
  const candidates: Array<[string, number]> = [
    ["21:9", 21 / 9],
    ["16:9", 16 / 9],
    ["9:16", 9 / 16],
    ["4:3", 4 / 3],
    ["3:4", 3 / 4],
    ["1:1", 1],
    ["3:2", 3 / 2],
    ["2:3", 2 / 3],
    ["4:5", 4 / 5],
    ["5:4", 5 / 4],
  ];
  let best = candidates[0];
  let diff = Math.abs(target - best[1]);
  for (let index = 1; index < candidates.length; index += 1) {
    const currentDiff = Math.abs(target - candidates[index][1]);
    if (currentDiff < diff) {
      diff = currentDiff;
      best = candidates[index];
    }
  }
  if (diff <= 0.12) {
    return best[0];
  }
  const divisor = greatestCommonDivisor(width, height);
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(Math.round(left));
  let b = Math.abs(Math.round(right));
  while (b !== 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a || 1;
}

function renderField(
  field: ProviderOperationField,
  values: Record<string, string>,
  onFieldChanged: (field: ProviderOperationField, nextValue: string) => void,
  setFiles: Dispatch<SetStateAction<Record<string, File[]>>>,
  variant: "default" | "compact" = "default",
) {
  const key = fieldKey(field);
  const value = values[key] ?? "";
  const className =
    variant === "compact"
      ? "field field-compact"
      : isPromptLike(field)
        ? "field field-wide"
        : "field";
  return (
    <label key={key} className={className}>
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

function groupAdvancedFields(fields: ProviderOperationField[]): AdvancedGroup[] {
  const groups: AdvancedGroup[] = [
    { id: "inputs", fields: [] },
    { id: "prompt", fields: [] },
    { id: "behavior", fields: [] },
    { id: "runtime", fields: [] },
    { id: "developer", fields: [] },
    { id: "misc", fields: [] },
  ];
  const byId = new Map(groups.map((group) => [group.id, group]));

  for (const field of fields) {
    const key = field.key.toLowerCase();
    let id: AdvancedGroup["id"] = "misc";
    if (isRuntimeKey(key, field)) {
      id = "runtime";
    } else if (isInputKey(key, field)) {
      id = "inputs";
    } else if (isDeveloperKey(key, field)) {
      id = "developer";
    } else if (isPromptControlKey(key)) {
      id = "prompt";
    } else if (isBehaviorKey(key, field)) {
      id = "behavior";
    }
    byId.get(id)?.fields.push(field);
  }

  return groups.filter((group) => group.fields.length > 0);
}

function isRuntimeKey(key: string, field: ProviderOperationField): boolean {
  if (field.input_type === "password") {
    return true;
  }
  return (
    key.includes("timeout") ||
    key.includes("poll_interval") ||
    key === "api_key"
  );
}

function isInputKey(key: string, field: ProviderOperationField): boolean {
  if (field.input_type === "file" || field.input_type === "file_list") {
    return true;
  }
  return (
    key.includes("reference") ||
    key.includes("image") ||
    key.includes("frame") ||
    key.includes("mask") ||
    key.includes("source_video")
  );
}

function isDeveloperKey(key: string, field: ProviderOperationField): boolean {
  if (field.input_type === "json") {
    return true;
  }
  return (
    key.includes("workflow") ||
    key.includes("node_id") ||
    key.includes("input_key")
  );
}

function isPromptControlKey(key: string): boolean {
  return key.includes("negative_prompt") || key === "seed";
}

function isBehaviorKey(key: string, field: ProviderOperationField): boolean {
  return (
    key.includes("character") ||
    key === "watermark" ||
    key === "response_format" ||
    key === "user" ||
    key === "fps" ||
    field.input_type === "boolean"
  );
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
