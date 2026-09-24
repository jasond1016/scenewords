import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  CaretLeft,
  CaretRight,
  Check,
  CircleNotch,
  CloudArrowUp,
  Faders,
  ImageSquare,
  Plus,
  UploadSimple,
  VideoCamera,
  WarningCircle,
  X,
  CaretDown,
  Shapes,
} from "@phosphor-icons/react";
import {
  createScene,
  createVideoTask,
  fetchScenes,
  fetchSubjects,
  fetchUploadedFileBinary,
  uploadFile,
} from "../api";
import { useI18n, type SupportedLocale } from "../i18n";
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
  Scene,
  SubjectAsset,
  VideoGenerationRequest,
  VideoTaskDetail,
} from "../types";
import { extractVideoPoster } from "../lightbox";
import {
  durationOptionsFromField,
  extractImageUrls,
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
import { CreateTopBar } from "../components/AppTopBar";
import { WorkDetailOverlay } from "../components/WorkDetailOverlay";
import { UploadedImage } from "../components/UploadedImage";

interface Props {
  catalog?: ProviderCatalogResponse;
  loading: boolean;
  tasks: VideoTaskDetail[];
}

const RECENT_PROMPTS_KEY = "scenewords_recent_prompts_v1";
const MAX_RECENT_PROMPTS = 20;
const COMPOSER_PROMPT_MIN_ROWS = 1;
const COMPOSER_PROMPT_MAX_ROWS = 8;
const LAST_SUBMITTED_TASK_KEY = "scenewords_last_submitted_task_v1";
const LAST_SUBMITTED_TASK_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const LAST_GENERATION_KIND_KEY = "scenewords_last_generation_kind_v1";
const HIDDEN_VIDEO_PROVIDER_IDS = new Set(["veo31_rightcodes"]);
const VIDEO_PROVIDER_PRIORITY = ["veo31", "local_comfy"];
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

interface VideoModelVariant {
  familyId: string;
  familyLabel: string;
  provider: ProviderInfo;
  model: ProviderModelInfo;
  operation: ProviderModelOperationInfo | null;
  resolutionKey: "720p" | "4k";
  resolutionLabel: "720P" | "4K";
}

interface VideoModelFamily {
  id: string;
  label: string;
  provider: ProviderInfo;
  variants: VideoModelVariant[];
}

interface AdvancedGroup {
  id: "prompt" | "inputs" | "behavior" | "runtime" | "developer" | "misc";
  fields: ProviderOperationField[];
}

interface ComposerClearSnapshot {
  promptField: ProviderOperationField | null;
  promptValue: string | null;
  versionEditBasePrompt: string | null;
  modificationInstruction: string;
  selectedSubjectIds: string[];
  files: Record<string, File[]>;
  reusedFileIds: Record<string, string[]>;
  imageSourceFiles: File[];
  imageSourceReusedFileIds: string[];
  imageMaskFiles: File[];
  imageMaskReusedFileIds: string[];
}

interface ModelSelectorChoice {
  key: string;
  label: string;
  meta: string;
  providerId: string;
  modelName: string;
  operationId?: string;
  familyId?: string;
}

export function CreatePage(props: Props) {
  const { catalog, loading, tasks } = props;
  const { locale, t } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const settings = useAppSettingsStore();
  const providers = catalog?.providers ?? [];

  const [providerId, setProviderId] = useState("");
  const [modelName, setModelName] = useState("");
  const [operationId, setOperationId] = useState("");
  const [currentGenerationKind, setCurrentGenerationKind] = useState<"image" | "video">(
    () => readLastGenerationKind(),
  );
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
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null);
  const addPopoverRef = useRef<HTMLDivElement | null>(null);
  const settingsPopoverRef = useRef<HTMLDivElement | null>(null);
  const [openPopover, setOpenPopover] = useState<"add" | "settings" | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [composerClearSnapshot, setComposerClearSnapshot] = useState<ComposerClearSnapshot | null>(null);
  const composerClearTimerRef = useRef<number | null>(null);
  const applyingComposerClearRef = useRef(false);
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>([]);
  const [sceneId, setSceneId] = useState("");
  const [newSceneTitle, setNewSceneTitle] = useState("");
  const [generationId, setGenerationId] = useState<string | null>(null);
  const [parentVersionId, setParentVersionId] = useState<string | null>(null);
  const [versionEditBasePrompt, setVersionEditBasePrompt] = useState<string | null>(null);
  const [modificationInstruction, setModificationInstruction] = useState("");
  const inlineFileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const dismissComposerClear = () => {
    if (composerClearTimerRef.current !== null) {
      window.clearTimeout(composerClearTimerRef.current);
      composerClearTimerRef.current = null;
    }
    setComposerClearSnapshot(null);
  };
  useEffect(
    () => () => {
      if (composerClearTimerRef.current !== null) {
        window.clearTimeout(composerClearTimerRef.current);
      }
    },
    [],
  );
  useEffect(() => {
    if (!settings.pendingReuseError) {
      return;
    }
    setHint(t("create.hintReuseFailed", { message: settings.pendingReuseError }));
    settings.setPendingReuseError(null);
  }, [settings.pendingReuseError, settings.setPendingReuseError, t]);
  const subjectsQuery = useQuery({
    queryKey: ["subjects", settings.gatewayToken],
    queryFn: () => fetchSubjects(settings.gatewayToken),
  });
  const scenesQuery = useQuery({
    queryKey: ["scenes", settings.gatewayToken],
    queryFn: () => fetchScenes(settings.gatewayToken),
  });
  const selectedSubjects = useMemo(
    () =>
      (subjectsQuery.data ?? []).filter((subject) =>
        selectedSubjectIds.includes(subject.subject_id),
      ),
    [selectedSubjectIds, subjectsQuery.data],
  );
  const subjectReferenceFileIds = useMemo(
    () =>
      Array.from(
        new Set(
          selectedSubjects.flatMap((subject) =>
            sceneReferences(subject).map((reference) => reference.file_id),
          ),
        ),
      ),
    [selectedSubjects],
  );

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
        (field) =>
          field.target === "provider_options" &&
          (field.key === "quality" || field.key === "resolution_tier"),
      ) ?? null,
    [selectedOperation],
  );
  const backgroundField = useMemo(
    () =>
      selectedOperation?.fields.find(
        (field) => field.target === "provider_options" && field.key === "background",
      ) ?? null,
    [selectedOperation],
  );
  const outputFormatField = useMemo(
    () =>
      selectedOperation?.fields.find(
        (field) => field.target === "provider_options" && field.key === "output_format",
      ) ?? null,
    [selectedOperation],
  );
  const usesOfficialGptImage25Parameters = [
    "gpt-image-2.5",
    "gpt-image-2.5-vip",
    "gpt-image-2.5-flare",
    "gpt-image-2.5-sunburst",
  ].includes(selectedModel?.name ?? "");
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
    if (backgroundField && usesOfficialGptImage25Parameters) {
      excluded.add(fieldKey(backgroundField));
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
    backgroundField,
    durationField,
    orientationField,
    promptField,
    qualityField,
    quickMediaFields,
    resolutionField,
    selectedProvider,
    selectedOperation,
    usesOfficialGptImage25Parameters,
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
  const imageProviders = useMemo(
    () => listVisibleProvidersByKind(providers, "image"),
    [providers],
  );
  const videoProviders = useMemo(
    () => listVisibleProvidersByKind(providers, "video"),
    [providers],
  );
  const providerChoices = useMemo(
    () => listVisibleProvidersByKind(providers, currentGenerationKind),
    [currentGenerationKind, providers],
  );
  const imageModelFamilies = useMemo(
    () =>
      currentGenerationKind === "image" ? collectImageModelFamilies(providerChoices) : [],
    [currentGenerationKind, providerChoices],
  );
  const videoModelFamilies = useMemo(
    () =>
      currentGenerationKind === "video" ? collectTuziVideoModelFamilies(providerChoices) : [],
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
  const currentImageFamilySupportsModeSwitch = useMemo(() => {
    if (!currentImageFamily) {
      return false;
    }
    const hasAsyncVariant = currentImageFamily.variants.some((variant) => variant.asyncEnabled);
    const hasSyncVariant = currentImageFamily.variants.some((variant) => !variant.asyncEnabled);
    return hasAsyncVariant && hasSyncVariant;
  }, [currentImageFamily]);
  const currentVideoFamily = useMemo(() => {
    if (!videoModelFamilies.length) {
      return null;
    }
    return (
      videoModelFamilies.find((family) =>
        family.variants.some((variant) => variant.model.name === modelName),
      ) ?? videoModelFamilies[0]
    );
  }, [modelName, videoModelFamilies]);
  const currentVideoVariant = useMemo(() => {
    if (!currentVideoFamily) {
      return null;
    }
    return (
      currentVideoFamily.variants.find((variant) => variant.model.name === modelName) ??
      currentVideoFamily.variants[0] ??
      null
    );
  }, [currentVideoFamily, modelName]);
  const videoResolutionChoices = useMemo(
    () =>
      currentVideoFamily
        ? Array.from(
            new Map(
              currentVideoFamily.variants.map((variant) => [
                variant.resolutionKey,
                variant.resolutionLabel,
              ]),
            ).values(),
          )
        : [],
    [currentVideoFamily],
  );
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
  const modelChoices = useMemo<ModelSelectorChoice[]>(() => {
    if (currentGenerationKind === "image") {
      return imageModelFamilies.map((family) => ({
        key: family.id,
        label: family.label,
        meta: "",
        providerId: family.provider.id,
        modelName: family.variants[0]?.model.name ?? "",
        familyId: family.id,
      }));
    }

    if (videoModelFamilies.length) {
      const groupedProviderIds = new Set(videoModelFamilies.map((family) => family.provider.id));
      const groupedChoices = videoModelFamilies.map((family) => ({
        key: family.id,
        label: family.label,
        meta: providerChoices.length > 1 ? family.provider.display_name : "",
        providerId: family.provider.id,
        modelName: family.variants[0]?.model.name ?? "",
        operationId: family.variants[0]?.operation?.id,
        familyId: family.id,
      }));
      const fallbackChoices = providerChoices
        .filter((provider) => !groupedProviderIds.has(provider.id))
        .flatMap((provider) =>
          provider.models.flatMap((model) =>
            model.operations.map((operation) => {
              const metaParts: string[] = [];
              if (providerChoices.length > 1) {
                metaParts.push(provider.display_name);
              }
              if (model.operations.length > 1) {
                metaParts.push(operation.display_name);
              }
              return {
                key: `${provider.id}::${model.name}::${operation.id}`,
                label: model.display_name,
                meta: metaParts.join(" · "),
                providerId: provider.id,
                modelName: model.name,
                operationId: operation.id,
              };
            }),
          ),
        );
      return [...groupedChoices, ...fallbackChoices];
    }

    return providerChoices.flatMap((provider) =>
      provider.models.flatMap((model) =>
        model.operations.map((operation) => {
          const metaParts: string[] = [];
          if (providerChoices.length > 1) {
            metaParts.push(provider.display_name);
          }
          if (model.operations.length > 1) {
            metaParts.push(operation.display_name);
          }
          return {
            key: `${provider.id}::${model.name}::${operation.id}`,
            label: model.display_name,
            meta: metaParts.join(" · "),
            providerId: provider.id,
            modelName: model.name,
            operationId: operation.id,
          };
        }),
      ),
    );
  }, [currentGenerationKind, imageModelFamilies, providerChoices]);
  useLayoutEffect(() => {
    if (!openPopover) {
      return;
    }

    const anchor = openPopover === "add" ? addButtonRef.current : settingsButtonRef.current;
    const popover = openPopover === "add" ? addPopoverRef.current : settingsPopoverRef.current;
    if (!anchor || !popover) {
      return;
    }

    const positionPopover = () => {
      const anchorRect = anchor.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight;
      const margin = 16;
      const gap = 10;
      const width = Math.min(popover.offsetWidth, viewportWidth - margin * 2);
      const desiredHeight = Math.min(popover.scrollHeight, 460);
      const spaceAbove = Math.max(0, anchorRect.top - gap - margin);
      const spaceBelow = Math.max(0, viewportHeight - anchorRect.bottom - gap - margin);
      const openAbove = desiredHeight <= spaceAbove || spaceAbove >= spaceBelow;
      const availableHeight = openAbove ? spaceAbove : spaceBelow;
      const maxHeight = Math.max(80, Math.min(460, availableHeight));
      const height = Math.min(desiredHeight, maxHeight);
      const preferredLeft =
        openPopover === "add" ? anchorRect.left : anchorRect.right - width;
      const left = Math.max(margin, Math.min(preferredLeft, viewportWidth - width - margin));
      const top = openAbove
        ? anchorRect.top - gap - height
        : anchorRect.bottom + gap;

      popover.style.left = `${left}px`;
      popover.style.top = `${Math.max(margin, top)}px`;
      popover.style.maxHeight = `${maxHeight}px`;
    };

    positionPopover();
    window.addEventListener("resize", positionPopover);
    window.addEventListener("scroll", positionPopover, true);
    const resizeObserver = new ResizeObserver(positionPopover);
    resizeObserver.observe(anchor);
    resizeObserver.observe(popover);

    return () => {
      window.removeEventListener("resize", positionPopover);
      window.removeEventListener("scroll", positionPopover, true);
      resizeObserver.disconnect();
    };
  }, [modelChoices.length, openPopover, subjectsQuery.data?.length]);
  const activeModelChoiceKey = useMemo(() => {
    if (currentGenerationKind === "image") {
      return currentImageFamily?.id ?? "";
    }
    if (currentVideoFamily) {
      return currentVideoFamily.id;
    }
    return `${providerId}::${modelName}::${selectedOperation?.id ?? operationId}`;
  }, [
    currentGenerationKind,
    currentImageFamily?.id,
    currentVideoFamily,
    modelName,
    operationId,
    providerId,
    selectedOperation?.id,
  ]);
  const supportsInlineImageInput = Boolean(
    selectedOperation?.fields.some(
      (field) =>
        field.target === "provider_options" &&
        (field.key === "image" || field.key === "images") &&
        field.input_type !== "file" &&
        field.input_type !== "file_list",
    ),
  );
  const activeSubjectReferenceFileIds =
    currentGenerationKind === "image" && (currentImageVariant?.editOperation || supportsInlineImageInput)
      ? subjectReferenceFileIds
      : [];
  const hasImageSourceAttachments =
    imageSourceFiles.length > 0 ||
    imageSourceReusedFileIds.length > 0 ||
    activeSubjectReferenceFileIds.length > 0;
  const currentImageResolutionLabel = currentImageVariant?.resolutionLabel ?? "1K";
  const currentImageAsyncEnabled = currentImageVariant?.asyncEnabled ?? false;
  const resolutionValue = resolutionField ? values[fieldKey(resolutionField)] ?? "" : "";
  const orientationValue = orientationField ? values[fieldKey(orientationField)] ?? "" : "";
  const qualityValue = qualityField ? values[fieldKey(qualityField)] ?? "" : "";
  const backgroundValue = backgroundField ? values[fieldKey(backgroundField)] ?? "" : "";
  const outputFormatValue = outputFormatField ? values[fieldKey(outputFormatField)] ?? "" : "";
  const durationValue = durationField ? values[fieldKey(durationField)] ?? "" : "";
  useEffect(() => {
    if (backgroundValue !== "transparent" || outputFormatValue !== "jpeg" || !outputFormatField) {
      return;
    }
    const key = fieldKey(outputFormatField);
    setValues((current) => ({ ...current, [key]: "png" }));
  }, [backgroundValue, outputFormatField, outputFormatValue]);
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
  const hideVideoRatioSelector = useMemo(
    () =>
      currentGenerationKind === "video" &&
      selectedProvider?.type === "tuzi_veo" &&
      orientationChoices.length > 0,
    [currentGenerationKind, orientationChoices.length, selectedProvider?.type],
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
      [fieldKey(sharedImageSourceField)]: Array.from(
        new Set([...imageSourceReusedFileIds, ...activeSubjectReferenceFileIds]),
      ),
      [fieldKey(sharedImageMaskField)]: imageMaskReusedFileIds,
    };
  }, [
    currentGenerationKind,
    imageMaskReusedFileIds,
    imageSourceReusedFileIds,
    reusedFileIds,
    sharedImageMaskField,
    sharedImageSourceField,
    activeSubjectReferenceFileIds,
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
  const modelChipLabel = useMemo(() => {
    const activeChoice = modelChoices.find((choice) => choice.key === activeModelChoiceKey) ?? null;
    if (activeChoice) {
      return activeChoice.label;
    }
    return t("create.model");
  }, [activeModelChoiceKey, modelChoices, t]);
  const formatChipLabel = useMemo(() => {
    const parts: string[] = [];
    if (!hideVideoRatioSelector && currentRatioDisplay && currentRatioDisplay !== "-") {
      parts.push(currentRatioDisplay);
    }
    if (currentGenerationKind === "image") {
      if (currentImageResolutionLabel) {
        parts.push(currentImageResolutionLabel);
      }
    } else if (selectedProvider?.type === "tuzi_veo" && currentVideoVariant) {
      parts.push(currentVideoVariant.resolutionLabel);
    } else if (currentSizeDisplay && currentSizeDisplay !== "-") {
      parts.push(currentSizeDisplay);
    }
    return parts.join(" · ") || t("create.quickFormat");
  }, [
    currentGenerationKind,
    currentImageResolutionLabel,
    currentRatioDisplay,
    currentSizeDisplay,
    currentVideoVariant,
    hideVideoRatioSelector,
    selectedProvider?.type,
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
    if (
      currentGenerationKind !== "video" ||
      selectedProvider?.type !== "tuzi_veo" ||
      !currentVideoVariant ||
      !resolutionField
    ) {
      return;
    }
    const expectedSize = currentVideoVariant.resolutionLabel;
    if (currentSizeDisplay === expectedSize) {
      return;
    }
    const nextResolution = pickResolutionValue(resolutionField, resolutionValue, { size: expectedSize });
    if (!nextResolution || nextResolution === resolutionValue) {
      return;
    }
    onFieldChanged(resolutionField, nextResolution);
  }, [
    currentGenerationKind,
    currentSizeDisplay,
    currentVideoVariant,
    resolutionField,
    resolutionValue,
    selectedProvider?.type,
  ]);

  useEffect(() => {
    persistLastSubmittedTaskId(lastSubmittedTaskId);
  }, [lastSubmittedTaskId]);

  useEffect(() => {
    persistLastGenerationKind(currentGenerationKind);
  }, [currentGenerationKind]);

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
    const restoredSession = restoreSession(settings.restoreLastSession, currentGenerationKind);
    if (restoredSession) {
      const restoredProvider = providers.find((provider) => provider.id === restoredSession.provider);
      const restoredProviderMatchesKind = restoredProvider
        ? currentGenerationKind === "image"
          ? isImageProviderType(restoredProvider.type)
          : !isImageProviderType(restoredProvider.type)
        : false;
      const restoredModel =
        restoredProvider?.models.find((model) => model.name === restoredSession.model) ?? null;
      const restoredOperation =
        restoredModel?.operations.find((operation) => operation.id === restoredSession.operation) ??
        null;
      if (restoredProvider && restoredProviderMatchesKind && restoredModel && restoredOperation) {
        setProviderId(restoredProvider.id);
        setModelName(restoredModel.name);
        setOperationId(restoredOperation.id);
        return;
      }
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
    settings.restoreLastSession,
  ]);

  useEffect(() => {
    const pending = settings.pendingReuseDraft;
    if (!pending || !providers.length) {
      return;
    }
    const pendingProvider = providers.find((provider) => provider.id === pending.provider) ?? null;
    if (pendingProvider) {
      const pendingKind = isImageProviderType(pendingProvider.type) ? "image" : "video";
      if (pendingKind !== currentGenerationKind) {
        setCurrentGenerationKind(pendingKind);
      }
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
    setSceneId(pending.sceneId ?? "");
    setGenerationId(pending.generationId);
    setParentVersionId(pending.parentVersionId);
    setSelectedSubjectIds(pending.subjectIds ?? []);
    setVersionEditBasePrompt(pending.editBaseFileId ? pending.prompt : null);
    setModificationInstruction(pending.modificationInstruction ?? "");
  }, [
    currentGenerationKind,
    modelName,
    operationId,
    providerId,
    providers,
    settings.pendingReuseDraft,
  ]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const subjectId = params.get("subjectId")?.trim() ?? "";
    if (!subjectId) {
      return;
    }
    const subject = subjectsQuery.data?.find((item) => item.subject_id === subjectId);
    if (!subject) {
      return;
    }
    setSelectedSubjectIds([subjectId]);
    if (currentGenerationKind !== "image") {
      setCurrentGenerationKind("image");
      return;
    }
  }, [
    currentGenerationKind,
    location.search,
    subjectsQuery.data,
  ]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const subjectId = params.get("useSubject")?.trim() ?? "";
    if (!subjectId || !subjectsQuery.data?.some((item) => item.subject_id === subjectId)) {
      return;
    }
    setSelectedSubjectIds((ids) => (ids.includes(subjectId) ? ids : [...ids, subjectId]));
    navigate("/create", { replace: true });
  }, [location.search, navigate, subjectsQuery.data]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const launchSceneId = params.get("sceneId")?.trim() ?? "";
    if (!launchSceneId || !scenesQuery.data?.some((scene) => scene.scene_id === launchSceneId)) {
      return;
    }
    setSceneId(launchSceneId);
    setGenerationId(null);
    setParentVersionId(null);
    setVersionEditBasePrompt(null);
    setModificationInstruction("");
  }, [location.search, scenesQuery.data]);

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

    const session = restoreSession(settings.restoreLastSession, currentGenerationKind);
    if (
      session &&
      session.provider === providerId &&
      session.model === modelName &&
      session.operation === selectedOperation.id
    ) {
      Object.assign(hydrated, session.values);
    }

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

    const launchParams = new URLSearchParams(location.search);
    const launchSubjectId = launchParams.get("subjectId")?.trim() ?? "";
    const launchSubject = subjectsQuery.data?.find(
      (subject) => subject.subject_id === launchSubjectId,
    );
    if (launchSubject && promptField && currentGenerationKind === "image") {
      hydrated[fieldKey(promptField)] = buildSubjectReferencePrompt(
        launchSubject,
        launchParams.get("subjectRole")?.trim() || "anchor",
      );
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
    for (const field of selectedOperation.fields) {
      if (field.input_type !== "select" || !field.options.length) {
        continue;
      }
      const key = fieldKey(field);
      const value = hydrated[key];
      if (!value || field.options.some((option) => option.value === value)) {
        continue;
      }
      const defaultValue = field.default == null ? "" : valueToStoredString(field.default);
      if (defaultValue && field.options.some((option) => option.value === defaultValue)) {
        hydrated[key] = defaultValue;
      } else {
        delete hydrated[key];
      }
    }
    applySettingDefaults(hydrated, selectedOperation, settings, providerId);

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
    location.search,
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
    subjectsQuery.data,
  ]);

  useEffect(() => {
    if (!settings.savePromptHistory) {
      localStorage.removeItem(RECENT_PROMPTS_KEY);
      return;
    }
    pruneRecentPrompts(settings.historyRetentionDays);
  }, [settings.historyRetentionDays, settings.savePromptHistory]);

  useEffect(() => {
    if (!selectedProvider || !selectedModel || !selectedOperation) {
      return;
    }
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
    if (isImageProviderType(selectedProvider.type)) {
      nextSettings.defaultImageProvider = providerId;
    } else {
      nextSettings.defaultVideoProvider = providerId;
    }
    const currentDefaults = settings.providerDefaults[providerId];
    const providerUnchanged =
      nextSettings.defaultImageProvider === undefined ||
      nextSettings.defaultImageProvider === settings.defaultImageProvider;
    const videoProviderUnchanged =
      nextSettings.defaultVideoProvider === undefined ||
      nextSettings.defaultVideoProvider === settings.defaultVideoProvider;
    const defaultsUnchanged =
      currentDefaults?.defaultRatio === nextProviderDefaults.defaultRatio &&
      currentDefaults?.defaultDurationSec === nextProviderDefaults.defaultDurationSec &&
      currentDefaults?.defaultQuality === nextProviderDefaults.defaultQuality &&
      currentDefaults?.defaultNegativePrompt === nextProviderDefaults.defaultNegativePrompt;
    if (providerUnchanged && videoProviderUnchanged && defaultsUnchanged) {
      saveSession(currentGenerationKind, {
        provider: providerId,
        model: modelName,
        operation: selectedOperation.id,
        values,
      });
      return;
    }
    settings.setSettings(nextSettings);
    saveSession(currentGenerationKind, {
      provider: providerId,
      model: modelName,
      operation: selectedOperation.id,
      values,
    });
  }, [
    modelName,
    operationId,
    providerId,
    selectedModel,
    selectedOperation,
    selectedProvider,
    settings,
    values,
  ]);

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!selectedOperation) {
        throw new Error(t("create.errorNoOperation"));
      }
      let resolvedSceneId = sceneId || null;
      if (sceneId === "__new__") {
        const title = newSceneTitle.trim();
        if (!title) {
          throw new Error(locale === "zh-CN" ? "请输入场景名称。" : "Enter a scene name.");
        }
        const scene = await createScene({ title, description: "" }, settings.gatewayToken);
        resolvedSceneId = scene.scene_id;
        setSceneId(scene.scene_id);
        setNewSceneTitle("");
        await queryClient.invalidateQueries({ queryKey: ["scenes", settings.gatewayToken] });
      }
      const payload: VideoGenerationRequest = {
        provider: providerId,
        model: modelName,
        operation: selectedOperation.id,
        scene_id: resolvedSceneId,
        generation_id: resolvedSceneId ? generationId : null,
        parent_version_id: resolvedSceneId ? parentVersionId : null,
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
                  sourceReusedFileIds: Array.from(
                    new Set([...imageSourceReusedFileIds, ...activeSubjectReferenceFileIds]),
                  ),
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
      const sourceFileIds = Array.from(
        new Set([...imageSourceReusedFileIds, ...activeSubjectReferenceFileIds]),
      );
      const operationHasFileSource = selectedOperation.fields.some(
        (field) =>
          (field.key === "image_file_ids" || field.key === "input_reference_file_ids") &&
          (field.input_type === "file" || field.input_type === "file_list"),
      );
      if (
        currentGenerationKind === "image" &&
        !operationHasFileSource &&
        (imageSourceFiles.length > 0 || sourceFileIds.length > 0)
      ) {
        const inlineImageField = selectedOperation.fields.find(
          (field) =>
            field.target === "provider_options" &&
            (field.key === "image" || field.key === "images") &&
            field.input_type !== "file" &&
            field.input_type !== "file_list",
        );
        if (!inlineImageField) {
          if (versionEditBasePrompt !== null) {
            throw new Error(
              locale === "zh-CN"
                ? "当前模型不支持带入上一版图片，请切换到支持图片编辑或参考图的模型。"
                : "This model cannot use the previous image. Choose a model with edit or image-reference support.",
            );
          }
        } else {
          const localDataUrls = await Promise.all(imageSourceFiles.map(fileToDataUrl));
          const reusedDataUrls = await Promise.all(
            sourceFileIds.map(async (fileId) => {
              const { blob } = await fetchUploadedFileBinary(fileId, settings.gatewayToken);
              return blobToDataUrl(blob);
            }),
          );
          const imageInputs = [...localDataUrls, ...reusedDataUrls];
          payload.provider_options[inlineImageField.key] =
            imageInputs.length === 1 ? imageInputs[0] : imageInputs;
        }
      }
      if (versionEditBasePrompt !== null) {
        const instruction = modificationInstruction.trim();
        if (!instruction) {
          throw new Error(
            locale === "zh-CN" ? "请输入这次要修改的内容。" : "Describe what to change in this version.",
          );
        }
        payload.prompt = buildVersionEditPrompt(versionEditBasePrompt, instruction);
      }
      if (selectedSubjects.length > 0) {
        payload.subject_bindings = selectedSubjects.map((subject) => ({
          subject_id: subject.subject_id,
          kind: subject.kind,
          name: subject.name,
          description: subject.description,
          fixed_traits: subject.fixed_traits,
          reference_file_ids: activeSubjectReferenceFileIds.length
            ? sceneReferences(subject).map((reference) => reference.file_id)
            : [],
        }));
        if (versionEditBasePrompt === null) {
          payload.prompt = buildPromptWithSubjects(payload.prompt ?? "", selectedSubjects);
        }
      }
      return createVideoTask(payload, settings.gatewayToken, selectedProvider?.type);
    },
    onSuccess: async (response) => {
      if (response.scene_id) {
        setSceneId(response.scene_id);
        setGenerationId(response.generation_id);
        setParentVersionId(response.task_id);
        await queryClient.invalidateQueries({ queryKey: ["scenes", settings.gatewayToken] });
      }
      setLastSubmittedTaskId(response.task_id);
      setHint(t("create.hintCreated", { taskId: response.task_id.slice(0, 8) }));
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
      await queryClient.invalidateQueries({
        queryKey: ["tasks", settings.gatewayToken],
      });
    },
    onError: (error: Error) => {
      setHint(t("create.hintSubmitFailed", { message: error.message }));
    },
  });

  const onFileFieldChanged = (field: ProviderOperationField, nextFiles: File[]) => {
    if (!applyingComposerClearRef.current) {
      dismissComposerClear();
    }
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
    if (!applyingComposerClearRef.current) {
      dismissComposerClear();
    }
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
    if (
      !applyingComposerClearRef.current &&
      promptField &&
      fieldKey(field) === fieldKey(promptField)
    ) {
      dismissComposerClear();
    }
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
    const style = window.getComputedStyle(el);
    const lineHeight = Number.parseFloat(style.lineHeight) || 24;
    const paddingTop = Number.parseFloat(style.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(style.paddingBottom) || 0;
    const minHeight = lineHeight * COMPOSER_PROMPT_MIN_ROWS + paddingTop + paddingBottom;
    const maxHeight = lineHeight * COMPOSER_PROMPT_MAX_ROWS + paddingTop + paddingBottom;
    const isFocused = document.activeElement === el;
    const isCaretAtEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;

    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, minHeight), maxHeight)}px`;
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";

    if (el.scrollHeight > maxHeight && (!isFocused || isCaretAtEnd)) {
      el.scrollTop = el.scrollHeight;
    }
  };
  const removeVersionEditBasePrompt = () => {
    if (!promptField) {
      return;
    }

    onFieldChanged(promptField, modificationInstruction);
    setVersionEditBasePrompt(null);
    setModificationInstruction("");
    requestAnimationFrame(autoResizeTextarea);
  };
  const clearComposer = () => {
    const snapshot: ComposerClearSnapshot = {
      promptField,
      promptValue: promptField ? promptValue : null,
      versionEditBasePrompt,
      modificationInstruction,
      selectedSubjectIds,
      files,
      reusedFileIds,
      imageSourceFiles,
      imageSourceReusedFileIds,
      imageMaskFiles,
      imageMaskReusedFileIds,
    };

    dismissComposerClear();
    applyingComposerClearRef.current = true;
    try {
      setHint("");
      if (promptField) {
        onFieldChanged(promptField, "");
      }
      setVersionEditBasePrompt(null);
      setModificationInstruction("");
      for (const field of composerMediaFields) {
        onFileFieldChanged(field, []);
        onReusedFileIdsChanged(field, []);
      }
      setSelectedSubjectIds([]);
      setOpenPopover(null);
    } finally {
      applyingComposerClearRef.current = false;
    }

    setComposerClearSnapshot(snapshot);
    composerClearTimerRef.current = window.setTimeout(() => {
      composerClearTimerRef.current = null;
      setComposerClearSnapshot(null);
    }, 5000);
    requestAnimationFrame(autoResizeTextarea);
  };
  const undoComposerClear = () => {
    const snapshot = composerClearSnapshot;
    if (!snapshot) {
      return;
    }

    dismissComposerClear();
    applyingComposerClearRef.current = true;
    try {
      if (snapshot.promptField && snapshot.promptValue !== null) {
        onFieldChanged(snapshot.promptField, snapshot.promptValue);
      }
      setVersionEditBasePrompt(snapshot.versionEditBasePrompt);
      setModificationInstruction(snapshot.modificationInstruction);
      setSelectedSubjectIds(snapshot.selectedSubjectIds);
      setFiles(snapshot.files);
      setReusedFileIds(snapshot.reusedFileIds);
      setImageSourceFiles(snapshot.imageSourceFiles);
      setImageSourceReusedFileIds(snapshot.imageSourceReusedFileIds);
      setImageMaskFiles(snapshot.imageMaskFiles);
      setImageMaskReusedFileIds(snapshot.imageMaskReusedFileIds);
    } finally {
      applyingComposerClearRef.current = false;
    }
    requestAnimationFrame(autoResizeTextarea);
  };

  // Restore textarea height when the prompt changes on mount / route return.
  useEffect(() => {
    // Defer to next frame so the DOM has rendered the value.
    requestAnimationFrame(autoResizeTextarea);
  }, [modificationInstruction, promptValue]);
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
    const current = uiFiles[key] ?? [];
    const next = isMulti ? [...current, ...picked] : [picked[0]];
    onFileFieldChanged(primaryFileField, next);
    event.currentTarget.value = "";
  };
  const onGenerationKindChanged = (nextKind: "image" | "video") => {
    if (nextKind === currentGenerationKind) {
      return;
    }
    dismissComposerClear();
    setCurrentGenerationKind(nextKind);
    const restoredSession = restoreSession(settings.restoreLastSession, nextKind);
    if (restoredSession) {
      const restoredProvider = providers.find((provider) => provider.id === restoredSession.provider);
      const restoredProviderMatchesKind = restoredProvider
        ? nextKind === "image"
          ? isImageProviderType(restoredProvider.type)
          : !isImageProviderType(restoredProvider.type)
        : false;
      const restoredModel =
        restoredProvider?.models.find((model) => model.name === restoredSession.model) ?? null;
      const restoredOperation =
        restoredModel?.operations.find((operation) => operation.id === restoredSession.operation) ??
        null;
      if (restoredProvider && restoredProviderMatchesKind && restoredModel && restoredOperation) {
        setProviderId(restoredProvider.id);
        setModelName(restoredModel.name);
        setOperationId(restoredOperation.id);
        return;
      }
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
    dismissComposerClear();
    if (providerId !== nextVariant.provider.id) {
      setProviderId(nextVariant.provider.id);
    }
    if (modelName !== nextVariant.model.name) {
      setModelName(nextVariant.model.name);
    }
  };
  const selectVideoVariant = (
    familyId: string,
    options?: { resolutionLabel?: string },
  ) => {
    const family = videoModelFamilies.find((item) => item.id === familyId);
    if (!family) {
      return;
    }
    const nextVariant = pickVideoFamilyVariant(family, {
      resolutionKey: videoResolutionLabelToKey(
        options?.resolutionLabel ?? currentVideoVariant?.resolutionLabel ?? "720P",
      ),
    });
    if (!nextVariant) {
      return;
    }
    dismissComposerClear();
    if (providerId !== nextVariant.provider.id) {
      setProviderId(nextVariant.provider.id);
    }
    if (modelName !== nextVariant.model.name) {
      setModelName(nextVariant.model.name);
    }
    if (nextVariant.operation && operationId !== nextVariant.operation.id) {
      setOperationId(nextVariant.operation.id);
    }
    if (resolutionField) {
      const targetSize = nextVariant.resolutionLabel;
      const nextResolution = pickResolutionValue(resolutionField, resolutionValue, { size: targetSize });
      if (nextResolution && nextResolution !== resolutionValue) {
        onFieldChanged(resolutionField, nextResolution);
      }
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
    if (currentGenerationKind === "video" && selectedProvider?.type === "tuzi_veo" && currentVideoFamily) {
      selectVideoVariant(currentVideoFamily.id, { resolutionLabel: nextSize });
      return;
    }
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
  const orderedScenes = [...(scenesQuery.data ?? [])].sort(
    (left, right) => Date.parse(left.created_at) - Date.parse(right.created_at),
  );
  const selectedScene = orderedScenes.find((scene) => scene.scene_id === sceneId) ?? null;
  const sceneOrdinal =
    sceneId === "__new__"
      ? orderedScenes.length + 1
      : selectedScene
        ? orderedScenes.indexOf(selectedScene) + 1
        : 0;
  const crumbTitle =
    sceneId === "__new__"
      ? newSceneTitle.trim() || t("create.scene.untitled")
      : selectedScene?.title ?? t("create.scene.standalone");
  const sceneStatusNote = !sceneId
    ? ""
    : generationId
      ? parentVersionId
        ? t("create.scene.editBase")
        : t("create.scene.nextVersion")
      : parentVersionId
        ? t("create.scene.branching")
        : t("create.scene.firstSubmit");
  const selectScene = (nextSceneId: string) => {
    setSceneId(nextSceneId);
    setGenerationId(null);
    setParentVersionId(null);
    setVersionEditBasePrompt(null);
    setModificationInstruction("");
  };
  const topBar = (
    <CreateTopBar
      inProgressCount={inProgressCount}
      onBack={() =>
        navigate(selectedScene ? `/scenes/${selectedScene.scene_id}` : "/scenes")
      }
      breadcrumb={
        <ScenePicker
          scenes={orderedScenes}
          sceneId={sceneId}
          newSceneTitle={newSceneTitle}
          crumbTitle={crumbTitle}
          sceneOrdinal={sceneOrdinal}
          statusNote={sceneStatusNote}
          onSelect={selectScene}
          onNewSceneTitleChange={setNewSceneTitle}
          onManage={() => navigate("/scenes")}
        />
      }
    />
  );

  const isPreparingReuse = settings.pendingReuseLoading || Boolean(settings.pendingReuseDraft);
  if (loading || isPreparingReuse) {
    return (
      <div>
        {topBar}
        <div className="create-stage">
          <div className="composer">
            {isPreparingReuse ? (
              <div
                className="flex min-h-24 items-center justify-center gap-2 rounded-[var(--radius-lg)] border border-[var(--c-border)] bg-[var(--c-surface)] text-sm text-[var(--c-text-secondary)] shadow-[var(--shadow-composer)]"
                role="status"
                aria-live="polite"
              >
                <CircleNotch size={16} className="animate-spin" />
                {t("create.preparingReuse")}
              </div>
            ) : (
              <div className="skeleton h-[90px] w-full rounded-[var(--radius-lg)]" />
            )}
          </div>
        </div>
      </div>
    );
  }
  if (!selectedProvider || !selectedModel || !selectedOperation) {
    return (
      <div>
        {topBar}
        <div className="create-stage">
          <p className="text-sm text-[var(--c-text-secondary)]">{t("create.noAvailable")}</p>
        </div>
      </div>
    );
  }

  const hasQuickParams = Boolean(
    (!usesOfficialGptImage25Parameters &&
      ((resolutionField && (ratioChoices.length > 0 || resolutionValue)) || hasQuickSize)) ||
    (orientationField && orientationChoices.length > 0) ||
    (durationField && durationChoices.length > 0),
  );
  const subjectReferenceIdSet = new Set(activeSubjectReferenceFileIds);
  const attachmentPreviews = inlineFilePreviews.filter(
    (item) =>
      !(
        item.source === "reused" &&
        item.fieldKey === fieldKey(sharedImageSourceField) &&
        item.fileId &&
        subjectReferenceIdSet.has(item.fileId)
      ),
  );
  const subjectReferencesSupported =
    currentGenerationKind === "image" &&
    Boolean(currentImageVariant?.editOperation || supportsInlineImageInput);
  const hasComposerContent = Boolean(
    (versionEditBasePrompt !== null ? modificationInstruction : promptValue) ||
      selectedSubjectIds.length > 0 ||
      inlineFilePreviews.length > 0,
  );
  const toggleSubject = (subjectId: string) => {
    dismissComposerClear();
    setSelectedSubjectIds((ids) =>
      ids.includes(subjectId) ? ids.filter((id) => id !== subjectId) : [...ids, subjectId],
    );
  };
  const recentStrip = recentTasks.slice(0, 6);

  return (
    <div>
      {topBar}
      <div className="create-stage">
      <form
        ref={formRef}
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          void submitMutation.mutateAsync();
        }}
      >
        {openPopover ? (
          <div className="popover-backdrop" onClick={() => setOpenPopover(null)} />
        ) : null}

        <div className="composer-card">
          {hasComposerContent ? (
            <button
              type="button"
              className="composer-clear"
              aria-label={t("common.clear")}
              onClick={clearComposer}
            >
              {t("common.clear")}
            </button>
          ) : null}
          {primaryFileField ? (
            <input
              ref={inlineFileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple={primaryFileField.input_type === "file_list"}
              className="hidden"
              onChange={handleInlineFilePick}
            />
          ) : null}

          <div className="composer-body">
            {selectedSubjects.length > 0 || attachmentPreviews.length > 0 ? (
              <div className={`composer-refs ${hasComposerContent ? "composer-refs-clearable" : ""}`}>
                {selectedSubjects.map((subject) => (
                  <SubjectRefChip
                    key={subject.subject_id}
                    subject={subject}
                    token={settings.gatewayToken}
                    removeLabel={t("create.removeRef")}
                    onRemove={() => toggleSubject(subject.subject_id)}
                  />
                ))}
                {attachmentPreviews.map((item) => (
                  <InlineThumb
                    key={`${item.fieldKey}_${item.source}_${item.index}`}
                    item={item}
                    removeLabel={t("create.removeRef")}
                    onRemove={() => removeInlineFile(item)}
                  />
                ))}
              </div>
            ) : null}

            {promptField && versionEditBasePrompt !== null ? (
              <>
                <div className="composer-base-prompt">
                  <div className="composer-base-prompt__content">
                    <span className="text-[var(--c-text-tertiary)]">
                      {locale === "zh-CN" ? "原始场景（保留）：" : "Original scene (preserved): "}
                    </span>
                    <span className="line-clamp-2 whitespace-pre-wrap">{versionEditBasePrompt}</span>
                  </div>
                  <button
                    type="button"
                    className="composer-base-prompt-remove"
                    aria-label={t("create.removeRef")}
                    title={t("create.removeRef")}
                    onClick={removeVersionEditBasePrompt}
                  >
                    <X size={12} weight="regular" />
                  </button>
                </div>
                <textarea
                  ref={textareaRef}
                  className={`composer-textarea ${hasComposerContent ? "composer-textarea-clearable" : ""}`}
                  rows={COMPOSER_PROMPT_MIN_ROWS}
                  value={modificationInstruction}
                  placeholder={locale === "zh-CN" ? "只描述这次要改什么，例如：把外套改成琥珀色，人物和构图保持不变" : "Describe only the change, e.g. Make the coat amber; keep the person and composition unchanged"}
                  onChange={(event) => {
                    dismissComposerClear();
                    setModificationInstruction(event.target.value);
                    autoResizeTextarea();
                  }}
                  onInput={autoResizeTextarea}
                />
              </>
            ) : promptField ? (
              <textarea
                ref={textareaRef}
                className={`composer-textarea ${hasComposerContent ? "composer-textarea-clearable" : ""}`}
                rows={COMPOSER_PROMPT_MIN_ROWS}
                value={promptValue}
                placeholder={promptPlaceholder}
                aria-label={promptField.label}
                onChange={(e) => {
                  onFieldChanged(promptField, e.target.value);
                  autoResizeTextarea();
                }}
                onInput={autoResizeTextarea}
              />
            ) : (
              <div className="py-1 text-[13px] text-[var(--c-text-tertiary)]">
                {t("create.promptNotSupported")}
              </div>
            )}
          </div>

          <div className="composer-side">
            <button
              ref={addButtonRef}
              type="button"
              className={`composer-add ${openPopover === "add" ? "composer-add-open" : ""}`}
              onClick={() => setOpenPopover(openPopover === "add" ? null : "add")}
              aria-label={t("create.add.title")}
              aria-expanded={openPopover === "add"}
            >
              <Plus size={18} weight="light" />
            </button>
            <button
              ref={settingsButtonRef}
              type="button"
              className={`composer-mode ${openPopover === "settings" ? "composer-mode-open" : ""}`}
              onClick={() => setOpenPopover(openPopover === "settings" ? null : "settings")}
              aria-expanded={openPopover === "settings"}
              title={`${currentGenerationKind === "image" ? t("create.quickImage") : t("create.quickVideo")} · ${modelChipLabel} · ${formatChipLabel}`}
            >
              <span className="truncate">{modelChipLabel}</span>
              <CaretDown size={11} className="shrink-0" />
            </button>
            <button
              type="submit"
              className="composer-submit"
              disabled={submitMutation.isPending}
              aria-label={submitMutation.isPending ? t("create.submitting") : submitLabel}
              title={`${submitMutation.isPending ? t("create.submitting") : submitLabel} (${keyboardShortcutLabel})`}
            >
              {submitMutation.isPending ? (
                <CircleNotch size={16} className="animate-spin" />
              ) : (
                <ArrowRight size={17} weight="regular" />
              )}
            </button>
          </div>
        </div>

        {openPopover === "add"
          ? createPortal(
          <div
            ref={addPopoverRef}
            className="composer-popover"
            role="dialog"
            aria-label={t("create.add.title")}
          >
            {primaryFileField ? (
              <div className="composer-popover-section">
                <button
                  type="button"
                  className="composer-menu-item"
                  onClick={() => {
                    inlineFileInputRef.current?.click();
                    setOpenPopover(null);
                  }}
                >
                  <span className="composer-menu-item__content">
                    <UploadSimple size={15} />
                    <span>{t("create.add.upload")}</span>
                  </span>
                  <span className="composer-menu-item__meta">JPG · PNG · WEBP</span>
                </button>
              </div>
            ) : null}
            <div className="composer-popover-section">
              <p className="composer-popover-heading">
                <span>{t("create.add.subjects")}</span>
                <button
                  type="button"
                  className="border-0 bg-transparent p-0 text-[11px] text-[var(--c-accent-text)]"
                  onClick={() => navigate("/subjects")}
                >
                  {t("create.add.manageSubjects")}
                </button>
              </p>
              {(subjectsQuery.data?.length ?? 0) > 0 ? (
                <div className="composer-subject-grid">
                  {subjectsQuery.data?.map((subject) => {
                    const selected = selectedSubjectIds.includes(subject.subject_id);
                    const primary = subject.references.find((item) => item.is_primary) ?? subject.references[0];
                    return (
                      <button
                        key={subject.subject_id}
                        type="button"
                        className="composer-subject"
                        aria-pressed={selected}
                        onClick={() => toggleSubject(subject.subject_id)}
                        title={`${subject.name} · ${subjectKindLabel(subject, locale === "zh-CN")}`}
                      >
                        <span className={`composer-subject-thumb media-ring ${selected ? "media-ring-active" : ""}`}>
                          {primary ? (
                            <UploadedImage
                              fileId={primary.file_id}
                              token={settings.gatewayToken}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <span className="flex h-full w-full items-center justify-center text-[var(--c-text-tertiary)]">
                              <Shapes size={18} weight="light" />
                            </span>
                          )}
                          {selected ? (
                            <span className="asset-tile-check asset-tile-check-on !left-1 !top-1 !h-4 !w-4">
                              <Check size={9} weight="bold" />
                            </span>
                          ) : null}
                        </span>
                        <span className="composer-subject-name">{subject.name}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <button
                  type="button"
                  className="w-full rounded-[var(--radius-sm)] border border-dashed border-[var(--c-border-strong)] bg-transparent px-4 py-5 text-xs text-[var(--c-text-secondary)]"
                  onClick={() => navigate("/subjects")}
                >
                  {t("create.add.emptySubjects")}
                </button>
              )}
              <p className="m-0 mt-2.5 px-1 text-[11px] leading-5 text-[var(--c-text-tertiary)]">
                {subjectReferencesSupported
                  ? t("create.add.subjectsWithRefs")
                  : t("create.add.subjectsTextOnly")}
              </p>
            </div>
          </div>,
          document.body,
          )
          : null}

        {openPopover === "settings"
          ? createPortal(
          <div
            ref={settingsPopoverRef}
            className="composer-popover composer-popover-end"
            role="dialog"
            aria-label={t("create.quickType")}
          >
            <div className="composer-popover-section">
              <p className="composer-popover-heading">{t("create.quickType")}</p>
              <div className="segment-group w-full">
                <button
                  type="button"
                  className={`segment-item flex-1 ${currentGenerationKind === "image" ? "segment-active" : ""}`}
                  onClick={() => onGenerationKindChanged("image")}
                  disabled={!imageProviders.length}
                >
                  <ImageSquare size={14} />
                  {t("create.quickImage")}
                </button>
                <button
                  type="button"
                  className={`segment-item flex-1 ${currentGenerationKind === "video" ? "segment-active" : ""}`}
                  onClick={() => onGenerationKindChanged("video")}
                  disabled={!videoProviders.length}
                >
                  <VideoCamera size={14} />
                  {t("create.quickVideo")}
                </button>
              </div>
            </div>

            <div className="composer-popover-section">
              <p className="composer-popover-heading">{t("create.model")}</p>
              <div className="composer-menu-list">
                {modelChoices.map((choice) => {
                  const isSelected = activeModelChoiceKey === choice.key;
                  return (
                    <button
                      type="button"
                      key={choice.key}
                      className={`composer-menu-item ${isSelected ? "composer-menu-item-active" : ""}`}
                      onClick={() => {
                        dismissComposerClear();
                        if (currentGenerationKind === "image" && choice.familyId) {
                          selectImageVariant(choice.familyId);
                        } else if (
                          currentGenerationKind === "video" &&
                          choice.familyId &&
                          videoModelFamilies.some((family) => family.id === choice.familyId)
                        ) {
                          selectVideoVariant(choice.familyId);
                        } else {
                          setProviderId(choice.providerId);
                          setModelName(choice.modelName);
                          if (choice.operationId) {
                            setOperationId(choice.operationId);
                          }
                        }
                      }}
                    >
                      <div className="composer-menu-item__content composer-menu-item__content-stack">
                        <span>{choice.label}</span>
                        {choice.meta ? (
                          <span className="composer-menu-item__meta">{choice.meta}</span>
                        ) : null}
                      </div>
                      {isSelected ? <Check size={13} weight="bold" className="composer-menu-check" /> : null}
                    </button>
                  );
                })}
              </div>

              {currentGenerationKind === "image" &&
              currentImageFamily &&
              currentImageFamilySupportsModeSwitch ? (
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between gap-3 px-1">
                    <p className="m-0 text-label">{t("create.quickMode")}</p>
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
                      onClick={() => selectImageVariant(currentImageFamily.id, { asyncEnabled: false })}
                    >
                      {t("create.imageAsyncOff")}
                    </button>
                    <button
                      type="button"
                      className={`segment-item flex-1 ${currentImageAsyncEnabled ? "segment-active" : ""}`}
                      onClick={() => {
                        if (hasImageSourceAttachments) {
                          return;
                        }
                        selectImageVariant(currentImageFamily.id, { asyncEnabled: true });
                      }}
                      disabled={hasImageSourceAttachments}
                    >
                      {t("create.imageAsyncOn")}
                    </button>
                  </div>
                  <p className="m-0 px-1 text-[11px] leading-5 text-[var(--c-text-secondary)]">
                    {currentImageAsyncEnabled
                      ? t("create.imageModeBudgetDesc")
                      : t("create.imageModeFastDesc")}
                  </p>
                </div>
              ) : null}
            </div>

            {hasQuickParams ? (
              <div className="composer-popover-section flex flex-col gap-3.5">
                {!hideVideoRatioSelector &&
                Boolean(resolutionField && (ratioChoices.length > 0 || resolutionValue)) ? (
                  <div>
                    <p className="composer-popover-heading">{t("create.quickRatio")}</p>
                    <div
                      className="composer-ratio-grid"
                      style={{
                        gridTemplateColumns: `repeat(${(ratioChoices.length ? ratioChoices : [resolutionValue]).filter(Boolean).length}, minmax(0, 1fr))`,
                      }}
                    >
                      {(ratioChoices.length ? ratioChoices : [resolutionValue]).filter(Boolean).map((ratio) => (
                        <button
                          type="button"
                          key={`ratio_${ratio}`}
                          className={`composer-ratio-card ${currentRatioDisplay === ratio ? "composer-ratio-card-active" : ""}`}
                          onClick={() => onRatioChanged(ratio)}
                        >
                          <span className="composer-ratio-card__preview">
                            <span
                              className="composer-ratio-card__frame"
                              style={buildRatioPreviewStyle(ratio)}
                            />
                          </span>
                          <span className="composer-ratio-card__label">{ratio}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {(currentGenerationKind === "image"
                  ? imageResolutionChoices.length > 0
                  : selectedProvider?.type === "tuzi_veo"
                    ? videoResolutionChoices.length > 0
                    : hasQuickSize) ? (
                  <div>
                    <p className="composer-popover-heading">
                      {currentGenerationKind === "image"
                        ? t("create.imageResolutionLabel")
                        : t("create.quickSize")}
                    </p>
                    <div className="composer-resolution-grid">
                      {currentGenerationKind === "image"
                        ? imageResolutionChoices.map((resolution) => (
                            <button
                              type="button"
                              key={resolution}
                              className={`composer-resolution-card ${currentImageResolutionLabel === resolution ? "composer-resolution-card-active" : ""}`}
                              onClick={() => {
                                if (!currentImageFamily) {
                                  return;
                                }
                                selectImageVariant(currentImageFamily.id, {
                                  resolutionLabel: resolution,
                                });
                              }}
                            >
                              <span className="composer-resolution-card__eyebrow">
                                {describeResolutionChoice(resolution, locale)}
                              </span>
                              <span className="composer-resolution-card__label">{resolution}</span>
                            </button>
                          ))
                        : (selectedProvider?.type === "tuzi_veo"
                            ? videoResolutionChoices
                            : qualityField
                              ? qualityChoices
                              : sizeChoices).map((size) => {
                            const active = qualityField ? qualityValue === size : currentSizeDisplay === size;
                            const isTuziVeo = selectedProvider?.type === "tuzi_veo";
                            const resolvedActive = isTuziVeo
                              ? currentVideoVariant?.resolutionLabel === size
                              : active;
                            const label = qualityField
                              ? qualityField.options.find((option) => option.value === size)?.label ?? size
                              : size;
                            return (
                              <button
                                type="button"
                                key={`size_${size}`}
                                className={`composer-resolution-card ${resolvedActive ? "composer-resolution-card-active" : ""}`}
                                onClick={() => onSizeChanged(size)}
                              >
                                <span className="composer-resolution-card__eyebrow">{t("create.quickSize")}</span>
                                <span className="composer-resolution-card__label">{label}</span>
                              </button>
                            );
                          })}
                    </div>
                  </div>
                ) : null}

                {orientationField && orientationChoices.length > 0 ? (
                  <div>
                    <p className="composer-popover-heading">{t("create.quickOrientation")}</p>
                    <div className="composer-choice-grid">
                      {orientationChoices.map((option) => (
                        <button
                          type="button"
                          key={`o_${option.value}`}
                          className={`composer-choice-pill ${orientationValue === option.value ? "composer-choice-pill-active" : ""}`}
                          onClick={() => onOrientationChanged(option.value)}
                        >
                          <span className="composer-choice-pill__label">{option.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                {durationField && durationChoices.length > 0 ? (
                  <div>
                    <p className="composer-popover-heading">{t("create.quickDuration")}</p>
                    <div className="composer-choice-strip">
                      {durationChoices.map((seconds) => (
                        <button
                          type="button"
                          key={`d_${seconds}`}
                          className={`composer-choice-pill ${durationValue === String(seconds) ? "composer-choice-pill-active" : ""}`}
                          onClick={() => onFieldChanged(durationField!, String(seconds))}
                        >
                          <span className="composer-choice-pill__label">{seconds}s</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {usesOfficialGptImage25Parameters && (resolutionField || qualityField || backgroundField) ? (
              <div className="composer-popover-section">
                <p className="composer-popover-heading">{t("create.quickFormat")}</p>
                <div className="flex flex-col gap-2">
                  {resolutionField ? (
                    <select
                      className="input-base py-1.5 text-xs"
                      value={resolutionValue}
                      aria-label={resolutionField.label}
                      title={resolutionField.label}
                      onChange={(event) => onFieldChanged(resolutionField, event.target.value)}
                    >
                      {resolutionField.options.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  ) : null}
                  {qualityField ? (
                    <select
                      className="input-base py-1.5 text-xs"
                      value={qualityValue}
                      aria-label={qualityField.label}
                      title={qualityField.label}
                      onChange={(event) => onFieldChanged(qualityField, event.target.value)}
                    >
                      {qualityField.options.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  ) : null}
                  {backgroundField ? (
                    <label className="flex cursor-pointer select-none items-center gap-2 px-1 text-xs text-[var(--c-text)]">
                      <input
                        type="checkbox"
                        className="accent-[var(--c-accent)]"
                        checked={backgroundValue === "transparent"}
                        onChange={(event) => {
                          const transparent = event.target.checked;
                          onFieldChanged(backgroundField, transparent ? "transparent" : "auto");
                          if (transparent && outputFormatField && outputFormatValue === "jpeg") {
                            onFieldChanged(outputFormatField, "png");
                          }
                        }}
                      />
                      <span>{t("create.transparentBackground")}</span>
                    </label>
                  ) : null}
                </div>
              </div>
            ) : null}

            {advancedFields.length > 0 || composerMediaFields.length > 0 ? (
              <div className="composer-popover-section">
                <button
                  type="button"
                  className="btn-secondary w-full"
                  onClick={() => {
                    setOpenPopover(null);
                    setShowAdvanced(true);
                  }}
                >
                  <Faders size={13} />
                  {t("create.advancedLabel")}
                </button>
              </div>
            ) : null}
          </div>,
          document.body,
          )
          : null}

        {hint ? <p className="composer-hint">{hint}</p> : null}
        {composerClearSnapshot ? (
          <div className="composer-clear-toast" role="status" aria-live="polite">
            <span>{t("create.composerCleared")}</span>
            <button type="button" onClick={undoComposerClear}>
              {t("create.undo")}
            </button>
          </div>
        ) : null}
      </form>

      {recentStrip.length > 0 ? (
        <div className="recent-row" aria-label={t("create.recentTasks")}>
          {recentStrip.map((task) => {
            const tone = statusTone(task);
            const thumb =
              (task.asset_type === "video" ? extractVideoPoster(task) : null) ??
              extractImageUrls(task)[0] ??
              null;
            return (
              <button
                key={task.task_id}
                type="button"
                className="recent-thumb"
                title={`${statusLabel(task)} · ${task.prompt?.slice(0, 60) ?? ""}`}
                onClick={() => setRecentOverlayTaskId(task.task_id)}
              >
                {thumb && tone === "ok" ? <img src={thumb} alt="" loading="lazy" /> : null}
                {tone === "warn" ? (
                  <span className="recent-thumb-state">
                    <CircleNotch size={14} className="animate-spin text-[var(--c-accent)]" />
                  </span>
                ) : tone === "danger" ? (
                  <span className="recent-thumb-state bg-[var(--c-error-bg)] text-[var(--c-error-text)]">
                    <WarningCircle size={14} />
                  </span>
                ) : !thumb ? (
                  <span className="recent-thumb-state">
                    {task.asset_type === "video" ? <VideoCamera size={14} /> : <ImageSquare size={14} />}
                  </span>
                ) : null}
              </button>
            );
          })}
          <button
            type="button"
            className="topbar-text-link ml-1 text-[11px] text-[var(--c-text-secondary)]"
            onClick={() => navigate("/works")}
          >
            {t("create.viewAll")}
          </button>
        </div>
      ) : null}
      </div>

      {/* ── Advanced Panel (slide-up overlay) ────────── */}
      {showAdvanced && (advancedFields.length > 0 || composerMediaFields.length > 0) ? (
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
  removeLabel,
  onRemove,
}: {
  item: { source: "local" | "reused"; file?: File; fileId?: string };
  removeLabel: string;
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
    <span className="ref-chip">
      {url ? <img src={url} alt="" className="ref-chip-thumb" /> : <span className="ref-chip-thumb" />}
      <button type="button" className="ref-chip-remove" onClick={onRemove} aria-label={removeLabel}>
        <X size={10} weight="regular" />
      </button>
    </span>
  );
}

function SubjectRefChip({
  subject,
  token,
  removeLabel,
  onRemove,
}: {
  subject: SubjectAsset;
  token: string;
  removeLabel: string;
  onRemove: () => void;
}) {
  const primary = subject.references.find((item) => item.is_primary) ?? subject.references[0];
  return (
    <span className="ref-chip" title={subject.name}>
      <span className="ref-chip-name">{subject.name}</span>
      {primary ? (
        <UploadedImage fileId={primary.file_id} token={token} alt="" className="ref-chip-thumb" />
      ) : null}
      <button type="button" className="ref-chip-remove" onClick={onRemove} aria-label={removeLabel}>
        <X size={10} weight="regular" />
      </button>
    </span>
  );
}

function ScenePicker({
  scenes,
  sceneId,
  newSceneTitle,
  crumbTitle,
  sceneOrdinal,
  statusNote,
  onSelect,
  onNewSceneTitleChange,
  onManage,
}: {
  scenes: Scene[];
  sceneId: string;
  newSceneTitle: string;
  crumbTitle: string;
  sceneOrdinal: number;
  statusNote: string;
  onSelect: (sceneId: string) => void;
  onNewSceneTitleChange: (title: string) => void;
  onManage: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!anchorRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const pick = (nextSceneId: string) => {
    onSelect(nextSceneId);
    if (nextSceneId !== "__new__") {
      setOpen(false);
    }
  };

  return (
    <div className="dropdown-anchor min-w-0" ref={anchorRef}>
      <button
        type="button"
        className="crumb-label"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="crumb-title">{crumbTitle}</span>
        {sceneOrdinal > 0 ? (
          <>
            <span className="crumb-sep">/</span>
            <span className="tabular-nums">{formatSceneOrdinal(sceneOrdinal)}</span>
          </>
        ) : null}
      </button>
      {open ? (
        <div className="menu-popover menu-popover-left w-[280px] max-w-[calc(100vw-32px)]" role="menu">
          <p className="menu-section-label">{t("create.scene.menuTitle")}</p>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={!sceneId}
            className={`menu-item ${!sceneId ? "menu-item-active" : ""}`}
            onClick={() => pick("")}
          >
            <span className="menu-item-label">{t("create.scene.standalone")}</span>
            {!sceneId ? <Check size={12} weight="bold" /> : null}
          </button>
          {scenes.map((scene, index) => (
            <button
              key={scene.scene_id}
              type="button"
              role="menuitemradio"
              aria-checked={sceneId === scene.scene_id}
              className={`menu-item ${sceneId === scene.scene_id ? "menu-item-active" : ""}`}
              onClick={() => pick(scene.scene_id)}
            >
              <span className="menu-item-label">{scene.title}</span>
              {sceneId === scene.scene_id ? (
                <Check size={12} weight="bold" />
              ) : (
                <span className="menu-item-meta tabular-nums">{formatSceneOrdinal(index + 1)}</span>
              )}
            </button>
          ))}
          <div className="menu-divider" />
          {sceneId === "__new__" ? (
            <div className="px-1.5 pb-1">
              <input
                className="input-base py-1.5 text-xs"
                value={newSceneTitle}
                maxLength={160}
                autoFocus
                onChange={(event) => onNewSceneTitleChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    setOpen(false);
                  }
                }}
                placeholder={t("create.scene.newPlaceholder")}
              />
            </div>
          ) : (
            <button type="button" className="menu-item" onClick={() => pick("__new__")}>
              <span className="menu-item-label">{t("create.scene.new")}</span>
              <Plus size={12} />
            </button>
          )}
          <button
            type="button"
            className="menu-item"
            onClick={() => {
              setOpen(false);
              onManage();
            }}
          >
            <span className="menu-item-label text-[var(--c-text-secondary)]">{t("create.scene.manage")}</span>
          </button>
          {statusNote ? (
            <p className="m-0 px-2.5 pb-1.5 pt-1 text-[11px] leading-5 text-[var(--c-text-tertiary)]">{statusNote}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function formatSceneOrdinal(ordinal: number): string {
  return `Scene ${String(ordinal).padStart(2, "0")}`;
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

function collectTuziVideoModelFamilies(providers: ProviderInfo[]): VideoModelFamily[] {
  const families = new Map<string, VideoModelFamily>();
  for (const provider of providers) {
    if (provider.type !== "tuzi_veo") {
      continue;
    }
    for (const model of provider.models) {
      const parsed = parseVideoModelVariant(model);
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
        operation: model.operations.find((operation) => operation.is_default) ?? model.operations[0] ?? null,
        resolutionKey: parsed.resolutionKey,
        resolutionLabel: parsed.resolutionLabel,
      });
      families.set(familyId, existing);
    }
  }
  return Array.from(families.values()).map((family) => ({
    ...family,
    variants: family.variants.sort(
      (left, right) => rankVideoResolution(left.resolutionKey) - rankVideoResolution(right.resolutionKey),
    ),
  }));
}

function parseVideoModelVariant(model: ProviderModelInfo): {
  familyLabel: string;
  resolutionKey: "720p" | "4k";
  resolutionLabel: "720P" | "4K";
} {
  const normalizedName = model.name.toLowerCase();
  const normalizedDisplay = model.display_name.toLowerCase();
  const resolutionKey = normalizedName.includes("4k") || normalizedDisplay.includes("4k")
    ? "4k"
    : "720p";
  const resolutionLabel = resolutionKey === "4k" ? "4K" : "720P";
  const familyLabel = model.display_name
    .replace(/\s+4k\b/gi, "")
    .replace(/\s+720p\b/gi, "")
    .trim();
  return {
    familyLabel: familyLabel || model.display_name,
    resolutionKey,
    resolutionLabel,
  };
}

function pickVideoFamilyVariant(
  family: VideoModelFamily,
  options: { resolutionKey?: "720p" | "4k" },
): VideoModelVariant | null {
  const targetResolution = options.resolutionKey;
  return (
    family.variants.find(
      (variant) => targetResolution == null || variant.resolutionKey === targetResolution,
    ) ??
    family.variants[0] ??
    null
  );
}

function videoResolutionLabelToKey(label: string): "720p" | "4k" {
  const normalized = label.trim().toLowerCase();
  return normalized === "4k" ? "4k" : "720p";
}

function rankVideoResolution(key: "720p" | "4k"): number {
  return key === "4k" ? 1 : 0;
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
  const familyLabel = normalizedName === "gpt-image-2.5-1k"
    ? model.display_name
    : model.display_name
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

function describeResolutionChoice(
  resolution: string,
  locale: SupportedLocale,
): string {
  const normalized = resolution.trim().toUpperCase();
  if (locale === "zh-CN") {
    if (normalized === "4K") {
      return "超清";
    }
    if (normalized === "2K") {
      return "高清";
    }
    if (normalized === "1K") {
      return "标准";
    }
    return "分辨率";
  }
  if (normalized === "4K") {
    return "Ultra";
  }
  if (normalized === "2K") {
    return "HD";
  }
  if (normalized === "1K") {
    return "Base";
  }
  return "Resolution";
}

function buildRatioPreviewStyle(ratio: string): CSSProperties {
  const match = ratio.match(/^\s*(\d+)\s*:\s*(\d+)\s*$/);
  if (!match) {
    return {
      width: "18px",
      height: "12px",
    };
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!(Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)) {
    return {
      width: "18px",
      height: "12px",
    };
  }

  const maxWidth = 28;
  const maxHeight = 14;
  const minSize = 8;
  const scale = Math.min(maxWidth / width, maxHeight / height);

  return {
    width: `${Math.max(minSize, Math.round(width * scale))}px`,
    height: `${Math.max(minSize, Math.round(height * scale))}px`,
  };
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

function readLastGenerationKind(): "image" | "video" {
  try {
    const raw = localStorage.getItem(LAST_GENERATION_KIND_KEY)?.trim();
    return raw === "image" ? "image" : "video";
  } catch {
    return "video";
  }
}

function persistLastGenerationKind(kind: "image" | "video"): void {
  try {
    localStorage.setItem(LAST_GENERATION_KIND_KEY, kind);
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
      let size = `${Math.min(width, height)}P`;
      if (Math.max(width, height) >= 3840 || Math.min(width, height) >= 2160) {
        size = "4K";
      } else if (Math.max(width, height) >= 2560 || Math.min(width, height) >= 1440) {
        size = "2K";
      }
      return {
        ratio: normalizeAspectRatio(width, height),
        size,
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
  const inputField =
    field.target === "provider_options" &&
    field.key === "output_format" &&
    values["provider_options:background"] === "transparent"
      ? { ...field, options: field.options.filter((option) => option.value !== "jpeg") }
      : field;
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
        field={inputField}
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
        (field.key === "quality" || field.key === "resolution_tier") &&
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
        (field.key === "quality" || field.key === "resolution_tier") &&
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

function sceneReferences(subject: SubjectAsset) {
  return [...subject.references]
    .sort((left, right) => Number(right.is_primary) - Number(left.is_primary))
    .slice(0, 3);
}

function buildPromptWithSubjects(scenePrompt: string, subjects: SubjectAsset[]): string {
  const subjectInstructions = subjects.map((subject) => {
    const details = [subject.description.trim(), ...subject.fixed_traits]
      .filter(Boolean)
      .join("; ");
    return `- ${subject.name} (${subject.kind}): ${details || "preserve the supplied reference identity"}`;
  });
  return [
    "Keep the following recurring subjects visually consistent with their supplied references:",
    ...subjectInstructions,
    "Do not transfer identity traits, clothing, colors, or distinctive details between subjects.",
    "Scene request:",
    scenePrompt.trim(),
  ]
    .filter(Boolean)
    .join("\n");
}

function buildVersionEditPrompt(originalPrompt: string, instruction: string): string {
  return [
    "Edit the supplied image while preserving all unspecified subjects, identities, objects, location details, composition, and style.",
    "Original scene request:",
    originalPrompt.trim(),
    "Modification request:",
    instruction.trim(),
  ].join("\n");
}

function fileToDataUrl(file: File): Promise<string> {
  return blobToDataUrl(file);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to encode image"));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to encode image"));
    reader.readAsDataURL(blob);
  });
}

function buildSubjectReferencePrompt(subject: SubjectAsset, role: string): string {
  const identity = [subject.description, ...subject.fixed_traits].filter(Boolean).join("; ");
  const roleInstructions: Record<string, string> = {
    anchor: "Create a clean, distinctive identity anchor on a plain neutral background, front three-quarter view, full body visible, no text, no character sheet.",
    front: "Create a clean front-view full-body reference on a plain neutral background. Preserve the supplied identity exactly.",
    threeQuarter: "Create a clean three-quarter full-body reference on a plain neutral background. Preserve the supplied identity exactly.",
    side: "Create a clean side-profile full-body reference on a plain neutral background. Preserve the supplied identity exactly.",
    expression: "Create a close-up expression reference with neutral, happy, surprised, and concerned expressions. Preserve the supplied identity exactly.",
  };
  return [
    `Subject: ${subject.name} (${subject.kind}).`,
    identity ? `Stable identity traits: ${identity}.` : "Design a recognizable, repeatable visual identity.",
    roleInstructions[role] ?? roleInstructions.anchor,
    "Use simple even lighting and avoid props or scenery that obscure the subject.",
  ].join("\n");
}

function subjectKindLabel(subject: SubjectAsset, isZh: boolean): string {
  if (subject.kind === "character") return isZh ? "人物" : "Character";
  if (subject.kind === "object") return isZh ? "物品" : "Object";
  return isZh ? "场景" : "Location";
}
