import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  createVideoTask,
  estimatePricing,
  fetchUploadedFileBinary,
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
  VideoTaskDetail,
} from "../types";
import {
  durationOptionsFromField,
  errorMessage,
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
  tasks: VideoTaskDetail[];
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
const LAST_SUBMITTED_TASK_KEY = "scenewords_last_submitted_task_v1";
const LAST_SUBMITTED_TASK_MAX_AGE_MS = 24 * 60 * 60 * 1000;
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
  const { catalog, loading, tasks } = props;
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
  const [reusedFileIds, setReusedFileIds] = useState<Record<string, string[]>>({});
  const [hint, setHint] = useState("");
  const [recentPromptVersion, setRecentPromptVersion] = useState(0);
  const [presetVersion, setPresetVersion] = useState(0);
  const [openQuickKey, setOpenQuickKey] = useState<string | null>(null);
  const [lastSubmittedTaskId, setLastSubmittedTaskId] = useState<string | null>(() =>
    readLastSubmittedTaskId(),
  );
  const skipNextPendingClearHydrationRef = useRef(false);

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
  const orientationField = useMemo(
    () =>
      selectedOperation?.fields.find(
        (field) => field.target === "provider_options" && field.key === "orientation_mode",
      ) ?? null,
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
    if (orientationField) {
      excluded.add(fieldKey(orientationField));
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
  }, [durationField, orientationField, promptField, qualityField, resolutionField, selectedOperation]);
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
    if (orientationField) {
      excluded.add(fieldKey(orientationField));
    }
    for (const field of quickMediaFields) {
      excluded.add(fieldKey(field));
    }
    return selectedOperation.fields.filter((field) => !excluded.has(fieldKey(field)));
  }, [durationField, orientationField, promptField, qualityField, quickMediaFields, resolutionField, selectedOperation]);
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
  const inProgressCount = useMemo(
    () => tasks.filter((task) => task.status === "queued" || task.status === "running").length,
    [tasks],
  );
  const trackedTask = useMemo(
    () =>
      lastSubmittedTaskId
        ? tasks.find((task) => task.task_id === lastSubmittedTaskId) ?? null
        : null,
    [lastSubmittedTaskId, tasks],
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
  const orientationValue = orientationField ? values[fieldKey(orientationField)] ?? "" : "";
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
  const orientationChoices = useMemo(
    () => orientationField?.options ?? [],
    [orientationField?.options],
  );
  const hasQuickSize = useMemo(
    () => Boolean((qualityField && qualityChoices.length) || sizeChoices.length),
    [qualityChoices.length, qualityField, sizeChoices.length],
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
    if (!hasQuickSize) {
      return "-";
    }
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
    return "-";
  }, [hasQuickSize, qualityField, qualityValue, resolutionField, resolutionMeta.size]);
  const currentOrientationDisplay = useMemo(() => {
    if (!orientationField) {
      return "-";
    }
    if (!orientationValue) {
      return "-";
    }
    const matched = orientationChoices.find((option) => option.value === orientationValue);
    return matched?.label ?? orientationValue;
  }, [orientationChoices, orientationField, orientationValue]);
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
    persistLastSubmittedTaskId(lastSubmittedTaskId);
  }, [lastSubmittedTaskId]);

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
    if (skipNextPendingClearHydrationRef.current && !settings.pendingReuseDraft) {
      skipNextPendingClearHydrationRef.current = false;
      return;
    }
    const previousPrompt = values["request:prompt"] ?? "";
    const hydrated: Record<string, string> = {};
    const hydratedReusedFileIds: Record<string, string[]> = {};
    for (const field of selectedOperation.fields) {
      const key = fieldKey(field);
      const existingReused = reusedFileIds[key];
      if (
        (field.input_type === "file" || field.input_type === "file_list") &&
        Array.isArray(existingReused) &&
        existingReused.length > 0
      ) {
        hydratedReusedFileIds[key] = existingReused;
      }
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
      const applied = applyDraft(hydrated, selectedOperation, pending);
      Object.assign(hydratedReusedFileIds, applied.reusedFileIds);
      skipNextPendingClearHydrationRef.current = true;
      settings.setPendingReuseDraft(null);
      setHint(
        applied.reusedFileCount > 0
          ? t("create.hintReusedDraftWithFiles", { count: applied.reusedFileCount })
          : t("create.hintReusedDraft"),
      );
      navigate("/create");
    }

    // Keep the current prompt when switching model/operation unless the target already has one.
    if (promptField) {
      const promptKey = fieldKey(promptField);
      if (!hydrated[promptKey] && previousPrompt.trim()) {
        hydrated[promptKey] = previousPrompt;
      }
    }

    setValues(hydrated);
    setFiles({});
    setReusedFileIds(hydratedReusedFileIds);
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
          const reusableIds = reusedFileIds[key] ?? [];
          if (!selectedFiles.length) {
            if (reusableIds.length) {
              const reusableValue =
                field.input_type === "file" ? (reusableIds[0] ?? null) : reusableIds;
              if (field.target === "request") {
                requestPayload[field.key] = reusableValue;
              } else {
                payload.provider_options[field.key] = reusableValue;
              }
              continue;
            }
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
            field.input_type === "file"
              ? (uploadedIds[0] ?? null)
              : Array.from(new Set([...reusableIds, ...uploadedIds]));
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
      setLastSubmittedTaskId(response.task_id);
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

  const onFileFieldChanged = (field: ProviderOperationField, nextFiles: File[]) => {
    const key = fieldKey(field);
    setFiles((current) => ({ ...current, [key]: nextFiles }));
    if (field.input_type === "file") {
      setReusedFileIds((current) => {
        if (!current[key]) {
          return current;
        }
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
  };

  const onReusedFileIdsChanged = (field: ProviderOperationField, nextFileIds: string[]) => {
    const key = fieldKey(field);
    setReusedFileIds((current) => {
      if (!nextFileIds.length) {
        if (!current[key]) {
          return current;
        }
        const next = { ...current };
        delete next[key];
        return next;
      }
      return { ...current, [key]: nextFileIds };
    });
  };

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
  const onOrientationChanged = (nextOrientation: string) => {
    if (!orientationField) {
      return;
    }
    onFieldChanged(orientationField, nextOrientation);
    if (!resolutionField) {
      return;
    }
    if (nextOrientation !== "landscape" && nextOrientation !== "portrait") {
      return;
    }
    const nextResolution = pickResolutionValueByOrientation(
      resolutionField,
      resolutionValue,
      nextOrientation,
    );
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
  const statusLabel = (task: VideoTaskDetail): string => {
    if (task.status === "queued") {
      if (task.queue_position != null && task.queue_position > 0) {
        return t("create.feedbackQueuedWithPosition", { position: task.queue_position });
      }
      return t("create.feedbackQueued");
    }
    if (task.status === "running") {
      return t("create.feedbackRunning");
    }
    if (task.status === "succeeded") {
      return t("create.feedbackSucceeded");
    }
    if (task.status === "failed") {
      return t("create.feedbackFailed");
    }
    if (task.status === "canceled") {
      return t("create.feedbackCanceled");
    }
    return task.status;
  };
  const statusTone = (task: VideoTaskDetail | null): "warn" | "ok" | "danger" | "muted" => {
    if (!task) {
      return "muted";
    }
    if (task.status === "queued" || task.status === "running") {
      return "warn";
    }
    if (task.status === "succeeded") {
      return "ok";
    }
    if (task.status === "failed" || task.status === "canceled") {
      return "danger";
    }
    return "muted";
  };
  const trackedOtherInProgressCount = useMemo(() => {
    if (!trackedTask) {
      return inProgressCount;
    }
    const trackedInProgress = trackedTask.status === "queued" || trackedTask.status === "running";
    return trackedInProgress ? Math.max(0, inProgressCount - 1) : inProgressCount;
  }, [inProgressCount, trackedTask]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-gray-400 text-sm">
        {t("create.loadingCatalog")}
      </div>
    );
  }
  if (!selectedProvider || !selectedModel || !selectedOperation) {
    return (
      <div className="flex items-center justify-center py-32 text-gray-400 text-sm">
        {t("create.noAvailable")}
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-8 md:px-20 py-8 flex flex-col gap-7 items-center">
      <form
        className="w-full flex flex-col gap-7"
        onSubmit={(event) => {
          event.preventDefault();
          void submitMutation.mutateAsync();
        }}
      >
        {/* ── Generation Type Tabs ──────────────────── */}
        {canSwitchGenerationKind ? (
          <div className="flex justify-center">
            <div className="inline-flex items-center gap-1 bg-surface rounded-xl p-1">
              <button
                type="button"
                className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${currentGenerationKind === "image"
                  ? "bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  }`}
                onClick={() => onGenerationKindChanged("image")}
              >
                🖼️ {t("create.quickImage")}
              </button>
              <button
                type="button"
                className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${currentGenerationKind === "video"
                  ? "bg-white dark:bg-gray-700 shadow-sm text-gray-900 dark:text-white"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  }`}
                onClick={() => onGenerationKindChanged("video")}
              >
                🎬 {t("create.quickVideo")}
              </button>
            </div>
          </div>
        ) : null}

        {/* ── Prompt Section ───────────────────────── */}
        <div className="flex flex-col gap-4 w-full">
          {/* Prompt Box */}
          {promptField ? (
            <div
              className="bg-surface rounded-2xl p-5 flex flex-col gap-3"
              onClick={closeQuickItem}
              onFocusCapture={closeQuickItem}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{promptField.label}</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                    onClick={() => onFieldChanged(promptField, "")}
                  >
                    {t("create.clearPrompt")}
                  </button>
                  <button
                    type="button"
                    className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
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
              {promptField.help_text ? (
                <small className="text-xs text-gray-400">{promptField.help_text}</small>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-gray-400">{t("create.promptNotSupported")}</p>
          )}

          {/* ── Params Row ─────────────────────────── */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Provider selector */}
            <div className="relative">
              <button
                type="button"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-all ${openQuickKey === "provider"
                  ? "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 shadow-sm"
                  : "border-transparent hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300"
                  }`}
                onClick={() => toggleQuickItem("provider")}
              >
                <span className="text-gray-400">{t("create.provider")}</span>
                <span className="font-medium text-gray-800 dark:text-gray-100">{selectedProvider.display_name}</span>
                <span className="text-gray-300">▾</span>
              </button>
              {openQuickKey === "provider" ? (
                <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg py-1 z-20 min-w-[180px]">
                  {providerChoices.map((provider) => (
                    <button
                      type="button"
                      key={provider.id}
                      className={`w-full text-left px-3 py-2 text-sm transition-colors ${provider.id === providerId
                        ? "bg-gray-50 dark:bg-gray-700 font-medium text-gray-900 dark:text-white"
                        : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50"
                        }`}
                      onClick={() => {
                        setProviderId(provider.id);
                        closeQuickItem();
                      }}
                    >
                      {provider.display_name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {/* Model selector */}
            <div className="relative">
              <button
                type="button"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-all ${openQuickKey === "model"
                  ? "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 shadow-sm"
                  : "border-transparent hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300"
                  }`}
                onClick={() => toggleQuickItem("model")}
              >
                <span className="text-gray-400">{t("create.model")}</span>
                <span className="font-medium text-gray-800 dark:text-gray-100">{selectedModel.display_name}</span>
                <span className="text-gray-300">▾</span>
              </button>
              {openQuickKey === "model" ? (
                <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg py-1 z-20 min-w-[180px]">
                  {selectedProvider.models.map((model) => (
                    <button
                      type="button"
                      key={model.name}
                      className={`w-full text-left px-3 py-2 text-sm transition-colors ${model.name === modelName
                        ? "bg-gray-50 dark:bg-gray-700 font-medium text-gray-900 dark:text-white"
                        : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50"
                        }`}
                      onClick={() => {
                        setModelName(model.name);
                        closeQuickItem();
                      }}
                    >
                      {model.display_name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {/* Mode selector */}
            <div className="relative">
              <button
                type="button"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-all ${openQuickKey === "mode"
                  ? "border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 shadow-sm"
                  : "border-transparent hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300"
                  }`}
                onClick={() => toggleQuickItem("mode")}
              >
                <span className="text-gray-400">{t("create.quickMode")}</span>
                <span className="font-medium text-gray-800 dark:text-gray-100">{selectedOperation.display_name}</span>
                <span className="text-gray-300">▾</span>
              </button>
              {openQuickKey === "mode" ? (
                <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg py-1 z-20 min-w-[180px]">
                  {selectedModel.operations.map((operation) => (
                    <button
                      type="button"
                      key={operation.id}
                      className={`w-full text-left px-3 py-2 text-sm transition-colors ${operation.id === selectedOperation.id
                        ? "bg-gray-50 dark:bg-gray-700 font-medium text-gray-900 dark:text-white"
                        : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50"
                        }`}
                      onClick={() => {
                        setOperationId(operation.id);
                        closeQuickItem();
                      }}
                    >
                      {operation.display_name}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="h-4 w-px bg-gray-200" />

            {/* Ratio selector */}
            <div className="relative">
              <button
                type="button"
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-all ${openQuickKey === "ratio"
                  ? "border-gray-300 bg-white shadow-sm"
                  : "border-transparent hover:bg-gray-100 text-gray-600"
                  }`}
                onClick={() => toggleQuickItem("ratio")}
              >
                <span className="text-gray-400">{t("create.quickRatio")}</span>
                <span className="font-medium text-gray-800">{currentRatioDisplay}</span>
                <span className="text-gray-300">▾</span>
              </button>
              {openQuickKey === "ratio" ? (
                <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg p-2 z-20 flex flex-wrap gap-1.5 min-w-[180px]">
                  {(ratioChoices.length ? ratioChoices : [resolutionValue]).filter(Boolean).map((ratio) => (
                    <button
                      type="button"
                      key={ratio}
                      className={`px-3 py-1 rounded-lg text-sm transition-all ${currentRatioDisplay === ratio
                        ? "bg-gray-800 text-white"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                        }`}
                      onClick={() => { onRatioChanged(ratio); closeQuickItem(); }}
                      disabled={!resolutionField}
                    >
                      {ratio}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {/* Orientation selector */}
            {orientationField ? (
              <div className="relative">
                <button
                  type="button"
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-all ${openQuickKey === "orientation"
                    ? "border-gray-300 bg-white shadow-sm"
                    : "border-transparent hover:bg-gray-100 text-gray-600"
                    }`}
                  onClick={() => toggleQuickItem("orientation")}
                >
                  <span className="text-gray-400">{t("create.quickOrientation")}</span>
                  <span className="font-medium text-gray-800">{currentOrientationDisplay}</span>
                  <span className="text-gray-300">▾</span>
                </button>
                {openQuickKey === "orientation" ? (
                  <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg p-2 z-20 flex flex-wrap gap-1.5 min-w-[160px]">
                    {orientationChoices.map((option) => (
                      <button
                        type="button"
                        key={option.value}
                        className={`px-3 py-1 rounded-lg text-sm transition-all ${orientationValue === option.value
                          ? "bg-gray-800 text-white"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                          }`}
                        onClick={() => { onOrientationChanged(option.value); closeQuickItem(); }}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Size / Quality */}
            {hasQuickSize ? (
              <div className="relative">
                <button
                  type="button"
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-all ${openQuickKey === "size"
                    ? "border-gray-300 bg-white shadow-sm"
                    : "border-transparent hover:bg-gray-100 text-gray-600"
                    }`}
                  onClick={() => toggleQuickItem("size")}
                >
                  <span className="text-gray-400">{t("create.quickSize")}</span>
                  <span className="font-medium text-gray-800">{currentSizeDisplay}</span>
                  <span className="text-gray-300">▾</span>
                </button>
                {openQuickKey === "size" ? (
                  <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg p-2 z-20 flex flex-wrap gap-1.5 min-w-[160px]">
                    {(qualityField ? qualityChoices : sizeChoices).map((size) => {
                      const active = qualityField ? qualityValue === size : currentSizeDisplay === size;
                      const display = qualityField
                        ? qualityField.options.find((option) => option.value === size)?.label ?? size
                        : size;
                      return (
                        <button
                          type="button"
                          key={size}
                          className={`px-3 py-1 rounded-lg text-sm transition-all ${active
                            ? "bg-gray-800 text-white"
                            : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                            }`}
                          onClick={() => { onSizeChanged(size); closeQuickItem(); }}
                        >
                          {display}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Duration */}
            {durationField ? (
              <div className="relative">
                <button
                  type="button"
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-all ${openQuickKey === "duration"
                    ? "border-gray-300 bg-white shadow-sm"
                    : "border-transparent hover:bg-gray-100 text-gray-600"
                    }`}
                  onClick={() => toggleQuickItem("duration")}
                >
                  <span className="text-gray-400">{t("create.quickDuration")}</span>
                  <span className="font-medium text-gray-800">{durationValue ? `${durationValue}s` : "-"}</span>
                  <span className="text-gray-300">▾</span>
                </button>
                {openQuickKey === "duration" ? (
                  durationChoices.length ? (
                    <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg p-2 z-20 flex flex-wrap gap-1.5 min-w-[140px]">
                      {durationChoices.map((seconds) => (
                        <button
                          type="button"
                          key={seconds}
                          className={`px-3 py-1 rounded-lg text-sm transition-all ${durationValue === String(seconds)
                            ? "bg-gray-800 text-white"
                            : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                            }`}
                          onClick={() => { onFieldChanged(durationField, String(seconds)); closeQuickItem(); }}
                        >
                          {seconds}s
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg p-3 z-20 min-w-[160px]">
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
          </div>

          {/* ── Quick Media Fields ──────────────────── */}
          {quickMediaFields.length ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {quickMediaFields.map((field) =>
                renderField(
                  field,
                  values,
                  files,
                  reusedFileIds,
                  onFieldChanged,
                  onFileFieldChanged,
                  onReusedFileIdsChanged,
                  "compact",
                ),
              )}
            </div>
          ) : null}

          {/* ── Advanced Toggle ─────────────────────── */}
          <details className="group">
            <summary className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-600 cursor-pointer transition-colors select-none py-1">
              <span className="group-open:rotate-90 transition-transform text-xs">▶</span>
              {t("create.advancedOptions", { count: advancedFields.length })}
            </summary>
            <div className="mt-3 flex flex-col gap-3">
              {showVeoPromptGuide ? (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50 rounded-xl p-4 text-sm">
                  <h4 className="font-semibold text-blue-800 dark:text-blue-300 mb-1">{t("create.veoPromptGuideTitle")}</h4>
                  <p className="text-blue-600 dark:text-blue-400 mb-2">{t("create.veoPromptGuideDesc")}</p>
                  <div className="flex gap-3">
                    <a href={VEO_PROMPT_GUIDE_LINK_DOCS} target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 underline hover:text-blue-800 dark:hover:text-blue-200">
                      {t("create.veoPromptGuideLinkDocs")}
                    </a>
                    <a href={VEO_PROMPT_GUIDE_LINK_BLOG} target="_blank" rel="noreferrer" className="text-blue-600 underline hover:text-blue-800">
                      {t("create.veoPromptGuideLinkBlog")}
                    </a>
                  </div>
                </div>
              ) : null}
              {advancedGroups.map((group, index) => (
                <details key={group.id} open={index === 0} className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                  <summary className="px-4 py-2.5 bg-gray-50 dark:bg-gray-800 text-sm font-medium text-gray-700 dark:text-gray-200 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                    {t(`create.advancedGroup.${group.id}`)} ({group.fields.length})
                  </summary>
                  <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {group.fields.map((field) =>
                      renderField(field, values, files, reusedFileIds, onFieldChanged, onFileFieldChanged, onReusedFileIdsChanged),
                    )}
                  </div>
                </details>
              ))}
            </div>
          </details>
        </div>

        {/* ── Generate Button + Status ─────────────── */}
        <div className="flex items-center gap-4">
          <div className="flex-1 flex flex-col gap-0.5">
            <p className="text-xs text-gray-400 m-0">
              {settings.showEstimatedCostPreSubmit && estimateQuery.data?.estimated_cost != null
                ? t("create.estimated", {
                  cost: estimateQuery.data.estimated_cost.toFixed(3),
                  currency: estimateQuery.data.currency ?? settings.currency,
                })
                : t("create.estimatedUnavailable")}
            </p>
            {hint ? <p className="text-xs text-gray-500 m-0">{hint}</p> : null}
          </div>
          <button
            type="submit"
            className="px-8 py-2.5 bg-coral hover:bg-coral-dark text-white font-semibold text-sm rounded-xl transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={submitMutation.isPending}
          >
            {submitMutation.isPending
              ? t("create.submitting")
              : selectedProvider.type === "tuzi_image"
                ? t("create.generateImage")
                : t("create.generateVideo")}
          </button>
        </div>

        {/* ── Submission Feedback ──────────────────── */}
        {lastSubmittedTaskId ? (
          <div className="bg-surface rounded-2xl p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700 m-0">
                {t("create.feedbackTitle", { taskId: lastSubmittedTaskId.slice(0, 8) })}
              </p>
              <button
                type="button"
                className="text-xs text-gray-400 hover:text-gray-600"
                onClick={() => setLastSubmittedTaskId(null)}
              >
                {t("create.feedbackContinue")}
              </button>
            </div>
            <p className={`text-sm font-medium m-0 ${statusTone(trackedTask) === "ok" ? "text-green-600" :
              statusTone(trackedTask) === "danger" ? "text-red-500" :
                statusTone(trackedTask) === "warn" ? "text-amber-500" :
                  "text-gray-400"
              }`}>
              {trackedTask ? statusLabel(trackedTask) : t("create.feedbackSubmitted")}
            </p>
            {trackedTask?.status === "failed" && trackedTask.error ? (
              <p className="text-xs text-red-400 m-0">{errorMessage(trackedTask)}</p>
            ) : null}
            {trackedOtherInProgressCount > 0 ? (
              <button
                type="button"
                className="text-xs text-blue-600 hover:underline self-start"
                onClick={() => navigate("/assets")}
              >
                {t("create.feedbackOtherInProgress", { count: trackedOtherInProgressCount })}
              </button>
            ) : null}
            <button
              type="button"
              className="px-6 py-2 bg-coral hover:bg-coral-dark text-white font-semibold text-sm rounded-xl transition-all self-start"
              onClick={() => navigate("/assets")}
            >
              {trackedTask?.status === "succeeded"
                ? t("create.feedbackViewResult")
                : t("create.feedbackViewAssets")}
            </button>
          </div>
        ) : null}

        {/* ── Divider ──────────────────────────────── */}
        <div className="h-px bg-border-light w-full" />

        {/* ── Prompt Presets & History ──────────────── */}
        {promptField ? (
          <div className="flex flex-col gap-3">
            <details className="group">
              <summary className="text-sm font-medium text-gray-600 dark:text-gray-400 cursor-pointer hover:text-gray-800 dark:hover:text-gray-200 transition-colors">
                {t("create.promptPresets")}
              </summary>
              <div className="mt-2 flex flex-wrap gap-2">
                {promptPresets.map((preset) => (
                  <div key={preset} className="flex items-center gap-1">
                    <button
                      type="button"
                      className="px-3 py-1 text-xs bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg transition-colors max-w-xs truncate"
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
                        className="text-xs text-gray-300 hover:text-red-400 transition-colors"
                        onClick={() => {
                          removePromptPreset(preset);
                          setPresetVersion((current) => current + 1);
                        }}
                      >
                        ✕
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </details>

            {settings.savePromptHistory ? (
              <details className="group">
                <summary className="text-sm font-medium text-gray-600 dark:text-gray-400 cursor-pointer hover:text-gray-800 dark:hover:text-gray-200 transition-colors flex items-center justify-between">
                  {t("create.recentPrompts")}
                </summary>
                <div className="mt-1 flex items-center justify-end">
                  <button
                    type="button"
                    className="text-xs text-gray-400 hover:text-red-400 transition-colors"
                    onClick={() => {
                      clearRecentPrompts();
                      setRecentPromptVersion((current) => current + 1);
                    }}
                  >
                    {t("common.clear")}
                  </button>
                </div>
                {recentPrompts.length ? (
                  <div className="mt-2 flex flex-col gap-1.5">
                    {recentPrompts.map((entry) => (
                      <div
                        key={`${entry.usedAt}_${entry.text}`}
                        className="flex items-center gap-2 group/item"
                      >
                        <button
                          type="button"
                          className="flex-1 text-left text-xs text-gray-600 hover:text-gray-900 truncate transition-colors"
                          onClick={() => {
                            onFieldChanged(promptField, entry.text);
                            setHint(t("create.hintRecentPromptApplied"));
                          }}
                        >
                          {entry.text}
                        </button>
                        <button
                          type="button"
                          className={`text-xs shrink-0 transition-colors ${entry.pinned ? "text-amber-500" : "text-gray-300 hover:text-amber-400"
                            }`}
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
                          {entry.pinned ? "★" : "☆"}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 mt-2">{t("create.noRecentPrompts")}</p>
                )}
              </details>
            ) : null}
          </div>
        ) : null}
      </form>
    </div>
  );
}

function DynamicInput(props: {
  field: ProviderOperationField;
  value: string;
  onValueChange: (value: string) => void;
  onFileChange: (files: File[]) => void;
  selectedFiles?: File[];
  reusedFileIds?: string[];
  onReusedFileIdsChange?: (fileIds: string[]) => void;
  placeholder?: string;
}) {
  const { t } = useI18n();
  const gatewayToken = useAppSettingsStore((state) => state.gatewayToken);
  const {
    field,
    value,
    onValueChange,
    onFileChange,
    selectedFiles = [],
    reusedFileIds = [],
    onReusedFileIdsChange,
    placeholder,
  } = props;
  const resolvedPlaceholder = placeholder ?? field.placeholder ?? "";
  const durationOptions = isDurationField(field) ? durationOptionsFromField(field) : [];
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [reusedPreviews, setReusedPreviews] = useState<Array<{
    fileId: string;
    url: string;
    name: string;
  }>>([]);

  const filePreviews = useMemo(
    () =>
      selectedFiles.map((file) => ({
        file,
        url: URL.createObjectURL(file),
      })),
    [selectedFiles],
  );

  useEffect(() => {
    return () => {
      for (const preview of filePreviews) {
        URL.revokeObjectURL(preview.url);
      }
    };
  }, [filePreviews]);

  useEffect(() => {
    let active = true;
    const urlsToRevoke: string[] = [];

    const run = async () => {
      if ((field.input_type !== "file" && field.input_type !== "file_list") || !reusedFileIds.length) {
        setReusedPreviews([]);
        return;
      }
      const loaded = await Promise.all(
        reusedFileIds.map(async (fileId, index) => {
          try {
            const { blob, fileName } = await fetchUploadedFileBinary(fileId, gatewayToken);
            if (!active) {
              return null;
            }
            const url = URL.createObjectURL(blob);
            urlsToRevoke.push(url);
            return {
              fileId,
              url,
              name: fileName?.trim() || `reference_${index + 1}`,
            };
          } catch {
            return null;
          }
        }),
      );
      if (!active) {
        return;
      }
      setReusedPreviews(loaded.filter((item): item is NonNullable<typeof item> => item != null));
    };

    void run();
    return () => {
      active = false;
      for (const url of urlsToRevoke) {
        URL.revokeObjectURL(url);
      }
    };
  }, [field.input_type, gatewayToken, reusedFileIds]);

  const activePreviewItems = useMemo(() => {
    const reusedItems = reusedPreviews.map((item) => ({
      key: `reused_${item.fileId}`,
      url: item.url,
      name: item.name,
    }));
    const localItems = filePreviews.map((item, index) => ({
      key: `local_${item.file.name}_${item.file.size}_${index}`,
      url: item.url,
      name: item.file.name,
    }));
    return [...reusedItems, ...localItems];
  }, [filePreviews, reusedPreviews]);
  const reusedPreviewMap = useMemo(
    () => new Map(reusedPreviews.map((item) => [item.fileId, item])),
    [reusedPreviews],
  );
  const previewIndexByKey = useMemo(
    () => new Map(activePreviewItems.map((item, index) => [item.key, index])),
    [activePreviewItems],
  );

  useEffect(() => {
    if (previewIndex == null) {
      return;
    }
    if (previewIndex >= activePreviewItems.length) {
      setPreviewIndex(activePreviewItems.length ? activePreviewItems.length - 1 : null);
    }
  }, [activePreviewItems.length, previewIndex]);

  if (durationOptions.length) {
    return (
      <select
        value={value}
        required={field.required}
        onChange={(event) => onValueChange(event.target.value)}
        className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-1 focus:ring-gray-300 dark:focus:ring-gray-600 bg-white dark:bg-gray-900 dark:text-gray-200 transition-colors w-full"
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
        className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-1 focus:ring-gray-300 dark:focus:ring-gray-600 bg-white dark:bg-gray-900 dark:text-gray-200 transition-colors w-full resize-y"
      />
    );
  }
  if (field.input_type === "select") {
    return (
      <select
        value={value}
        required={field.required}
        onChange={(event) => onValueChange(event.target.value)}
        className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-1 focus:ring-gray-300 dark:focus:ring-gray-600 bg-white dark:bg-gray-900 dark:text-gray-200 transition-colors w-full"
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
    const isMulti = field.input_type === "file_list";
    const hasLocalFiles = selectedFiles.length > 0;
    const hasReusedFiles = reusedFileIds.length > 0;
    const hasFiles = hasLocalFiles || hasReusedFiles;
    const triggerPick = () => fileInputRef.current?.click();
    const isImageFile = (item: File): boolean => {
      const type = item.type.toLowerCase();
      if (type.startsWith("image/")) {
        return true;
      }
      return /\.(jpg|jpeg|png|webp)$/i.test(item.name);
    };
    const mergeFiles = (picked: File[]) => {
      if (!picked.length) {
        return;
      }
      const nextFiles = isMulti ? [...selectedFiles, ...picked] : [picked[0]];
      onFileChange(nextFiles);
    };
    const removeAt = (index: number) => {
      onFileChange(selectedFiles.filter((_, currentIndex) => currentIndex !== index));
    };
    const clearAll = () => {
      onFileChange([]);
      onReusedFileIdsChange?.([]);
    };
    const removeReusedFile = (fileId: string) => {
      if (!onReusedFileIdsChange) {
        return;
      }
      const removeIndex = reusedFileIds.indexOf(fileId);
      if (removeIndex < 0) {
        return;
      }
      const next = reusedFileIds.filter((_, index) => index !== removeIndex);
      onReusedFileIdsChange(next);
    };
    const handleFilePicked = (event: ChangeEvent<HTMLInputElement>) => {
      const picked = Array.from(event.target.files ?? []).filter((item) => isImageFile(item));
      mergeFiles(picked);
      event.currentTarget.value = "";
    };
    const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (!isDragOver) {
        setIsDragOver(true);
      }
    };
    const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      const nextTarget = event.relatedTarget as Node | null;
      if (!nextTarget || !event.currentTarget.contains(nextTarget)) {
        setIsDragOver(false);
      }
    };
    const handleDrop = (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragOver(false);
      const dropped = Array.from(event.dataTransfer.files ?? []).filter((item) => isImageFile(item));
      mergeFiles(dropped);
    };

    return (
      <div
        className={`border-2 border-dashed rounded-xl p-4 transition-colors ${isDragOver ? "border-coral bg-coral/5" : "border-gray-200 dark:border-white/10 bg-surface"
          }`}
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          className="hidden"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple={isMulti}
          onChange={handleFilePicked}
        />
        <div className="flex items-center gap-2 mb-2">
          <button
            type="button"
            className="px-3 py-1 text-xs font-medium rounded-lg bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600/80 transition-colors dark:text-gray-200"
            onClick={triggerPick}
          >
            {!hasFiles
              ? t("create.fileUploadImage")
              : isMulti
                ? t("create.fileAddImage")
                : t("create.fileReplaceImage")}
          </button>
          {hasFiles ? (
            <button
              type="button"
              className="px-3 py-1 text-xs font-medium rounded-lg bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600/80 transition-colors dark:text-gray-200"
              onClick={clearAll}
            >
              {t("create.fileClearAll")}
            </button>
          ) : null}
          <span className="text-xs text-gray-400">
            {hasReusedFiles && !hasLocalFiles
              ? t("create.fileReusedCount", { count: reusedFileIds.length })
              : isMulti
                ? t("create.fileSelectedCount", { count: selectedFiles.length + reusedFileIds.length })
                : t("create.fileOnlyImages")}
          </span>
        </div>

        {hasFiles ? (
          <div className="grid grid-cols-4 gap-2">
            {reusedFileIds.map((fileId, index) => {
              const item = reusedPreviewMap.get(fileId);
              const previewIndexForItem = previewIndexByKey.get(`reused_${fileId}`) ?? -1;
              return (
                <article key={`${fileId}_${index}`} className="rounded-lg overflow-hidden bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700">
                  {item ? (
                    <button
                      type="button"
                      className="w-full bg-transparent border-none p-0 cursor-pointer"
                      onClick={() => {
                        if (previewIndexForItem >= 0) {
                          setPreviewIndex(previewIndexForItem);
                        }
                      }}
                    >
                      <img className="w-full aspect-square object-cover block" src={item.url} alt={item.name} />
                    </button>
                  ) : (
                    <div className="aspect-square flex items-center justify-center text-xs text-gray-400">{t("create.fileReusedCount", { count: 1 })}</div>
                  )}
                  <div className="flex items-center justify-between px-1.5 py-1 gap-1">
                    <p className="text-[10px] text-gray-500 truncate m-0 flex-1" title={item?.name ?? fileId}>{item?.name ?? fileId}</p>
                    <button
                      type="button"
                      className="text-[10px] text-red-400 hover:text-red-600 transition-colors bg-transparent border-none cursor-pointer shrink-0"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        removeReusedFile(fileId);
                      }}
                      aria-label={t("create.fileRemove")}
                    >
                      {t("create.fileRemove")}
                    </button>
                  </div>
                </article>
              );
            })}
            {filePreviews.map((item, index) => (
              <article key={`${item.file.name}_${item.file.size}_${index}`} className="rounded-lg overflow-hidden bg-white dark:bg-white/5 border border-gray-100 dark:border-white/10">
                <button
                  type="button"
                  className="w-full bg-transparent border-none p-0 cursor-pointer"
                  onClick={() => {
                    const previewIndexForItem =
                      previewIndexByKey.get(`local_${item.file.name}_${item.file.size}_${index}`) ?? -1;
                    if (previewIndexForItem >= 0) {
                      setPreviewIndex(previewIndexForItem);
                    }
                  }}
                >
                  <img className="w-full aspect-square object-cover block" src={item.url} alt={item.file.name} />
                </button>
                <div className="flex items-center justify-between px-1.5 py-1 gap-1">
                  <p className="text-[10px] text-gray-500 truncate m-0 flex-1" title={item.file.name}>{item.file.name}</p>
                  <button
                    type="button"
                    className="text-[10px] text-red-400 hover:text-red-600 transition-colors bg-transparent border-none cursor-pointer shrink-0"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      removeAt(index);
                    }}
                    aria-label={t("create.fileRemove")}
                  >
                    {t("create.fileRemove")}
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <button type="button" className="w-full py-8 text-xs text-gray-400 bg-transparent border-none cursor-pointer hover:text-gray-600 transition-colors" onClick={triggerPick}>
            {t("create.fileOnlyImages")}
          </button>
        )}

        {previewIndex != null && activePreviewItems[previewIndex] ? (
          <div
            className="fixed inset-0 z-50 bg-dark-overlay flex items-center justify-center"
            role="dialog"
            aria-modal="true"
            onClick={() => setPreviewIndex(null)}
          >
            <div
              className="relative flex flex-col items-center gap-4 max-w-[90vw] max-h-[90vh]"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center gap-4">
                <p className="text-white/60 text-xs m-0">
                  {t("jobs.lightboxIndex", { index: previewIndex + 1, total: activePreviewItems.length })}
                </p>
                <button
                  type="button"
                  className="text-white/60 hover:text-white text-sm transition-colors bg-transparent border-none cursor-pointer"
                  onClick={() => setPreviewIndex(null)}
                >
                  {t("common.close")} ✕
                </button>
              </div>
              <div className="relative flex items-center gap-4">
                {activePreviewItems.length > 1 ? (
                  <button
                    type="button"
                    className="w-10 h-10 rounded-full bg-dark-button hover:bg-white/20 text-white flex items-center justify-center transition-colors text-lg shrink-0 border-none cursor-pointer"
                    onClick={() =>
                      setPreviewIndex((current) =>
                        current == null
                          ? 0
                          : current > 0
                            ? current - 1
                            : activePreviewItems.length - 1,
                      )
                    }
                  >
                    ‹
                  </button>
                ) : null}
                <img
                  className="max-w-[80vw] max-h-[75vh] rounded-xl object-contain"
                  src={activePreviewItems[previewIndex].url}
                  alt={activePreviewItems[previewIndex].name}
                />
                {activePreviewItems.length > 1 ? (
                  <button
                    type="button"
                    className="w-10 h-10 rounded-full bg-dark-button hover:bg-white/20 text-white flex items-center justify-center transition-colors text-lg shrink-0 border-none cursor-pointer"
                    onClick={() =>
                      setPreviewIndex((current) =>
                        current == null
                          ? 0
                          : current < activePreviewItems.length - 1
                            ? current + 1
                            : 0,
                      )
                    }
                  >
                    ›
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
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
        className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-1 focus:ring-gray-300 dark:focus:ring-gray-600 bg-white dark:bg-gray-900 dark:text-gray-200 transition-colors w-full"
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
      className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-1 focus:ring-gray-300 dark:focus:ring-gray-600 bg-white dark:bg-gray-900 dark:text-gray-200 transition-colors w-full"
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

function readLastSubmittedTaskId(): string | null {
  try {
    const raw = localStorage.getItem(LAST_SUBMITTED_TASK_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as { taskId?: unknown; savedAt?: unknown };
    const taskId = typeof parsed.taskId === "string" ? parsed.taskId.trim() : "";
    const savedAt = typeof parsed.savedAt === "string" ? parsed.savedAt : "";
    if (!taskId || !savedAt) {
      localStorage.removeItem(LAST_SUBMITTED_TASK_KEY);
      return null;
    }
    const savedTime = Date.parse(savedAt);
    if (!Number.isFinite(savedTime) || Date.now() - savedTime > LAST_SUBMITTED_TASK_MAX_AGE_MS) {
      localStorage.removeItem(LAST_SUBMITTED_TASK_KEY);
      return null;
    }
    return taskId;
  } catch {
    return null;
  }
}

function persistLastSubmittedTaskId(taskId: string | null): void {
  try {
    if (!taskId) {
      localStorage.removeItem(LAST_SUBMITTED_TASK_KEY);
      return;
    }
    localStorage.setItem(
      LAST_SUBMITTED_TASK_KEY,
      JSON.stringify({ taskId, savedAt: new Date().toISOString() }),
    );
  } catch {
    // ignore storage failures
  }
}

interface ResolutionChoice {
  value: string;
  ratio: string;
  size: string;
}

type OrientationMode = "landscape" | "portrait";

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

function pickResolutionValueByOrientation(
  field: ProviderOperationField,
  currentValue: string,
  orientation: OrientationMode,
): string | null {
  const choices = buildResolutionChoices(field, currentValue);
  if (!choices.length) {
    return null;
  }
  const current = parseResolutionMeta(currentValue);
  const orientedChoices = choices.filter((item) => inferResolutionOrientation(item.value) === orientation);
  if (!orientedChoices.length) {
    return null;
  }
  const sizeMatched = orientedChoices.find((item) => !current.size || item.size === current.size);
  if (sizeMatched) {
    return sizeMatched.value;
  }
  return orientedChoices[0].value;
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

function inferResolutionOrientation(raw: string): OrientationMode | null {
  const normalized = raw.trim().toLowerCase();
  const match = normalized.match(/^(\d+)\s*[:x]\s*(\d+)$/);
  if (!match) {
    return null;
  }
  const left = Number(match[1]);
  const right = Number(match[2]);
  if (!(Number.isFinite(left) && Number.isFinite(right) && left > 0 && right > 0)) {
    return null;
  }
  if (left === right) {
    return null;
  }
  return left > right ? "landscape" : "portrait";
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
  files: Record<string, File[]>,
  reusedFileIds: Record<string, string[]>,
  onFieldChanged: (field: ProviderOperationField, nextValue: string) => void,
  onFileChanged: (field: ProviderOperationField, nextFiles: File[]) => void,
  onReusedFileIdsChanged: (field: ProviderOperationField, nextFileIds: string[]) => void,
  variant: "default" | "compact" = "default",
) {
  const key = fieldKey(field);
  const value = values[key] ?? "";
  const selectedFiles = files[key] ?? [];
  const reusedIds = reusedFileIds[key] ?? [];
  const className =
    variant === "compact"
      ? "flex flex-col gap-1"
      : isPromptLike(field)
        ? "flex flex-col gap-1 col-span-full"
        : "flex flex-col gap-1";
  const Wrapper = field.input_type === "file" || field.input_type === "file_list" ? "div" : "label";
  return (
    <Wrapper key={key} className={className}>
      <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{field.label}</span>
      <DynamicInput
        field={field}
        value={value}
        selectedFiles={selectedFiles}
        reusedFileIds={reusedIds}
        onReusedFileIdsChange={(nextFileIds) => onReusedFileIdsChanged(field, nextFileIds)}
        onValueChange={(next) => onFieldChanged(field, next)}
        onFileChange={(nextFiles) => onFileChanged(field, nextFiles)}
      />
      {field.help_text ? <small className="text-xs text-gray-400">{field.help_text}</small> : null}
    </Wrapper>
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
): { reusedFileIds: Record<string, string[]>; reusedFileCount: number } {
  const reusedFileIds: Record<string, string[]> = {};
  for (const field of operation.fields) {
    const key = fieldKey(field);
    if (field.input_type === "file" || field.input_type === "file_list") {
      if (field.target === "provider_options") {
        const normalized = normalizeDraftFileIds(
          draft.providerOptions[field.key],
          field.input_type === "file",
        );
        if (normalized.length) {
          reusedFileIds[key] = normalized;
        }
      }
      continue;
    }
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
  return {
    reusedFileIds,
    reusedFileCount: Object.values(reusedFileIds).reduce((sum, ids) => sum + ids.length, 0),
  };
}

function normalizeDraftFileIds(raw: unknown, single: boolean): string[] {
  const parsed = normalizeUnknownToStringList(raw);
  if (!parsed.length) {
    return [];
  }
  if (single) {
    return [parsed[0]];
  }
  return parsed;
}

function normalizeUnknownToStringList(raw: unknown): string[] {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) {
      return [];
    }
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed
            .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
            .map((item) => item.trim());
        }
      } catch {
        return [];
      }
    }
    return [trimmed];
  }
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
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
