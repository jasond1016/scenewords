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
  ArrowSquareOut,
  CaretLeft,
  CaretRight,
  CloudArrowUp,
  Faders,
  ImageSquare,
  PaperPlaneTilt,
  Plus,
  VideoCamera,
  X,
  CaretDown,
  GearSix,
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
  ProviderModelInfo,
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
  isDurationField,
  isFieldEmpty,
  parseFieldValue,
  restoreSession,
  saveSession,
  valueToStoredString,
} from "../utils";
import { WorkDetailOverlay } from "../components/WorkDetailOverlay";
import { SkeletonForm } from "../components/Skeletons";

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
const VIDEO_PROVIDER_PRIORITY = ["veo31", "local_comfy"];
const VIDEO_POSTER_CACHE = new Map<string, string | null>();
const SHARED_IMAGE_SOURCE_FIELD_KEY = "shared_image_source_file_ids";
const SHARED_IMAGE_MASK_FIELD_KEY = "shared_image_mask_file_id";

interface RecentPromptEntry {
  text: string;
  provider: string;
  model: string;
  operation: string;
  usedAt: string;
  pinned: boolean;
}

interface ImageModelVariant {
  familyId: string;
  familyLabel: string;
  provider: ProviderInfo;
  model: ProviderModelInfo;
  resolutionKey: "1k" | "2k" | "4k";
  resolutionLabel: "1K" | "2K" | "4K";
  asyncEnabled: boolean;
  generateOperation: ProviderModelOperationInfo | null;
  editOperation: ProviderModelOperationInfo | null;
}

interface ImageModelFamily {
  id: string;
  label: string;
  provider: ProviderInfo;
  variants: ImageModelVariant[];
}

interface AdvancedGroup {
  id: "prompt" | "inputs" | "behavior" | "runtime" | "developer" | "misc";
  fields: ProviderOperationField[];
}

function captureVideoPoster(src: string): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined" || typeof window === "undefined") {
      resolve(null);
      return;
    }

    const video = document.createElement("video");
    let settled = false;
    const timeoutId = window.setTimeout(() => finish(null), 5000);

    function finish(value: string | null) {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      video.pause();
      video.removeAttribute("src");
      video.load();
      resolve(value);
    }

    function drawFrame() {
      if (!video.videoWidth || !video.videoHeight) {
        finish(null);
        return;
      }
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext("2d");
        if (!context) {
          finish(null);
          return;
        }
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        finish(canvas.toDataURL("image/jpeg", 0.82));
      } catch {
        finish(null);
      }
    }

    video.preload = "metadata";
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";
    video.addEventListener("error", () => finish(null), { once: true });
    video.addEventListener("loadedmetadata", () => {
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
      const targetTime = duration > 0
        ? Math.min(Math.max(duration * 0.15, 0.4), Math.max(duration - 0.1, 0))
        : 0;

      if (targetTime <= 0.05) {
        if (video.readyState >= 2) {
          drawFrame();
        } else {
          video.addEventListener("loadeddata", drawFrame, { once: true });
        }
        return;
      }

      video.addEventListener("seeked", drawFrame, { once: true });
      try {
        video.currentTime = targetTime;
      } catch {
        if (video.readyState >= 2) {
          drawFrame();
        } else {
          video.addEventListener("loadeddata", drawFrame, { once: true });
        }
      }
    }, { once: true });

    video.src = src;
    video.load();
  });
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
  const [imageSourceFiles, setImageSourceFiles] = useState<File[]>([]);
  const [imageSourceReusedFileIds, setImageSourceReusedFileIds] = useState<string[]>([]);
  const [imageMaskFiles, setImageMaskFiles] = useState<File[]>([]);
  const [imageMaskReusedFileIds, setImageMaskReusedFileIds] = useState<string[]>([]);
  const [hint, setHint] = useState("");
  const [lastSubmittedTaskId, setLastSubmittedTaskId] = useState<string | null>(() =>
    readLastSubmittedTaskId(),
  );
  const [recentOverlayTaskId, setRecentOverlayTaskId] = useState<string | null>(null);
  const skipNextPendingClearHydrationRef = useRef(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const [openPopover, setOpenPopover] = useState<"model" | "params" | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const inlineFileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Cmd+Enter / Ctrl+Enter to submit
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        formRef.current?.requestSubmit();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

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
    if (selectedProvider && isImageProviderType(selectedProvider.type)) {
      for (const field of selectedOperation.fields) {
        if (
          field.input_type === "file" ||
          field.input_type === "file_list" ||
          field.key === "image" ||
          field.key === "mask_file_id"
        ) {
          excluded.add(fieldKey(field));
        }
      }
    }
    return selectedOperation.fields.filter((field) => !excluded.has(fieldKey(field)));
  }, [
    durationField,
    orientationField,
    promptField,
    qualityField,
    quickMediaFields,
    resolutionField,
    selectedProvider,
    selectedOperation,
  ]);
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
  const trackedPreview = useMemo(() => {
    if (!trackedTask || trackedTask.status !== "succeeded") {
      return null;
    }
    if (trackedTask.asset_type === "video") {
      const url = extractVideoUrl(trackedTask);
      return url ? { kind: "video" as const, url } : null;
    }
    const urls = extractImageUrls(trackedTask);
    return urls[0] ? { kind: "image" as const, url: urls[0] } : null;
  }, [trackedTask]);
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
  const imageModelFamilies = useMemo(
    () =>
      currentGenerationKind === "image" ? collectImageModelFamilies(providerChoices) : [],
    [currentGenerationKind, providerChoices],
  );
  const currentImageFamily = useMemo(() => {
    if (!imageModelFamilies.length) {
      return null;
    }
    return (
      imageModelFamilies.find((family) =>
        family.variants.some((variant) => variant.model.name === modelName),
      ) ?? imageModelFamilies[0]
    );
  }, [imageModelFamilies, modelName]);
  const currentImageVariant = useMemo(() => {
    if (!currentImageFamily) {
      return null;
    }
    return (
      currentImageFamily.variants.find((variant) => variant.model.name === modelName) ??
      currentImageFamily.variants[0] ??
      null
    );
  }, [currentImageFamily, modelName]);
  const imageResolutionChoices = useMemo(
    () =>
      currentImageFamily
        ? Array.from(
            new Map(
              currentImageFamily.variants.map((variant) => [
                variant.resolutionKey,
                variant.resolutionLabel,
              ]),
            ).values(),
          )
        : [],
    [currentImageFamily],
  );
  const hasImageSourceAttachments =
    imageSourceFiles.length > 0 || imageSourceReusedFileIds.length > 0;
  const currentImageResolutionLabel = currentImageVariant?.resolutionLabel ?? "1K";
  const currentImageAsyncEnabled = currentImageVariant?.asyncEnabled ?? false;
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
  const sharedImageSourceField = useMemo<ProviderOperationField>(
    () => ({
      key: SHARED_IMAGE_SOURCE_FIELD_KEY,
      label: t("create.imageSourceField"),
      target: "provider_options",
      input_type: "file_list",
      required: false,
      default: null,
      placeholder: null,
      help_text: t("create.imageSourceHelp"),
      min: null,
      max: null,
      step: null,
      options: [],
    }),
    [t],
  );
  const sharedImageMaskField = useMemo<ProviderOperationField>(
    () => ({
      key: SHARED_IMAGE_MASK_FIELD_KEY,
      label: t("create.imageMaskField"),
      target: "provider_options",
      input_type: "file",
      required: false,
      default: null,
      placeholder: null,
      help_text: t("create.imageMaskHelp"),
      min: null,
      max: null,
      step: null,
      options: [],
    }),
    [t],
  );
  const composerMediaFields = useMemo(() => {
    if (currentGenerationKind !== "image") {
      return quickMediaFields;
    }
    const fields = [sharedImageSourceField];
    if (selectedOperation?.id === "edit") {
      fields.push(sharedImageMaskField);
    }
    return fields;
  }, [
    currentGenerationKind,
    quickMediaFields,
    selectedOperation?.id,
    sharedImageMaskField,
    sharedImageSourceField,
  ]);
  const uiFiles = useMemo(() => {
    if (currentGenerationKind !== "image") {
      return files;
    }
    return {
      ...files,
      [fieldKey(sharedImageSourceField)]: imageSourceFiles,
      [fieldKey(sharedImageMaskField)]: imageMaskFiles,
    };
  }, [
    currentGenerationKind,
    files,
    imageMaskFiles,
    imageSourceFiles,
    sharedImageMaskField,
    sharedImageSourceField,
  ]);
  const uiReusedFileIds = useMemo(() => {
    if (currentGenerationKind !== "image") {
      return reusedFileIds;
    }
    return {
      ...reusedFileIds,
      [fieldKey(sharedImageSourceField)]: imageSourceReusedFileIds,
      [fieldKey(sharedImageMaskField)]: imageMaskReusedFileIds,
    };
  }, [
    currentGenerationKind,
    imageMaskReusedFileIds,
    imageSourceReusedFileIds,
    reusedFileIds,
    sharedImageMaskField,
    sharedImageSourceField,
  ]);

  // Primary file field for inline "+" button
  const primaryFileField = composerMediaFields[0] ?? null;
  // All inline file previews (from all quickMediaFields)
  const inlineFilePreviews = useMemo(() => {
    const items: Array<{ fieldKey: string; source: "local" | "reused"; index: number; file?: File; fileId?: string }> = [];
    for (const field of composerMediaFields) {
      const key = fieldKey(field);
      const reused = uiReusedFileIds[key] ?? [];
      for (let i = 0; i < reused.length; i++) {
        items.push({ fieldKey: key, source: "reused", index: i, fileId: reused[i] });
      }
      const local = uiFiles[key] ?? [];
      for (let i = 0; i < local.length; i++) {
        items.push({ fieldKey: key, source: "local", index: i, file: local[i] });
      }
    }
    return items;
  }, [composerMediaFields, uiFiles, uiReusedFileIds]);

  // Model display label for the chip
  const modelChipLabel = useMemo(() => {
    if (currentGenerationKind === "image" && currentImageFamily) {
      const parts: string[] = [];
      if (imageModelFamilies.length > 1) {
        parts.push(currentImageFamily.provider.display_name);
      }
      parts.push(currentImageFamily.label);
      parts.push(currentImageResolutionLabel);
      parts.push(
        currentImageAsyncEnabled ? t("create.imageAsyncOn") : t("create.imageAsyncOff"),
      );
      return parts.join(" · ");
    }
    if (!selectedProvider || !selectedModel) return "";
    const parts: string[] = [];
    if (providerChoices.length > 1) parts.push(selectedProvider.display_name);
    parts.push(selectedModel.display_name);
    if (selectedModel.operations.length > 1 && selectedOperation) {
      parts.push(selectedOperation.display_name);
    }
    return parts.join(" · ");
  }, [
    currentGenerationKind,
    currentImageAsyncEnabled,
    currentImageFamily,
    currentImageResolutionLabel,
    imageModelFamilies.length,
    providerChoices.length,
    selectedOperation,
    selectedProvider,
    selectedModel,
    t,
  ]);
  const keyboardShortcutLabel = useMemo(() => {
    if (typeof navigator === "undefined") {
      return "Ctrl Enter";
    }
    const platform = [navigator.platform, navigator.userAgent].join(" ");
    return /mac|iphone|ipad|ipod/i.test(platform) ? "⌘ Enter" : "Ctrl Enter";
  }, []);
  const submitLabel =
    currentGenerationKind === "image" ? t("create.generateImage") : t("create.generateVideo");

  useEffect(() => {
    if (currentGenerationKind !== "video" || !videoProviders.length) {
      return;
    }
    if (!videoProviders.some((provider) => provider.id === providerId)) {
      setProviderId(videoProviders[0].id);
    }
  }, [currentGenerationKind, providerId, videoProviders]);

  useEffect(() => {
    if (currentGenerationKind === "image") {
      return;
    }
    setImageSourceFiles([]);
    setImageSourceReusedFileIds([]);
    setImageMaskFiles([]);
    setImageMaskReusedFileIds([]);
  }, [currentGenerationKind]);

  useEffect(() => {
    if (
      currentGenerationKind !== "image" ||
      !currentImageFamily ||
      !currentImageVariant ||
      !hasImageSourceAttachments ||
      !currentImageAsyncEnabled
    ) {
      return;
    }
    const nextVariant = pickImageFamilyVariant(currentImageFamily, {
      resolutionKey: currentImageVariant.resolutionKey,
      asyncEnabled: false,
    });
    if (!nextVariant || nextVariant.model.name === modelName) {
      return;
    }
    setModelName(nextVariant.model.name);
  }, [
    currentGenerationKind,
    currentImageAsyncEnabled,
    currentImageFamily,
    currentImageVariant,
    hasImageSourceAttachments,
    modelName,
  ]);

  useEffect(() => {
    if (currentGenerationKind !== "image" || !currentImageVariant) {
      return;
    }
    const nextOperation =
      hasImageSourceAttachments && currentImageVariant.editOperation
        ? currentImageVariant.editOperation
        : currentImageVariant.generateOperation;
    if (!nextOperation || nextOperation.id === operationId) {
      return;
    }
    setOperationId(nextOperation.id);
  }, [
    currentGenerationKind,
    currentImageVariant,
    hasImageSourceAttachments,
    operationId,
  ]);

  useEffect(() => {
    persistLastSubmittedTaskId(lastSubmittedTaskId);
  }, [lastSubmittedTaskId]);

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
    const previousResolution = values["request:resolution"] ?? "";
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
    let pendingImageSourceFileIds: string[] = [];
    let pendingImageMaskFileIds: string[] = [];
    if (
      pending &&
      pending.provider === providerId &&
      pending.model === modelName &&
      pending.operation === selectedOperation.id
    ) {
      const applied = applyDraft(hydrated, selectedOperation, pending);
      Object.assign(hydratedReusedFileIds, applied.reusedFileIds);
      pendingImageSourceFileIds = extractDraftImageSourceFileIds(pending.providerOptions);
      pendingImageMaskFileIds = extractDraftImageMaskFileIds(pending.providerOptions);
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
    if (resolutionField) {
      const resolutionKey = fieldKey(resolutionField);
      if (!hydrated[resolutionKey] && previousResolution.trim()) {
        hydrated[resolutionKey] =
          pickResolutionValue(resolutionField, "", parseResolutionMeta(previousResolution)) ??
          previousResolution;
      }
    }

    setValues(hydrated);
    setFiles({});
    setReusedFileIds(hydratedReusedFileIds);
    if (pendingImageSourceFileIds.length || pendingImageMaskFileIds.length) {
      setImageSourceFiles([]);
      setImageMaskFiles([]);
      setImageSourceReusedFileIds(pendingImageSourceFileIds);
      setImageMaskReusedFileIds(pendingImageMaskFileIds);
    }
  }, [
    currentGenerationKind,
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
          const {
            selectedFiles,
            reusableIds,
          } = resolveSubmitFileState(
            field,
            {
              files,
              reusedFileIds,
            },
            currentGenerationKind === "image"
              ? {
                  sourceFiles: imageSourceFiles,
                  sourceReusedFileIds: imageSourceReusedFileIds,
                  maskFiles: imageMaskFiles,
                  maskReusedFileIds: imageMaskReusedFileIds,
                }
              : null,
          );
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
    if (field.key === SHARED_IMAGE_SOURCE_FIELD_KEY) {
      setImageSourceFiles(nextFiles);
      if (nextFiles.length) {
        setImageSourceReusedFileIds([]);
      }
      return;
    }
    if (field.key === SHARED_IMAGE_MASK_FIELD_KEY) {
      setImageMaskFiles(nextFiles.slice(0, 1));
      if (nextFiles.length) {
        setImageMaskReusedFileIds([]);
      }
      return;
    }
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
    if (field.key === SHARED_IMAGE_SOURCE_FIELD_KEY) {
      setImageSourceReusedFileIds(nextFileIds);
      if (nextFileIds.length) {
        setImageSourceFiles([]);
      }
      return;
    }
    if (field.key === SHARED_IMAGE_MASK_FIELD_KEY) {
      setImageMaskReusedFileIds(nextFileIds.slice(0, 1));
      if (nextFileIds.length) {
        setImageMaskFiles([]);
      }
      return;
    }
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
  const autoResizeTextarea = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  // Restore textarea height when content is present on mount / route return
  useEffect(() => {
    if (promptValue) {
      // Defer to next frame so the DOM has rendered the value
      requestAnimationFrame(autoResizeTextarea);
    }
  }, [promptValue]);
  const removeInlineFile = (item: typeof inlineFilePreviews[number]) => {
    const key = item.fieldKey;
    if (item.source === "reused" && item.fileId) {
      const current = uiReusedFileIds[key] ?? [];
      const next = current.filter((id) => id !== item.fileId);
      const field = composerMediaFields.find((f) => fieldKey(f) === key);
      if (field) onReusedFileIdsChanged(field, next);
    } else if (item.source === "local") {
      const current = uiFiles[key] ?? [];
      const next = current.filter((_, i) => i !== item.index);
      const field = composerMediaFields.find((f) => fieldKey(f) === key);
      if (field) onFileFieldChanged(field, next);
    }
  };
  const handleInlineFilePick = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!primaryFileField) return;
    const picked = Array.from(event.target.files ?? []).filter(
      (f) => f.type.startsWith("image/") || /\.(jpg|jpeg|png|webp)$/i.test(f.name),
    );
    if (!picked.length) return;
    const key = fieldKey(primaryFileField);
    const isMulti = primaryFileField.input_type === "file_list";
    const current = files[key] ?? [];
    const next = isMulti ? [...current, ...picked] : [picked[0]];
    onFileFieldChanged(primaryFileField, next);
    event.currentTarget.value = "";
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
  const selectImageVariant = (
    familyId: string,
    options?: { resolutionLabel?: string; asyncEnabled?: boolean },
  ) => {
    const family = imageModelFamilies.find((item) => item.id === familyId);
    if (!family) {
      return;
    }
    const nextVariant = pickImageFamilyVariant(family, {
      resolutionKey: resolutionLabelToKey(options?.resolutionLabel ?? currentImageResolutionLabel),
      asyncEnabled: options?.asyncEnabled ?? currentImageAsyncEnabled,
    });
    if (!nextVariant) {
      return;
    }
    if (providerId !== nextVariant.provider.id) {
      setProviderId(nextVariant.provider.id);
    }
    if (modelName !== nextVariant.model.name) {
      setModelName(nextVariant.model.name);
    }
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
  const showRecentStatusBadge = (task: VideoTaskDetail): boolean =>
    task.status === "queued" || task.status === "running" || task.status === "canceled";
  const estimatedWaitLabel = (task: VideoTaskDetail | null): string | null => {
    if (!task || (task.status !== "queued" && task.status !== "running")) {
      return null;
    }
    const model = task.model.toLowerCase();
    const provider = task.provider.toLowerCase();
    let minSec = 30;
    let maxSec = 120;
    if (model.includes("veo")) {
      minSec = 30;
      maxSec = 180;
    } else if (model.includes("sora")) {
      minSec = 60;
      maxSec = 300;
    } else if (provider.includes("comfy")) {
      minSec = 60;
      maxSec = 600;
    } else if (provider.includes("image") || model.includes("image") || model.includes("gemini")) {
      minSec = 10;
      maxSec = 90;
    }
    const fmt = (s: number) => s >= 60 ? `${Math.round(s / 60)}min` : `${s}s`;
    return locale === "zh-CN"
      ? `预计 ${fmt(minSec)} – ${fmt(maxSec)}`
      : `est. ${fmt(minSec)} – ${fmt(maxSec)}`;
  };
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-32">
        <SkeletonForm />
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

  const hasQuickParams = Boolean(
    (resolutionField && (ratioChoices.length > 0 || resolutionValue)) ||
    hasQuickSize ||
    (orientationField && orientationChoices.length > 0) ||
    (durationField && durationChoices.length > 0),
  );

  return (
    <div className="flex flex-col" style={{ minHeight: "calc(100dvh - 60px)" }}>
      {/* ── Canvas Area (above composer) ─────────────── */}
      <div className="create-canvas px-5 sm:px-8">
        <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-6 py-8 sm:gap-8 sm:py-10">

          {/* Tracked Task */}
          {lastSubmittedTaskId && trackedTask ? (
            <div className="tracked-card card-flat space-y-3">
              {/* Status header */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className={`tag ${
                    statusTone(trackedTask) === "ok"
                      ? "tag-success"
                      : statusTone(trackedTask) === "danger"
                        ? "tag-error"
                        : statusTone(trackedTask) === "warn"
                          ? "tag-warning"
                          : "tag-neutral"
                  }`}>
                    {statusLabel(trackedTask)}
                  </span>
                  <span className="font-mono text-[11px] tabular-nums text-[var(--c-text-tertiary)]">
                    {lastSubmittedTaskId.slice(0, 8)}
                  </span>
                </div>
                <button type="button" className="btn-ghost text-xs" onClick={() => setLastSubmittedTaskId(null)}>
                  {t("create.feedbackContinue")}
                </button>
              </div>

              {/* Running pulse */}
              {(trackedTask.status === "queued" || trackedTask.status === "running") ? (
                <div className="flex items-center gap-3 rounded-xl bg-warning-bg px-4 py-3">
                  <div className="status-dot status-dot-pulse bg-warning-text" />
                  <div className="flex flex-1 items-center justify-between gap-2">
                    <p className="m-0 text-xs text-warning-text">
                      {trackedTask.status === "queued"
                        ? (trackedTask.queue_position != null && trackedTask.queue_position > 0
                            ? t("create.feedbackQueuedWithPosition", { position: trackedTask.queue_position })
                            : t("create.feedbackQueued"))
                        : t("create.feedbackRunning")}
                    </p>
                    {estimatedWaitLabel(trackedTask) ? (
                      <span className="shrink-0 font-mono text-[11px] tabular-nums text-warning-text/70">
                        {estimatedWaitLabel(trackedTask)}
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {/* Succeeded preview */}
              {trackedTask.status === "succeeded" && trackedPreview ? (
                <button
                  type="button"
                  className="block w-full overflow-hidden rounded-2xl border border-border bg-canvas p-0 text-left transition-all duration-200 hover:border-[var(--c-border-focus)] hover:shadow-[var(--shadow-md)]"
                  onClick={() => navigate(`/works?taskId=${lastSubmittedTaskId}`)}
                >
                  {trackedPreview.kind === "video" ? (
                    <VideoPosterPreview
                      src={trackedPreview.url}
                      className="aspect-video w-full"
                      imageClassName="block h-full w-full object-cover"
                    />
                  ) : (
                    <img src={trackedPreview.url} alt="" className="block aspect-video w-full object-cover" />
                  )}
                </button>
              ) : null}

              {trackedTask.status === "succeeded" ? (
                <div className="flex items-center gap-2">
                  <button type="button" className="btn-primary text-xs" onClick={() => navigate(`/works?taskId=${lastSubmittedTaskId}`)}>
                    <ArrowSquareOut size={13} />
                    {t("create.feedbackViewResult")}
                  </button>
                  <button type="button" className="btn-ghost text-xs" onClick={() => setLastSubmittedTaskId(null)}>
                    {t("create.feedbackContinue")}
                  </button>
                </div>
              ) : null}

              {trackedTask.status === "failed" && trackedTask.error ? (
                <p className="m-0 rounded-xl bg-error-bg px-3 py-2 text-xs text-error-text">
                  {errorMessage(trackedTask)}
                </p>
              ) : null}
            </div>
          ) : null}

          <section className="card flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-label">{t("create.recentTasks")}</span>
              <button type="button" className="btn-ghost text-xs" onClick={() => navigate("/works")}>
                {t("create.viewAll")}
              </button>
            </div>

            {recentTasks.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {recentTasks.map((task) => {
                  const preview = recentTaskPreviewMap.get(task.task_id) ?? null;
                  const tone =
                    statusTone(task) === "ok"
                      ? "tag-success"
                      : statusTone(task) === "danger"
                        ? "tag-error"
                        : statusTone(task) === "warn"
                          ? "tag-warning"
                          : "tag-neutral";
                  return (
                    <button
                      key={task.task_id}
                      type="button"
                      className="recent-task-card"
                      onClick={() => setRecentOverlayTaskId(task.task_id)}
                    >
                      <div className="relative overflow-hidden rounded-[18px] border border-border bg-canvas">
                        {preview ? (
                          preview.kind === "video" ? (
                            <VideoPosterPreview
                              src={preview.url}
                              className="aspect-[4/3] w-full"
                              imageClassName="block h-full w-full object-cover"
                            />
                          ) : (
                            <img src={preview.url} alt="" className="block aspect-[4/3] w-full object-cover" loading="lazy" />
                          )
                        ) : (
                          <div className={`aspect-[4/3] w-full ${
                            task.status === "failed" || task.status === "canceled"
                              ? "bg-error-bg"
                              : task.status === "queued" || task.status === "running"
                                ? "bg-warning-bg"
                                : "bg-surface-raised"
                          }`}>
                          </div>
                        )}
                        {showRecentStatusBadge(task) ? (
                          <div className="absolute left-3 top-3">
                          <span className={`tag ${tone}`}>{statusLabel(task)}</span>
                          </div>
                        ) : null}
                      </div>
                      <div className="flex flex-1 flex-col gap-2 px-1">
                        <p className="m-0 line-clamp-3 text-left text-sm font-semibold leading-6 text-[var(--c-text)]">
                          {task.prompt?.trim() || "—"}
                        </p>
                        <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--c-text-tertiary)]">
                          <span className="truncate">{task.provider}</span>
                          <span className="shrink-0">{new Date(task.created_at).toLocaleDateString(locale === "zh-CN" ? "zh-CN" : "en-US")}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-border bg-surface-raised px-6 py-12 text-center">
                <p className="m-0 text-sm font-semibold text-[var(--c-text)]">{t("create.recentEmptyTitle")}</p>
                <p className="m-0 mt-2 text-sm leading-relaxed text-[var(--c-text-secondary)]">
                  {t("create.recentEmptyBody")}
                </p>
              </div>
            )}
          </section>
        </div>
      </div>

      {/* ── Composer Bar ────────────────────────────── */}
      <form
        ref={formRef}
        className="composer-bar"
        onSubmit={(event) => {
          event.preventDefault();
          void submitMutation.mutateAsync();
        }}
      >
        {/* Popover backdrop */}
        {openPopover ? (
          <div className="popover-backdrop" onClick={() => setOpenPopover(null)} />
        ) : null}

        <div className="composer-card">
          {/* Input row: thumbnails + textarea + submit */}
          <div className="composer-input-row">
            {/* Inline file thumbnails */}
            {composerMediaFields.length > 0 ? (
              <div className="composer-thumbs">
                {inlineFilePreviews.map((item) => (
                  <InlineThumb
                    key={`${item.fieldKey}_${item.source}_${item.index}`}
                    item={item}
                    onRemove={() => removeInlineFile(item)}
                  />
                ))}
                <button
                  type="button"
                  className="composer-add-btn"
                  onClick={() => inlineFileInputRef.current?.click()}
                  title={t("create.fileUploadImage")}
                >
                  <Plus size={16} weight="bold" />
                </button>
                <input
                  ref={inlineFileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple={primaryFileField?.input_type === "file_list"}
                  className="hidden"
                  onChange={handleInlineFilePick}
                />
              </div>
            ) : null}

            {/* Prompt textarea */}
            {promptField ? (
              <textarea
                ref={textareaRef}
                className="composer-textarea"
                rows={1}
                value={promptValue}
                placeholder={promptPlaceholder}
                onChange={(e) => {
                  onFieldChanged(promptField, e.target.value);
                  autoResizeTextarea();
                }}
                onInput={autoResizeTextarea}
              />
            ) : (
              <div className="flex-1 py-2 text-sm text-[var(--c-text-tertiary)]">
                {t("create.promptNotSupported")}
              </div>
            )}

            {/* Submit button */}
            <button
              type="submit"
              className="composer-submit"
              disabled={submitMutation.isPending}
              title={submitMutation.isPending ? t("create.submitting") : submitLabel}
            >
              <PaperPlaneTilt size={16} weight="fill" />
            </button>
          </div>

          {/* Hint message */}
          {hint ? <p className="m-0 text-[11px] text-[var(--c-text-secondary)]">{hint}</p> : null}

          {/* Chip row */}
          <div className="composer-chip-row">
            {/* Model selector chip */}
            <div className="composer-popover-anchor">
              <button
                type="button"
                className={`chip ${openPopover === "model" ? "chip-active" : ""}`}
                onClick={() => setOpenPopover(openPopover === "model" ? null : "model")}
              >
                {currentGenerationKind === "image" ? <ImageSquare size={13} weight="fill" /> : <VideoCamera size={13} weight="fill" />}
                <span className="max-w-[180px] truncate">{modelChipLabel || t("create.model")}</span>
                <CaretDown size={10} />
              </button>

              {/* Model popover */}
              {openPopover === "model" ? (
                <div className="composer-popover">
                  <p className="m-0 mb-3 text-label">{t("create.model")}</p>

                  {/* Generation kind toggle */}
                  {canSwitchGenerationKind ? (
                    <div className="segment-group mb-3 w-full">
                      <button
                        type="button"
                        className={`segment-item flex-1 ${currentGenerationKind === "image" ? "segment-active" : ""}`}
                        onClick={() => onGenerationKindChanged("image")}
                      >
                        <ImageSquare size={13} weight={currentGenerationKind === "image" ? "fill" : "regular"} />
                        {t("create.quickImage")}
                      </button>
                      <button
                        type="button"
                        className={`segment-item flex-1 ${currentGenerationKind === "video" ? "segment-active" : ""}`}
                        onClick={() => onGenerationKindChanged("video")}
                      >
                        <VideoCamera size={13} weight={currentGenerationKind === "video" ? "fill" : "regular"} />
                        {t("create.quickVideo")}
                      </button>
                    </div>
                  ) : null}

                  {currentGenerationKind === "image" && imageModelFamilies.length ? (
                    <div className="flex flex-col gap-4">
                      <div className="space-y-2">
                        <p className="m-0 text-label">{t("create.imageModelLabel")}</p>
                        <div className="flex flex-col gap-1">
                          {imageModelFamilies.map((family) => {
                            const isSelected = currentImageFamily?.id === family.id;
                            return (
                              <button
                                type="button"
                                key={family.id}
                                className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                                  isSelected
                                    ? "bg-[var(--c-surface-inset)] font-semibold text-[var(--c-text)]"
                                    : "text-[var(--c-text-secondary)] hover:bg-[var(--c-border-subtle)] hover:text-[var(--c-text)]"
                                }`}
                                onClick={() => {
                                  selectImageVariant(family.id);
                                }}
                              >
                                <span className="flex-1 truncate">
                                  {imageModelFamilies.length > 1
                                    ? `${family.provider.display_name} · ${family.label}`
                                    : family.label}
                                </span>
                                {isSelected ? <span className="text-[var(--c-accent)]">✓</span> : null}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <p className="m-0 text-label">{t("create.imageResolutionLabel")}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {imageResolutionChoices.map((resolution) => (
                            <button
                              type="button"
                              key={resolution}
                              className={`chip ${currentImageResolutionLabel === resolution ? "chip-active" : ""}`}
                              onClick={() => {
                                if (currentImageFamily) {
                                  selectImageVariant(currentImageFamily.id, {
                                    resolutionLabel: resolution,
                                  });
                                }
                              }}
                            >
                              {resolution}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <p className="m-0 text-label">{t("create.imageAsyncLabel")}</p>
                          {hasImageSourceAttachments ? (
                            <span className="text-[11px] text-[var(--c-text-tertiary)]">
                              {t("create.imageModeAutoEdit")}
                            </span>
                          ) : null}
                        </div>
                        <div className="segment-group w-full">
                          <button
                            type="button"
                            className={`segment-item flex-1 ${!currentImageAsyncEnabled ? "segment-active" : ""}`}
                            onClick={() => {
                              if (currentImageFamily) {
                                selectImageVariant(currentImageFamily.id, { asyncEnabled: false });
                              }
                            }}
                          >
                            {t("create.imageAsyncOff")}
                          </button>
                          <button
                            type="button"
                            className={`segment-item flex-1 ${currentImageAsyncEnabled ? "segment-active" : ""}`}
                            onClick={() => {
                              if (hasImageSourceAttachments || !currentImageFamily) {
                                return;
                              }
                              selectImageVariant(currentImageFamily.id, { asyncEnabled: true });
                            }}
                            disabled={hasImageSourceAttachments}
                          >
                            {t("create.imageAsyncOn")}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {providerChoices.flatMap((provider) =>
                        provider.models.flatMap((model) =>
                          model.operations.map((operation) => {
                            const isSelected =
                              provider.id === providerId &&
                              model.name === modelName &&
                              operation.id === (selectedOperation?.id ?? operationId);
                            const showOp = model.operations.length > 1;
                            return (
                              <button
                                type="button"
                                key={`${provider.id}::${model.name}::${operation.id}`}
                                className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${
                                  isSelected
                                    ? "bg-[var(--c-surface-inset)] font-semibold text-[var(--c-text)]"
                                    : "text-[var(--c-text-secondary)] hover:bg-[var(--c-border-subtle)] hover:text-[var(--c-text)]"
                                }`}
                                onClick={() => {
                                  setProviderId(provider.id);
                                  setModelName(model.name);
                                  setOperationId(operation.id);
                                  setOpenPopover(null);
                                }}
                              >
                                <span className="flex-1 truncate">
                                  {providerChoices.length > 1 ? `${provider.display_name} · ` : ""}
                                  {model.display_name}
                                  {showOp ? ` · ${operation.display_name}` : ""}
                                </span>
                                {isSelected ? <span className="text-[var(--c-accent)]">✓</span> : null}
                              </button>
                            );
                          }),
                        ),
                      )}
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            {/* Params chip */}
            {hasQuickParams ? (
              <div className="composer-popover-anchor">
                <button
                  type="button"
                  className={`chip ${openPopover === "params" ? "chip-active" : ""}`}
                  onClick={() => setOpenPopover(openPopover === "params" ? null : "params")}
                >
                  <Faders size={13} weight="bold" />
                  <span>{t("create.quickParams")}</span>
                </button>

                {/* Params popover */}
                {openPopover === "params" ? (
                  <div className="composer-popover composer-popover-wide">
                    <p className="m-0 mb-4 text-sm font-semibold text-[var(--c-text)]">{t("create.quickParams")}</p>

                    <div className="flex flex-col gap-4">
                      {/* Ratio */}
                      {resolutionField && (ratioChoices.length > 0 || resolutionValue) ? (
                        <div className="space-y-2">
                          <p className="m-0 text-label">{t("create.quickRatio")}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {(ratioChoices.length ? ratioChoices : [resolutionValue]).filter(Boolean).map((ratio) => (
                              <button
                                type="button"
                                key={`ratio_${ratio}`}
                                className={`chip ${currentRatioDisplay === ratio ? "chip-active" : ""}`}
                                onClick={() => onRatioChanged(ratio)}
                              >
                                {ratio}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {/* Quality / Size */}
                      {hasQuickSize ? (
                        <div className="space-y-2">
                          <p className="m-0 text-label">{t("create.quickSize")}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {(qualityField ? qualityChoices : sizeChoices).map((size) => {
                              const active = qualityField ? qualityValue === size : currentSizeDisplay === size;
                              const label = qualityField
                                ? qualityField.options.find((o) => o.value === size)?.label ?? size
                                : size;
                              return (
                                <button type="button" key={`size_${size}`} className={`chip ${active ? "chip-active" : ""}`} onClick={() => onSizeChanged(size)}>
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}

                      {/* Orientation */}
                      {orientationField && orientationChoices.length > 0 ? (
                        <div className="space-y-2">
                          <p className="m-0 text-label">{t("create.quickOrientation")}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {orientationChoices.map((option) => (
                              <button type="button" key={`o_${option.value}`} className={`chip ${orientationValue === option.value ? "chip-active" : ""}`} onClick={() => onOrientationChanged(option.value)}>
                                {option.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {/* Duration */}
                      {durationField && durationChoices.length > 0 ? (
                        <div className="space-y-2">
                          <p className="m-0 text-label">{t("create.quickDuration")}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {durationChoices.map((seconds) => (
                              <button type="button" key={`d_${seconds}`} className={`chip ${durationValue === String(seconds) ? "chip-active" : ""}`} onClick={() => onFieldChanged(durationField, String(seconds))}>
                                {seconds}s
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {/* Veo prompt guide */}
                      {showVeoPromptGuide ? (
                        <div className="rounded-xl border border-border bg-info-bg p-3 text-xs">
                          <p className="m-0 mb-1 font-medium text-info-text">{t("create.veoPromptGuideTitle")}</p>
                          <div className="flex flex-wrap gap-3">
                            <a href={VEO_PROMPT_GUIDE_LINK_DOCS} target="_blank" rel="noreferrer" className="text-info-text underline decoration-dotted underline-offset-2">{t("create.veoPromptGuideLinkDocs")}</a>
                            <a href={VEO_PROMPT_GUIDE_LINK_BLOG} target="_blank" rel="noreferrer" className="text-info-text underline decoration-dotted underline-offset-2">{t("create.veoPromptGuideLinkBlog")}</a>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Advanced button */}
            {advancedFields.length > 0 ? (
              <button
                type="button"
                className="chip"
                onClick={() => setShowAdvanced(!showAdvanced)}
              >
                <GearSix size={13} />
                <span>{t("create.advancedLabel")}</span>
                <span className="text-[10px] text-[var(--c-text-tertiary)]">{advancedFields.length}</span>
              </button>
            ) : null}

            {/* Keyboard shortcut hint */}
            <kbd className="ml-auto hidden rounded-full bg-[var(--c-surface-inset)] px-2 py-0.5 text-[10px] font-medium text-[var(--c-text-tertiary)] sm:inline">
              {keyboardShortcutLabel}
            </kbd>

            {/* Queue count */}
            {inProgressCount > 0 ? (
              <span className="tag tag-warning font-mono tabular-nums text-[10px]">{t("app.topbar.queue", { count: inProgressCount })}</span>
            ) : null}
          </div>
        </div>
      </form>

      {/* ── Advanced Panel (slide-up overlay) ────────── */}
      {showAdvanced && advancedFields.length > 0 ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-overlay"
          onClick={() => setShowAdvanced(false)}
        >
          <div
            className="w-full max-w-[820px] max-h-[70vh] overflow-y-auto rounded-t-2xl border border-border bg-surface p-5 shadow-[var(--shadow-overlay)] animate-enter"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="m-0 text-sm font-semibold text-[var(--c-text)]">{t("create.advancedLabel")}</h3>
              <button type="button" className="btn-ghost text-xs" onClick={() => setShowAdvanced(false)}>
                {t("common.close")}
              </button>
            </div>

            {/* Quick media fields (full version with drag-drop) */}
            {composerMediaFields.length > 0 ? (
              <div className="mb-4 space-y-3 rounded-xl border border-border bg-surface-raised p-4">
                <p className="m-0 text-label">{t("create.referenceAssets")}</p>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {composerMediaFields.map((field) =>
                    renderField(field, values, uiFiles, uiReusedFileIds, onFieldChanged, onFileFieldChanged, onReusedFileIdsChanged, "compact"),
                  )}
                </div>
              </div>
            ) : null}

            {advancedGroups.map((group) => (
              <section key={group.id} className="mb-4 rounded-xl border border-border bg-surface-raised p-4">
                <p className="m-0 mb-3 text-label">{t(`create.advancedGroup.${group.id}`)} ({group.fields.length})</p>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {group.fields.map((field) =>
                    renderField(field, values, uiFiles, uiReusedFileIds, onFieldChanged, onFileFieldChanged, onReusedFileIdsChanged),
                  )}
                </div>
              </section>
            ))}
          </div>
        </div>
      ) : null}

      {/* Work detail overlay */}
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

/* ── Inline Thumbnail Component ─────────────────────── */
function InlineThumb({
  item,
  onRemove,
}: {
  item: { source: "local" | "reused"; file?: File; fileId?: string };
  onRemove: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const gatewayToken = useAppSettingsStore((s) => s.gatewayToken);

  useEffect(() => {
    if (item.source === "local" && item.file) {
      const objectUrl = URL.createObjectURL(item.file);
      setUrl(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    }
    if (item.source === "reused" && item.fileId) {
      let active = true;
      fetchUploadedFileBinary(item.fileId, gatewayToken).then(({ blob }) => {
        if (!active) return;
        const objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      }).catch(() => {});
      return () => { active = false; };
    }
  }, [item.source, item.file, item.fileId, gatewayToken]);

  return (
    <div className="composer-thumb">
      {url ? <img src={url} alt="" /> : <div className="h-full w-full bg-[var(--c-surface-inset)]" />}
      <button type="button" className="composer-thumb-remove" onClick={onRemove}>
        <X size={10} weight="bold" />
      </button>
    </div>
  );
}

function VideoPosterPreview({
  src,
  className,
  imageClassName,
}: {
  src: string;
  className: string;
  imageClassName: string;
}) {
  const { t } = useI18n();
  const [posterUrl, setPosterUrl] = useState<string | null>(() => VIDEO_POSTER_CACHE.get(src) ?? null);

  useEffect(() => {
    const cached = VIDEO_POSTER_CACHE.get(src);
    if (cached !== undefined) {
      setPosterUrl(cached);
      return;
    }

    let active = true;
    setPosterUrl(null);
    captureVideoPoster(src)
      .then((poster) => {
        VIDEO_POSTER_CACHE.set(src, poster);
        if (active) {
          setPosterUrl(poster);
        }
      })
      .catch(() => {
        VIDEO_POSTER_CACHE.set(src, null);
        if (active) {
          setPosterUrl(null);
        }
      });

    return () => {
      active = false;
    };
  }, [src]);

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {posterUrl ? (
        <img src={posterUrl} alt="" className={imageClassName} loading="lazy" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-surface-raised text-[var(--c-text-tertiary)]">
          <div className="flex items-center gap-2 rounded-full border border-border bg-surface/95 px-3 py-1.5 text-[11px] font-medium shadow-[var(--shadow-xs)]">
            <VideoCamera size={14} weight="fill" />
            <span>{t("create.generateVideo")}</span>
          </div>
        </div>
      )}
      <div className="pointer-events-none absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded-full bg-black/55 text-white shadow-[var(--shadow-sm)]">
        <VideoCamera size={14} weight="fill" />
      </div>
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
                      className="shrink-0 cursor-pointer border-none bg-transparent text-[10px] text-error-text transition-colors duration-150 hover:opacity-70"
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
                    className="shrink-0 cursor-pointer border-none bg-transparent text-[10px] text-error-text transition-colors duration-150 hover:opacity-70"
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
          <button type="button" className="w-full cursor-pointer border-none bg-transparent py-8 text-xs text-[var(--c-text-tertiary)] transition-colors duration-150 hover:text-[var(--c-text-secondary)]" onClick={triggerPick}>
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
                  {t("works.lightboxIndex", { index: previewIndex + 1, total: activePreviewItems.length })}
                </p>
                <button
                  type="button"
                  className="cursor-pointer border-none bg-transparent text-sm text-white/60 transition-colors duration-150 hover:text-white"
                  onClick={() => setPreviewIndex(null)}
                >
                  {t("common.close")}
                </button>
              </div>
              <div className="relative flex items-center gap-4">
                {activePreviewItems.length > 1 ? (
                  <button
                    type="button"
                    className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-white/10 text-lg text-white transition-colors duration-150 hover:bg-white/20"
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
                    <CaretLeft size={18} weight="bold" />
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
                    className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full border-none bg-white/10 text-lg text-white transition-colors duration-150 hover:bg-white/20"
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
                    <CaretRight size={18} weight="bold" />
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

function collectImageModelFamilies(providers: ProviderInfo[]): ImageModelFamily[] {
  const families = new Map<string, ImageModelFamily>();
  for (const provider of providers) {
    for (const model of provider.models) {
      const parsed = parseImageModelVariant(model);
      const familyId = `${provider.id}::${parsed.familyLabel}`;
      const existing =
        families.get(familyId) ??
        {
          id: familyId,
          label: parsed.familyLabel,
          provider,
          variants: [],
        };
      existing.variants.push({
        familyId,
        familyLabel: parsed.familyLabel,
        provider,
        model,
        resolutionKey: parsed.resolutionKey,
        resolutionLabel: parsed.resolutionLabel,
        asyncEnabled: parsed.asyncEnabled,
        generateOperation: model.operations.find((operation) => operation.id === "generate") ?? null,
        editOperation: model.operations.find((operation) => operation.id === "edit") ?? null,
      });
      families.set(familyId, existing);
    }
  }
  return Array.from(families.values()).map((family) => ({
    ...family,
    variants: family.variants.sort((left, right) => {
      const resolutionOrder = rankImageResolution(left.resolutionKey) - rankImageResolution(right.resolutionKey);
      if (resolutionOrder !== 0) {
        return resolutionOrder;
      }
      return Number(left.asyncEnabled) - Number(right.asyncEnabled);
    }),
  }));
}

function parseImageModelVariant(model: ProviderModelInfo): {
  familyLabel: string;
  resolutionKey: "1k" | "2k" | "4k";
  resolutionLabel: "1K" | "2K" | "4K";
  asyncEnabled: boolean;
} {
  const normalizedName = model.name.toLowerCase();
  const normalizedDisplay = model.display_name.toLowerCase();
  const asyncEnabled = normalizedName.includes("async") || normalizedDisplay.includes("async");
  const resolutionKey = normalizedName.includes("4k") || normalizedDisplay.includes("4k")
    ? "4k"
    : normalizedName.includes("2k") || normalizedDisplay.includes("2k")
      ? "2k"
      : "1k";
  const resolutionLabel = resolutionKeyToLabel(resolutionKey);
  const familyLabel = model.display_name
    .replace(/\s*\(1k\)/i, "")
    .replace(/\s+1k\b/gi, "")
    .replace(/\s+2k\b/gi, "")
    .replace(/\s+4k\b/gi, "")
    .replace(/\s+async\b/gi, "")
    .trim();
  return {
    familyLabel: familyLabel || model.display_name,
    resolutionKey,
    resolutionLabel,
    asyncEnabled,
  };
}

function pickImageFamilyVariant(
  family: ImageModelFamily,
  options: { resolutionKey?: "1k" | "2k" | "4k"; asyncEnabled?: boolean },
): ImageModelVariant | null {
  const targetResolution = options.resolutionKey;
  const targetAsync = options.asyncEnabled;
  return (
    family.variants.find(
      (variant) =>
        (targetResolution == null || variant.resolutionKey === targetResolution) &&
        (targetAsync == null || variant.asyncEnabled === targetAsync),
    ) ??
    family.variants.find((variant) => targetResolution == null || variant.resolutionKey === targetResolution) ??
    family.variants.find((variant) => targetAsync == null || variant.asyncEnabled === targetAsync) ??
    family.variants[0] ??
    null
  );
}

function resolutionLabelToKey(label: string): "1k" | "2k" | "4k" {
  const normalized = label.trim().toLowerCase();
  if (normalized === "4k") {
    return "4k";
  }
  if (normalized === "2k") {
    return "2k";
  }
  return "1k";
}

function resolutionKeyToLabel(key: "1k" | "2k" | "4k"): "1K" | "2K" | "4K" {
  if (key === "4k") {
    return "4K";
  }
  if (key === "2k") {
    return "2K";
  }
  return "1K";
}

function rankImageResolution(key: "1k" | "2k" | "4k"): number {
  if (key === "1k") {
    return 0;
  }
  if (key === "2k") {
    return 1;
  }
  return 2;
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
    <span className="text-label">{field.label}</span>
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

function extractDraftImageSourceFileIds(providerOptions: Record<string, unknown>): string[] {
  return normalizeUnknownToStringList(
    providerOptions.image_file_ids ?? providerOptions.input_reference_file_ids,
  );
}

function extractDraftImageMaskFileIds(providerOptions: Record<string, unknown>): string[] {
  return normalizeUnknownToStringList(providerOptions.mask_file_id).slice(0, 1);
}

function resolveSubmitFileState(
  field: ProviderOperationField,
  baseState: {
    files: Record<string, File[]>;
    reusedFileIds: Record<string, string[]>;
  },
  imageState: {
    sourceFiles: File[];
    sourceReusedFileIds: string[];
    maskFiles: File[];
    maskReusedFileIds: string[];
  } | null,
): { selectedFiles: File[]; reusableIds: string[] } {
  if (imageState) {
    if (field.key === "image_file_ids" || field.key === "input_reference_file_ids") {
      return {
        selectedFiles: imageState.sourceFiles,
        reusableIds: imageState.sourceReusedFileIds,
      };
    }
    if (field.key === "mask_file_id") {
      return {
        selectedFiles: imageState.maskFiles,
        reusableIds: imageState.maskReusedFileIds,
      };
    }
  }
  const key = fieldKey(field);
  return {
    selectedFiles: baseState.files[key] ?? [],
    reusableIds: baseState.reusedFileIds[key] ?? [],
  };
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
