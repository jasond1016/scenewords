import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  ArrowsClockwise,
  CloudArrowUp,
  ImageSquare,
  PaperPlaneTilt,
  VideoCamera,
} from "@phosphor-icons/react";
import {
  createVideoTask,
  fetchUploadedFileBinary,
  uploadFile,
} from "../api";
import { useI18n } from "../i18n";
import {
  useAppSettingsStore,
  type AppSettingsState,
  type ProviderGenerationDefaults,
} from "../state";
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
  extractImageUrls,
  extractVideoUrl,
  fieldKey,
  fieldStorageKey,
  findField,
  formatTime,
  isDurationField,
  isFieldEmpty,
  parseFieldValue,
  restoreSession,
  saveSession,
  valueToStoredString,
} from "../utils";
import { WorkDetailOverlay } from "../components/WorkDetailOverlay";

interface Props {
  catalog?: ProviderCatalogResponse;
  loading: boolean;
  tasks: VideoTaskDetail[];
}

const RECENT_PROMPTS_KEY = "scenewords_recent_prompts_v1";
const MAX_RECENT_PROMPTS = 20;
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
  const { locale, t } = useI18n();
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
  const [lastSubmittedTaskId, setLastSubmittedTaskId] = useState<string | null>(() =>
    readLastSubmittedTaskId(),
  );
  const [selectedRecentTaskId, setSelectedRecentTaskId] = useState<string | null>(null);
  const [recentOverlayTaskId, setRecentOverlayTaskId] = useState<string | null>(null);
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
  const inProgressCount = useMemo(
    () => tasks.filter((task) => task.status === "queued" || task.status === "running").length,
    [tasks],
  );
  const recentTasks = useMemo(
    () =>
      [...tasks]
        .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
        .slice(0, 8),
    [tasks],
  );
  const recentTaskPreviewMap = useMemo(() => {
    const map = new Map<string, { kind: "image" | "video"; url: string }>();
    for (const task of recentTasks) {
      if (task.asset_type === "video") {
        const videoUrl = extractVideoUrl(task);
        if (videoUrl) {
          map.set(task.task_id, { kind: "video", url: videoUrl });
        }
        continue;
      }
      const imageUrl = extractImageUrls(task)[0] ?? "";
      if (imageUrl) {
        map.set(task.task_id, { kind: "image", url: imageUrl });
      }
    }
    return map;
  }, [recentTasks]);
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
  const promptPlaceholder = useMemo(() => {
    if (!promptField) {
      return "";
    }
    if (promptField.placeholder?.trim()) {
      return promptField.placeholder;
    }
    return t("create.promptPlaceholder");
  }, [promptField, t]);
  const promptValue = promptField ? values[fieldKey(promptField)] ?? "" : "";

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
    if (!recentTasks.length) {
      setSelectedRecentTaskId(null);
      return;
    }
    if (!selectedRecentTaskId || !recentTasks.some((task) => task.task_id === selectedRecentTaskId)) {
      setSelectedRecentTaskId(recentTasks[0].task_id);
    }
  }, [recentTasks, selectedRecentTaskId]);

  useEffect(() => {
    if (!recentOverlayTaskId) {
      return;
    }
    if (!tasks.some((task) => task.task_id === recentOverlayTaskId)) {
      setRecentOverlayTaskId(null);
    }
  }, [recentOverlayTaskId, tasks]);

  useEffect(() => {
    if (!providers.length || providerId) {
      return;
    }
    const preferredProviderId =
      currentGenerationKind === "image"
        ? settings.defaultImageProvider
        : settings.defaultVideoProvider;
    const defaultProvider =
      pickProviderByKind(providers, currentGenerationKind, preferredProviderId) ??
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
  }, [
    currentGenerationKind,
    providerId,
    providers,
    settings.defaultImageProvider,
    settings.defaultVideoProvider,
  ]);

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
    applySettingDefaults(hydrated, selectedOperation, settings, providerId);

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
    settings.defaultQuality,
    settings.defaultRatio,
    settings.defaultNegativePrompt,
    settings.historyRetentionDays,
    settings.pendingReuseDraft,
    settings.providerDefaults,
    settings.restoreLastSession,
    settings.setPendingReuseDraft,
  ]);

  useEffect(() => {
    if (!settings.savePromptHistory) {
      localStorage.removeItem(RECENT_PROMPTS_KEY);
      return;
    }
    pruneRecentPrompts(settings.historyRetentionDays);
  }, [settings.historyRetentionDays, settings.savePromptHistory]);

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
      const nextProviderDefaults = captureProviderDefaultsFromValues(
        settings,
        providerId,
        selectedOperation,
        values,
      );
      const nextSettings: Partial<AppSettingsState> = {
        providerDefaults: {
          ...settings.providerDefaults,
          [providerId]: nextProviderDefaults,
        },
      };
      if (selectedProvider && isImageProviderType(selectedProvider.type)) {
        nextSettings.defaultImageProvider = providerId;
      } else {
        nextSettings.defaultVideoProvider = providerId;
      }
      settings.setSettings(nextSettings);
      if (settings.savePromptHistory && promptField) {
        const promptValue = (values[fieldKey(promptField)] ?? "").trim();
        if (promptValue) {
          appendRecentPrompt({
            text: promptValue,
            provider: providerId,
            model: modelName,
            operation: selectedOperation?.id ?? operationId,
          }, {
            retentionDays: settings.historyRetentionDays,
          });
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
    const preferredProviderId =
      nextKind === "image" ? settings.defaultImageProvider : settings.defaultVideoProvider;
    const nextProvider = pickProviderByKind(providers, nextKind, preferredProviderId);
    if (!nextProvider) {
      return;
    }
    setProviderId(nextProvider.id);
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
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-32">
        <div className="skeleton h-8 w-48" />
        <div className="skeleton h-4 w-64" />
        <p className="text-sm text-[var(--c-text-tertiary)]">{t("create.loadingCatalog")}</p>
      </div>
    );
  }
  if (!selectedProvider || !selectedModel || !selectedOperation) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-32">
        <p className="text-sm text-[var(--c-text-secondary)]">{t("create.noAvailable")}</p>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-8">
      <form
        className="w-full flex flex-col gap-8"
        onSubmit={(event) => {
          event.preventDefault();
          void submitMutation.mutateAsync();
        }}
      >
        {/* ── Page Header ────────────────────────────── */}
        <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-display m-0">{t("nav.create")}</h1>
            <p className="m-0 mt-2 max-w-lg text-sm text-[var(--c-text-secondary)]">
              {locale === "zh-CN"
                ? "选择模型，输入提示词，生成图片或视频。"
                : "Choose a model, write your prompt, generate images or video."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canSwitchGenerationKind ? (
              <div className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5">
                <button
                  type="button"
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-150 ${
                    currentGenerationKind === "image"
                      ? "bg-cta text-cta-text"
                      : "text-[var(--c-text-secondary)] hover:text-[var(--c-text)]"
                  }`}
                  onClick={() => onGenerationKindChanged("image")}
                >
                  <ImageSquare size={14} weight={currentGenerationKind === "image" ? "fill" : "regular"} />
                  {t("create.quickImage")}
                </button>
                <button
                  type="button"
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-150 ${
                    currentGenerationKind === "video"
                      ? "bg-cta text-cta-text"
                      : "text-[var(--c-text-secondary)] hover:text-[var(--c-text)]"
                  }`}
                  onClick={() => onGenerationKindChanged("video")}
                >
                  <VideoCamera size={14} weight={currentGenerationKind === "video" ? "fill" : "regular"} />
                  {t("create.quickVideo")}
                </button>
              </div>
            ) : null}
            {inProgressCount > 0 ? (
              <span className="tag tag-warning">{t("app.topbar.queue", { count: inProgressCount })}</span>
            ) : null}
          </div>
        </section>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_300px] xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex flex-col gap-6">
            {/* ── Prompt & Controls ──────────────────── */}
            <section className="card space-y-5">
              {/* Provider / Model / Operation row */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-[var(--c-text-secondary)]">{t("create.provider")}</span>
                  <select
                    className="input-base"
                    value={providerId}
                    onChange={(event) => setProviderId(event.target.value)}
                  >
                    {providerChoices.map((provider) => (
                      <option key={provider.id} value={provider.id}>{provider.display_name}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-[var(--c-text-secondary)]">{t("create.model")}</span>
                  <select
                    className="input-base"
                    value={modelName}
                    onChange={(event) => setModelName(event.target.value)}
                  >
                    {selectedProvider.models.map((model) => (
                      <option key={model.name} value={model.name}>{model.display_name}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-[var(--c-text-secondary)]">{t("create.quickMode")}</span>
                  <select
                    className="input-base"
                    value={selectedOperation.id}
                    onChange={(event) => setOperationId(event.target.value)}
                  >
                    {selectedModel.operations.map((operation) => (
                      <option key={operation.id} value={operation.id}>{operation.display_name}</option>
                    ))}
                  </select>
                </label>
              </div>

              <hr className="divider" />

              {/* Prompt area */}
              {promptField ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-[var(--c-text-secondary)]">Prompt</label>
                    <div className="flex items-center gap-2">
                      {promptField ? (
                        <button
                          type="button"
                          className="btn-ghost text-xs"
                          onClick={() => onFieldChanged(promptField, "")}
                        >
                          {t("create.clearPrompt")}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <DynamicInput
                    field={promptField}
                    value={promptValue}
                    onValueChange={(next) => onFieldChanged(promptField, next)}
                    onFileChange={() => undefined}
                    placeholder={promptPlaceholder}
                  />
                  {promptField.help_text ? <small className="text-xs text-[var(--c-text-tertiary)]">{promptField.help_text}</small> : null}
                </div>
              ) : (
                <p className="text-sm text-[var(--c-text-tertiary)]">{t("create.promptNotSupported")}</p>
              )}

              {quickMediaFields.length ? (
                <div className="space-y-3 rounded-xl border border-border bg-surface-raised p-4">
                  <div className="flex items-center justify-between">
                    <p className="m-0 text-xs font-medium text-[var(--c-text)]">
                      {locale === "zh-CN" ? "素材输入" : "Reference Assets"}
                    </p>
                    <p className="m-0 text-[11px] text-[var(--c-text-tertiary)]">
                      {locale === "zh-CN" ? "支持复用与上传" : "Upload or reuse"}
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
                </div>
              ) : null}

              <div className="space-y-3">
                <p className="m-0 text-xs font-medium text-[var(--c-text)]">
                  {locale === "zh-CN" ? "快捷参数" : "Quick Params"}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {resolutionField
                    ? (ratioChoices.length ? ratioChoices : [resolutionValue]).filter(Boolean).map((ratio) => (
                      <button
                        type="button"
                        key={`ratio_${ratio}`}
                        className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-150 ${
                          currentRatioDisplay === ratio
                            ? "bg-cta text-cta-text"
                            : "border border-border bg-surface text-[var(--c-text-secondary)] hover:border-[#C4C4C4] hover:text-[var(--c-text)]"
                        }`}
                        onClick={() => onRatioChanged(ratio)}
                      >
                        {ratio}
                      </button>
                    ))
                    : null}
                  {hasQuickSize
                    ? (qualityField ? qualityChoices : sizeChoices).map((size) => {
                      const active = qualityField ? qualityValue === size : currentSizeDisplay === size;
                      const label = qualityField
                        ? qualityField.options.find((option) => option.value === size)?.label ?? size
                        : size;
                      return (
                        <button
                          type="button"
                          key={`size_${size}`}
                          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-150 ${
                            active
                              ? "bg-cta text-cta-text"
                              : "border border-border bg-surface text-[var(--c-text-secondary)] hover:border-[#C4C4C4] hover:text-[var(--c-text)]"
                          }`}
                          onClick={() => onSizeChanged(size)}
                        >
                          {label}
                        </button>
                      );
                    })
                    : null}
                  {orientationField
                    ? orientationChoices.map((option) => (
                      <button
                        type="button"
                        key={`orientation_${option.value}`}
                        className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-150 ${
                          orientationValue === option.value
                            ? "bg-cta text-cta-text"
                            : "border border-border bg-surface text-[var(--c-text-secondary)] hover:border-[#C4C4C4] hover:text-[var(--c-text)]"
                        }`}
                        onClick={() => onOrientationChanged(option.value)}
                      >
                        {option.label}
                      </button>
                    ))
                    : null}
                  {durationField && durationChoices.length
                    ? durationChoices.map((seconds) => (
                      <button
                        type="button"
                        key={`duration_${seconds}`}
                        className={`rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-150 ${
                          durationValue === String(seconds)
                            ? "bg-cta text-cta-text"
                            : "border border-border bg-surface text-[var(--c-text-secondary)] hover:border-[#C4C4C4] hover:text-[var(--c-text)]"
                        }`}
                        onClick={() => onFieldChanged(durationField, String(seconds))}
                      >
                        {seconds}s
                      </button>
                    ))
                    : null}
                </div>
                {durationField && !durationChoices.length ? (
                  <div className="max-w-xs">
                    <DynamicInput
                      field={durationField}
                      value={durationValue}
                      onValueChange={(next) => onFieldChanged(durationField, next)}
                      onFileChange={() => undefined}
                    />
                  </div>
                ) : null}
              </div>

              {hint ? <p className="m-0 text-xs text-[var(--c-text-secondary)]">{hint}</p> : null}

              {/* Submit */}
              <div className="flex items-center gap-3 border-t border-border pt-4">
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={submitMutation.isPending}
                >
                  <PaperPlaneTilt size={15} weight="fill" />
                  {submitMutation.isPending
                    ? t("create.submitting")
                    : selectedProvider.type === "tuzi_image"
                      ? t("create.generateImage")
                      : t("create.generateVideo")}
                </button>
              </div>
            </section>

            <details className="card group">
              <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-[var(--c-text)]">
                <span>{locale === "zh-CN" ? "高级选项" : "Advanced Options"}</span>
                <span className="text-xs text-[var(--c-text-tertiary)]">{t("create.advancedOptions", { count: advancedFields.length })}</span>
              </summary>
              <div className="mt-4 space-y-4">
                {showVeoPromptGuide ? (
                  <div className="rounded-lg border border-[var(--c-border)] bg-info-bg p-3 text-sm">
                    <h4 className="m-0 mb-1 font-medium text-info-text">{t("create.veoPromptGuideTitle")}</h4>
                    <p className="m-0 mb-2 text-xs text-info-text/80">{t("create.veoPromptGuideDesc")}</p>
                    <div className="flex flex-wrap gap-3">
                      <a href={VEO_PROMPT_GUIDE_LINK_DOCS} target="_blank" rel="noreferrer" className="text-xs text-info-text underline decoration-dotted underline-offset-2">{t("create.veoPromptGuideLinkDocs")}</a>
                      <a href={VEO_PROMPT_GUIDE_LINK_BLOG} target="_blank" rel="noreferrer" className="text-xs text-info-text underline decoration-dotted underline-offset-2">{t("create.veoPromptGuideLinkBlog")}</a>
                    </div>
                  </div>
                ) : null}
                {advancedGroups.map((group) => (
                  <section key={group.id} className="rounded-lg border border-border bg-surface p-4">
                    <p className="m-0 mb-3 text-xs font-medium text-[var(--c-text)]">{t(`create.advancedGroup.${group.id}`)} ({group.fields.length})</p>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      {group.fields.map((field) =>
                        renderField(
                          field,
                          values,
                          files,
                          reusedFileIds,
                          onFieldChanged,
                          onFileFieldChanged,
                          onReusedFileIdsChanged,
                        ),
                      )}
                    </div>
                  </section>
                ))}
              </div>
            </details>

            {lastSubmittedTaskId ? (
              <section className="card">
                <div className="flex items-center justify-between gap-3">
                  <p className="m-0 text-sm font-medium text-[var(--c-text)]">{t("create.feedbackTitle", { taskId: lastSubmittedTaskId.slice(0, 8) })}</p>
                  <button type="button" className="btn-ghost text-xs" onClick={() => setLastSubmittedTaskId(null)}>{t("create.feedbackContinue")}</button>
                </div>
                <p className={`m-0 mt-2 text-sm font-medium ${
                  statusTone(trackedTask) === "ok"
                    ? "text-success-text"
                    : statusTone(trackedTask) === "danger"
                      ? "text-error-text"
                      : statusTone(trackedTask) === "warn"
                        ? "text-warning-text"
                        : "text-[var(--c-text-secondary)]"
                }`}>
                  {trackedTask ? statusLabel(trackedTask) : t("create.feedbackSubmitted")}
                </p>
                {trackedTask?.status === "failed" && trackedTask.error ? (
                  <p className="m-0 mt-2 text-xs text-error-text">{errorMessage(trackedTask)}</p>
                ) : null}
              </section>
            ) : null}
          </div>

          <aside className="h-fit rounded-xl border border-border bg-surface p-5 lg:sticky lg:top-20">
            <div className="flex items-center justify-between">
              <h3 className="m-0 text-sm font-medium text-[var(--c-text)]">
                {locale === "zh-CN" ? "最近任务" : "Recent Tasks"}
              </h3>
              <button type="button" className="btn-ghost text-xs" onClick={() => navigate("/works")}>
                {locale === "zh-CN" ? "查看全部" : "View all"}
              </button>
            </div>
            <div className="mt-4 space-y-2">
              {recentTasks.length ? (
                recentTasks.map((task) => {
                  const isSelected = selectedRecentTaskId === task.task_id;
                  const preview = recentTaskPreviewMap.get(task.task_id) ?? null;
                  return (
                    <div key={task.task_id} className="space-y-2">
                      <button
                        type="button"
                        className={`w-full text-left rounded-lg border p-3 transition-all duration-150 ${
                          isSelected
                            ? "border-[var(--c-text)] bg-surface shadow-[0_2px_8px_rgba(0,0,0,0.04)]"
                            : "border-border bg-surface-raised hover:border-[#D4D4D4]"
                        }`}
                        onClick={() => setSelectedRecentTaskId(task.task_id)}
                      >
                        <p className="m-0 line-clamp-2 text-sm leading-relaxed text-[var(--c-text)]">{task.prompt?.trim() || "(No prompt)"}</p>
                        <p className="m-0 mt-1.5 text-[11px] text-[var(--c-text-tertiary)]">{task.provider} · {task.model}</p>
                        <p className={`m-0 mt-1 text-[11px] font-medium ${
                          statusTone(task) === "ok"
                            ? "text-success-text"
                            : statusTone(task) === "danger"
                              ? "text-error-text"
                              : statusTone(task) === "warn"
                                ? "text-warning-text"
                                : "text-[var(--c-text-tertiary)]"
                        }`}>
                          {statusLabel(task)}
                        </p>
                      </button>

                      {isSelected ? (
                        <div className="rounded-lg border border-border bg-surface p-3 space-y-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="m-0 text-xs font-medium text-[var(--c-text)]">
                              {locale === "zh-CN" ? "任务详情" : "Task Detail"}
                            </p>
                            <span className={`tag ${
                              statusTone(task) === "ok"
                                ? "tag-success"
                                : statusTone(task) === "danger"
                                  ? "tag-error"
                                  : statusTone(task) === "warn"
                                    ? "tag-warning"
                                    : "tag-neutral"
                            }`}>
                              {statusLabel(task)}
                            </span>
                          </div>
                          {preview ? (
                            <button
                              type="button"
                              className="block w-full overflow-hidden rounded-lg border border-border bg-canvas p-0 text-left transition-colors hover:border-[#D4D4D4]"
                              onClick={() => setRecentOverlayTaskId(task.task_id)}
                              title={locale === "zh-CN" ? "点击查看详情" : "Open detail"}
                            >
                              {preview.kind === "video" ? (
                                <video
                                  src={preview.url}
                                  className="block aspect-video w-full object-cover"
                                  muted
                                  loop
                                  autoPlay
                                  playsInline
                                />
                              ) : (
                                <img
                                  src={preview.url}
                                  alt={task.task_id}
                                  className="block w-full max-h-40 object-cover"
                                />
                              )}
                            </button>
                          ) : null}
                          <p className="m-0 text-xs leading-relaxed text-[var(--c-text-secondary)] line-clamp-3">
                            {task.prompt?.trim() || "(No prompt)"}
                          </p>
                          <p className="m-0 font-mono text-[11px] text-[var(--c-text-tertiary)]">
                            {formatTime(task.created_at, locale === "zh-CN" ? "zh-CN" : "en-US")}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {promptField ? (
                              <button
                                type="button"
                                className="btn-secondary text-xs"
                                onClick={() => {
                                  settings.setPendingReuseDraft(toDraft(task));
                                  setHint(
                                    locale === "zh-CN"
                                      ? "已复用任务参数与素材到主编辑区。"
                                      : "Task settings and references restored to editor.",
                                  );
                                }}
                              >
                                <ArrowsClockwise size={13} />
                                {locale === "zh-CN" ? "复用 Prompt" : "Reuse Prompt"}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              ) : (
                <p className="m-0 py-6 text-center text-xs text-[var(--c-text-tertiary)]">
                  {locale === "zh-CN" ? "暂无任务" : "No tasks yet"}
                </p>
              )}
            </div>
          </aside>
        </div>
      </form>
      {recentOverlayTaskId ? (
        <WorkDetailOverlay
          tasks={recentTasks}
          initialTaskId={recentOverlayTaskId}
          onClose={() => setRecentOverlayTaskId(null)}
          onHint={setHint}
        />
      ) : null}
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
        className="input-base"
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
        className="input-base resize-y"
      />
    );
  }
  if (field.input_type === "select") {
    return (
      <select
        value={value}
        required={field.required}
        onChange={(event) => onValueChange(event.target.value)}
        className="input-base"
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
        className={`rounded-xl border-2 border-dashed p-4 transition-colors ${isDragOver ? "border-accent bg-accent-bg" : "border-border bg-surface-raised"
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
            className="btn-secondary text-xs"
            onClick={triggerPick}
          >
            <CloudArrowUp size={14} />
            {!hasFiles
              ? t("create.fileUploadImage")
              : isMulti
                ? t("create.fileAddImage")
                : t("create.fileReplaceImage")}
          </button>
          {hasFiles ? (
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={clearAll}
            >
              {t("create.fileClearAll")}
            </button>
          ) : null}
          <span className="text-[11px] text-[var(--c-text-tertiary)]">
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
                <article key={`${fileId}_${index}`} className="overflow-hidden rounded-lg border border-border bg-surface">
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
                    <div className="aspect-square flex items-center justify-center text-xs text-[var(--c-text-tertiary)]">{t("create.fileReusedCount", { count: 1 })}</div>
                  )}
                  <div className="flex items-center justify-between px-1.5 py-1 gap-1">
                    <p className="m-0 flex-1 truncate text-[10px] text-[var(--c-text-tertiary)]" title={item?.name ?? fileId}>{item?.name ?? fileId}</p>
                    <button
                      type="button"
                      className="shrink-0 cursor-pointer border-none bg-transparent text-[10px] text-error-text transition-colors hover:text-[#7A1F1F]"
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
              <article key={`${item.file.name}_${item.file.size}_${index}`} className="overflow-hidden rounded-lg border border-border bg-surface">
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
                  <p className="m-0 flex-1 truncate text-[10px] text-[var(--c-text-tertiary)]" title={item.file.name}>{item.file.name}</p>
                  <button
                    type="button"
                    className="shrink-0 cursor-pointer border-none bg-transparent text-[10px] text-error-text transition-colors hover:text-[#7A1F1F]"
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
          <button type="button" className="w-full cursor-pointer border-none bg-transparent py-8 text-xs text-[var(--c-text-tertiary)] transition-colors hover:text-[var(--c-text-secondary)]" onClick={triggerPick}>
            {t("create.fileOnlyImages")}
          </button>
        )}

        {previewIndex != null && activePreviewItems[previewIndex] ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-overlay"
            role="dialog"
            aria-modal="true"
            onClick={() => setPreviewIndex(null)}
          >
            <div
              className="relative flex flex-col items-center gap-4 max-w-[90vw] max-h-[90vh]"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center gap-4">
                <p className="m-0 text-xs text-white/60">
                  {t("jobs.lightboxIndex", { index: previewIndex + 1, total: activePreviewItems.length })}
                </p>
                <button
                  type="button"
                  className="cursor-pointer border-none bg-transparent text-sm text-white/60 transition-colors hover:text-white"
                  onClick={() => setPreviewIndex(null)}
                >
                  {t("common.close")}
                </button>
              </div>
              <div className="relative flex items-center gap-4">
                {activePreviewItems.length > 1 ? (
                  <button
                    type="button"
                    className="w-10 h-10 rounded-full flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-white/10 text-lg text-white transition-colors hover:bg-white/20"
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
                    className="w-10 h-10 rounded-full flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-white/10 text-lg text-white transition-colors hover:bg-white/20"
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
        className="input-base font-mono"
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
      className="input-base"
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
    <span className="text-xs font-medium text-[var(--c-text-secondary)]">{field.label}</span>
      <DynamicInput
        field={field}
        value={value}
        selectedFiles={selectedFiles}
        reusedFileIds={reusedIds}
        onReusedFileIdsChange={(nextFileIds) => onReusedFileIdsChanged(field, nextFileIds)}
        onValueChange={(next) => onFieldChanged(field, next)}
        onFileChange={(nextFiles) => onFileChanged(field, nextFiles)}
      />
      {field.help_text ? <small className="text-xs text-[var(--c-text-tertiary)]">{field.help_text}</small> : null}
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
  providerId: string,
): void {
  const resolvedDefaults = resolveGenerationDefaults(settings, providerId);

  const durationField = findField(operation, "duration_sec");
  if (durationField) {
    const key = fieldKey(durationField);
    if (!values[key]) {
      values[key] = String(resolvedDefaults.defaultDurationSec);
    }
  }
  const negativeField = findField(operation, "negative_prompt");
  if (negativeField && resolvedDefaults.defaultNegativePrompt) {
    const key = fieldKey(negativeField);
    if (!values[key]) {
      values[key] = resolvedDefaults.defaultNegativePrompt;
    }
  }

  const qualityField =
    operation.fields.find(
      (field) =>
        field.key === "quality" &&
        (field.target === "provider_options" || field.target === "request"),
    ) ?? null;
  if (qualityField && resolvedDefaults.defaultQuality) {
    const key = fieldKey(qualityField);
    if (!values[key]) {
      values[key] = resolvedDefaults.defaultQuality;
    }
  }

  const resolutionField = findField(operation, "resolution");
  if (resolutionField) {
    const key = fieldKey(resolutionField);
    if (!values[key]) {
      const matched = pickResolutionValue(resolutionField, "", {
        ratio: resolvedDefaults.defaultRatio,
      });
      if (matched) {
        values[key] = matched;
      }
    }
  }

  const aspectRatioField =
    operation.fields.find(
      (field) =>
        field.key === "aspect_ratio" &&
        (field.target === "provider_options" || field.target === "request"),
    ) ?? null;
  if (aspectRatioField) {
    const key = fieldKey(aspectRatioField);
    if (!values[key]) {
      values[key] = resolvedDefaults.defaultRatio;
    }
  }
}

function captureProviderDefaultsFromValues(
  settings: AppSettingsState,
  providerId: string,
  operation: ProviderModelOperationInfo | null,
  values: Record<string, string>,
): ProviderGenerationDefaults {
  const fallback = resolveGenerationDefaults(settings, providerId);
  if (!operation) {
    return fallback;
  }

  let nextRatio = fallback.defaultRatio;
  let nextDurationSec = fallback.defaultDurationSec;
  let nextQuality = fallback.defaultQuality;
  let nextNegativePrompt = fallback.defaultNegativePrompt;

  const durationField = findField(operation, "duration_sec");
  if (durationField) {
    const parsed = Number((values[fieldKey(durationField)] ?? "").trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      nextDurationSec = parsed;
    }
  }

  const negativeField = findField(operation, "negative_prompt");
  if (negativeField) {
    nextNegativePrompt = values[fieldKey(negativeField)] ?? "";
  }

  const qualityField =
    operation.fields.find(
      (field) =>
        field.key === "quality" &&
        (field.target === "provider_options" || field.target === "request"),
    ) ?? null;
  if (qualityField) {
    const nextValue = (values[fieldKey(qualityField)] ?? "").trim();
    if (nextValue) {
      nextQuality = nextValue;
    }
  }

  const resolutionField = findField(operation, "resolution");
  if (resolutionField) {
    const fromResolution = normalizeDefaultRatio(values[fieldKey(resolutionField)] ?? "");
    if (fromResolution) {
      nextRatio = fromResolution;
    }
  }

  const aspectRatioField =
    operation.fields.find(
      (field) =>
        field.key === "aspect_ratio" &&
        (field.target === "provider_options" || field.target === "request"),
    ) ?? null;
  if (aspectRatioField) {
    const fromAspectRatio = normalizeDefaultRatio(values[fieldKey(aspectRatioField)] ?? "");
    if (fromAspectRatio) {
      nextRatio = fromAspectRatio;
    }
  }

  return {
    defaultRatio: nextRatio,
    defaultDurationSec: nextDurationSec,
    defaultQuality: nextQuality,
    defaultNegativePrompt: nextNegativePrompt,
  };
}

function resolveGenerationDefaults(
  settings: AppSettingsState,
  providerId: string,
): {
  defaultRatio: "16:9" | "9:16";
  defaultDurationSec: number;
  defaultQuality: string;
  defaultNegativePrompt: string;
} {
  const providerDefaults = providerId ? settings.providerDefaults[providerId] : undefined;
  return {
    defaultRatio: providerDefaults?.defaultRatio ?? settings.defaultRatio,
    defaultDurationSec: providerDefaults?.defaultDurationSec ?? settings.defaultDurationSec,
    defaultQuality: providerDefaults?.defaultQuality ?? settings.defaultQuality,
    defaultNegativePrompt:
      providerDefaults?.defaultNegativePrompt ?? settings.defaultNegativePrompt,
  };
}

function normalizeDefaultRatio(raw: string): "16:9" | "9:16" | null {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized.includes("portrait") || normalized.includes("vertical")) {
    return "9:16";
  }
  if (normalized.includes("landscape") || normalized.includes("horizontal")) {
    return "16:9";
  }
  const match = normalized.match(/(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)/);
  if (!match) {
    return null;
  }
  const left = Number(match[1]);
  const right = Number(match[2]);
  if (!Number.isFinite(left) || !Number.isFinite(right) || left <= 0 || right <= 0) {
    return null;
  }
  return left >= right ? "16:9" : "9:16";
}

function toDraft(task: VideoTaskDetail): NonNullable<AppSettingsState["pendingReuseDraft"]> {
  return {
    provider: task.provider,
    model: task.model,
    operation: task.operation ?? "generate",
    prompt: task.prompt,
    negativePrompt: task.negative_prompt ?? "",
    durationSec: task.duration_sec,
    resolution: task.resolution ?? "",
    fps: task.fps,
    seed: task.seed,
    providerOptions: task.provider_options ?? {},
  };
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
}, options?: {
  retentionDays?: number;
}): void {
  const retentionDays = normalizeRetentionDays(options?.retentionDays);
  const current = filterRecentPromptsByRetention(readRecentPrompts(), retentionDays);
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

function pruneRecentPrompts(retentionDays: number): void {
  const current = readRecentPrompts();
  const filtered = filterRecentPromptsByRetention(current, retentionDays);
  if (filtered.length === current.length) {
    return;
  }
  localStorage.setItem(RECENT_PROMPTS_KEY, JSON.stringify(filtered));
}

function filterRecentPromptsByRetention(
  entries: RecentPromptEntry[],
  retentionDays: number,
): RecentPromptEntry[] {
  const normalizedDays = normalizeRetentionDays(retentionDays);
  const oldestAllowed = Date.now() - normalizedDays * 24 * 60 * 60 * 1000;
  return entries.filter((entry) => {
    const timestamp = Date.parse(entry.usedAt);
    return Number.isFinite(timestamp) && timestamp >= oldestAllowed;
  });
}

function normalizeRetentionDays(input: number | undefined): number {
  if (!Number.isFinite(input) || input == null) {
    return 90;
  }
  return Math.max(1, Math.floor(input));
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
