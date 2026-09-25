import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Check,
  CircleNotch,
  MagnifyingGlass,
  Play,
  WarningCircle,
} from "@phosphor-icons/react";
import { adoptGenerationVersion, fetchTaskDetail, fetchTaskPage } from "../api";
import { AppLightboxStage } from "../components/AppLightboxStage";
import { HeaderActions } from "../components/AppTopBar";
import { Dropdown, DropdownOption } from "../components/Dropdown";
import { EmptyStateWorks } from "../components/Skeletons";
import { MediaDetailSidebar } from "../components/MediaDetailSidebar";
import { MediaOverlayFrame } from "../components/MediaOverlayFrame";
import { useI18n, type TranslateFn } from "../i18n";
import {
  buildLightboxItems,
  extractVideoPoster,
  inferTaskAspectRatio,
  inferTaskOrientation,
  type LightboxKind,
} from "../lightbox";
import {
  buildTaskRequestPayload,
  copyText,
  formatRawDebugPayload,
} from "../overlayTaskUtils";
import {
  buildReuseDraft,
  formatRetryErrorMessage,
  formatRetryQueuedMessage,
  formatTaskActionErrorMessage,
  formatTaskActionSuccessMessage,
  type RetryTaskPayload,
  type ReuseTaskPayload,
  type TaskActionPayload,
  runRetryTask,
  runTaskAction,
} from "../overlayTaskActions";
import {
  buildMediaSidebarActions,
  formatOverlayTaskStatus,
  providerSupportsSeedRetry,
} from "../overlayTaskPresentation";
import { useAppSettingsStore } from "../state";
import {
  useEscapeToClose,
  useOverlayScrollLock,
} from "../useMediaOverlay";
import type { VideoTaskDetail, VideoTaskResponse } from "../types";
import {
  errorMessage,
  extractImageUrls,
  formatTime,
} from "../utils";

interface Props {
  tasks: VideoTaskDetail[];
  loading: boolean;
}

type BrowseFilter = "all" | "image" | "video";
type StageFilter = "all" | "draft" | "final";
type SortOrder = "recent" | "oldest";
const TASK_PAGE_SIZE = 50;
const ALL_PROJECTS = "__all__";
const STANDALONE_PROJECT = "__standalone__";
const GRID_GAP = 8;

export function WorksPage(props: Props) {
  const { tasks, loading } = props;
  const { locale, t } = useI18n();
  const settings = useAppSettingsStore();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const handledTaskDeepLinkRef = useRef<string>("");
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);

  const [browseFilter, setBrowseFilter] = useState<BrowseFilter>("all");
  const [stageFilter, setStageFilter] = useState<StageFilter>("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>("recent");
  const [projectFilter, setProjectFilter] = useState(ALL_PROJECTS);
  const [searchQuery, setSearchQuery] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set());
  const [measuredRatios, setMeasuredRatios] = useState<Record<string, number>>({});
  const [hint, setHint] = useState("");
  const [lightboxState, setLightboxState] = useState<{ kind: LightboxKind; index: number } | null>(null);
  const [isMediaExpanded, setIsMediaExpanded] = useState(false);
  const [extraTasks, setExtraTasks] = useState<VideoTaskDetail[]>([]);
  const [nextOffset, setNextOffset] = useState(TASK_PAGE_SIZE);
  const [hasMorePages, setHasMorePages] = useState(() => inferHasMorePages(tasks));
  const isLightboxOpen = lightboxState !== null;
  const allTasks = useMemo(() => mergeTaskLists(tasks, extraTasks), [extraTasks, tasks]);
  const taskById = useMemo(
    () => new Map(allTasks.map((task) => [task.task_id, task])),
    [allTasks],
  );

  useEffect(() => {
    setExtraTasks([]);
    setNextOffset(TASK_PAGE_SIZE);
    setHasMorePages(inferHasMorePages(tasks));
  }, [settings.gatewayToken]);

  useEffect(() => {
    if (nextOffset === TASK_PAGE_SIZE) {
      setHasMorePages(inferHasMorePages(tasks));
    }
  }, [nextOffset, tasks]);

  useEffect(() => {
    if (!hint) {
      return;
    }
    const timer = window.setTimeout(() => setHint(""), 5000);
    return () => window.clearTimeout(timer);
  }, [hint]);

  const completedTasks = useMemo(
    () =>
      allTasks
        .filter((task) => task.status !== "queued" && task.status !== "running")
        .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at)),
    [allTasks],
  );

  const providerOptions = useMemo(
    () =>
      Array.from(
        new Set(
          completedTasks
            .map((task) => task.provider)
            .filter((provider): provider is string => Boolean(provider)),
        ),
      ).sort((left, right) => left.localeCompare(right)),
    [completedTasks],
  );
  const projectOptions = useMemo(() => {
    const byId = new Map<string, { id: string; title: string; count: number }>();
    for (const task of allTasks) {
      if (!task.scene_id) {
        continue;
      }
      const current = byId.get(task.scene_id);
      if (current) {
        current.count += 1;
      } else {
        byId.set(task.scene_id, {
          id: task.scene_id,
          title: task.scene_title || task.scene_id.slice(0, 8),
          count: 1,
        });
      }
    }
    return Array.from(byId.values()).sort((left, right) => left.title.localeCompare(right.title));
  }, [allTasks]);
  const kindCounts = useMemo(
    () => ({
      all: completedTasks.length,
      image: completedTasks.filter((task) => task.asset_type === "image").length,
      video: completedTasks.filter((task) => task.asset_type === "video").length,
    }),
    [completedTasks],
  );

  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredTasks = useMemo(() => {
    let nextList = allTasks;
    if (browseFilter !== "all") {
      nextList = nextList.filter((task) => task.asset_type === browseFilter);
    }
    if (stageFilter !== "all") {
      nextList = nextList.filter((task) => task.task_stage === stageFilter);
    }
    if (projectFilter === STANDALONE_PROJECT) {
      nextList = nextList.filter((task) => !task.scene_id);
    } else if (projectFilter !== ALL_PROJECTS) {
      nextList = nextList.filter((task) => task.scene_id === projectFilter);
    }
    if (providerFilter !== "all") {
      nextList = nextList.filter((task) => task.provider === providerFilter);
    }
    if (normalizedSearchQuery) {
      nextList = nextList.filter((task) => {
        const searchable = [
          task.task_id,
          task.provider,
          task.model,
          task.scene_title ?? "",
          task.prompt ?? "",
        ]
          .join(" ")
          .toLowerCase();
        return searchable.includes(normalizedSearchQuery);
      });
    }
    const direction = sortOrder === "recent" ? -1 : 1;
    return [...nextList].sort(
      (left, right) => direction * (Date.parse(left.created_at) - Date.parse(right.created_at)),
    );
  }, [allTasks, browseFilter, normalizedSearchQuery, projectFilter, providerFilter, sortOrder, stageFilter]);
  const assetList = useMemo(
    () => filteredTasks.filter((task) => task.status !== "queued" && task.status !== "running"),
    [filteredTasks],
  );
  const inProgressList = useMemo(
    () => filteredTasks.filter((task) => task.status === "queued" || task.status === "running"),
    [filteredTasks],
  );
  const gridTasks = useMemo(() => [...inProgressList, ...assetList], [assetList, inProgressList]);

  useEffect(() => {
    if (!assetList.length) {
      setSelectedTaskId(null);
      return;
    }
    if (!selectedTaskId || !assetList.some((task) => task.task_id === selectedTaskId)) {
      setSelectedTaskId(assetList[0].task_id);
    }
  }, [assetList, selectedTaskId]);

  useEffect(() => {
    setCheckedIds((current) => {
      if (!current.size) {
        return current;
      }
      const visible = new Set(assetList.map((task) => task.task_id));
      const next = new Set(Array.from(current).filter((id) => visible.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [assetList]);

  const imageLightboxItems = useMemo(() => buildLightboxItems(assetList, "image"), [assetList]);
  const videoLightboxItems = useMemo(() => buildLightboxItems(assetList, "video"), [assetList]);
  const allImageLightboxItems = useMemo(
    () => buildLightboxItems(completedTasks, "image"),
    [completedTasks],
  );
  const allVideoLightboxItems = useMemo(
    () => buildLightboxItems(completedTasks, "video"),
    [completedTasks],
  );
  const lightboxItems = lightboxState?.kind === "video" ? videoLightboxItems : imageLightboxItems;
  const lightboxIndex = lightboxState?.index ?? null;
  const lightboxItem = useMemo(() => {
    if (lightboxIndex == null || lightboxIndex < 0 || lightboxIndex >= lightboxItems.length) {
      return null;
    }
    return lightboxItems[lightboxIndex];
  }, [lightboxIndex, lightboxItems]);
  const currentLightboxTask = lightboxItem
    ? taskById.get(lightboxItem.taskId) ?? null
    : null;
  const currentLightboxOrientation = currentLightboxTask
    ? inferTaskOrientation(currentLightboxTask)
    : "landscape";
  const versionTasks = useMemo(
    () => currentLightboxTask?.generation_id
      ? allTasks
          .filter((task) => task.generation_id === currentLightboxTask.generation_id)
          .sort((left, right) => (left.version_number ?? 0) - (right.version_number ?? 0))
      : [],
    [allTasks, currentLightboxTask?.generation_id],
  );
  const [isRawResultOpen, setIsRawResultOpen] = useState(false);
  const [queuedRetryTaskId, setQueuedRetryTaskId] = useState<string | null>(null);

  const taskDetailQuery = useQuery({
    queryKey: [
      "task-detail",
      settings.gatewayToken,
      currentLightboxTask?.asset_type,
      currentLightboxTask?.task_id,
    ],
    queryFn: async () => {
      if (!currentLightboxTask) {
        throw new Error("Missing task context");
      }
      return fetchTaskDetail(
        currentLightboxTask.task_id,
        settings.gatewayToken,
        currentLightboxTask.asset_type,
      );
    },
    enabled:
      Boolean(currentLightboxTask) &&
      (isRawResultOpen || currentLightboxTask?.status === "failed"),
    staleTime: 30_000,
  });
  const rawResultTask = taskDetailQuery.data ?? currentLightboxTask;
  const rawResultPayload = useMemo(() => {
    if (!isRawResultOpen || !rawResultTask) {
      return "";
    }
    return formatRawDebugPayload(rawResultTask);
  }, [isRawResultOpen, rawResultTask]);

  useEffect(() => {
    setIsRawResultOpen(false);
  }, [currentLightboxTask?.task_id]);

  useEffect(() => {
    setIsMediaExpanded(false);
  }, [currentLightboxTask?.task_id]);

  useEffect(() => {
    setQueuedRetryTaskId(null);
  }, [currentLightboxTask?.task_id]);

  useOverlayScrollLock(isLightboxOpen);

  useEffect(() => {
    if (!lightboxItems.length) {
      setLightboxState(null);
      return;
    }
    if (lightboxIndex != null && lightboxIndex >= lightboxItems.length) {
      setLightboxState((current) =>
        current ? { ...current, index: lightboxItems.length - 1 } : null,
      );
    }
  }, [lightboxIndex, lightboxItems]);

  useEscapeToClose(lightboxIndex != null && !isMediaExpanded, () => setLightboxState(null));
  useEscapeToClose(isMediaExpanded, () => setIsMediaExpanded(false));
  useEscapeToClose(selectMode && !isLightboxOpen, () => exitSelectMode());

  const openImageLightbox = (taskId: string, imageUrl?: string) => {
    const index = imageLightboxItems.findIndex(
      (item) => item.taskId === taskId && (!imageUrl || item.url === imageUrl),
    );
    if (index >= 0) {
      setLightboxState({ kind: "image", index });
    }
  };

  const openVideoLightbox = (taskId: string, videoUrl?: string) => {
    const index = videoLightboxItems.findIndex(
      (item) => item.taskId === taskId && (!videoUrl || item.url === videoUrl),
    );
    if (index >= 0) {
      setLightboxState({ kind: "video", index });
    }
  };

  useEffect(() => {
    const taskId = new URLSearchParams(location.search).get("taskId")?.trim() ?? "";
    if (!taskId) {
      handledTaskDeepLinkRef.current = "";
      return;
    }
    if (handledTaskDeepLinkRef.current === taskId) {
      return;
    }
    const targetTask = completedTasks.find((task) => task.task_id === taskId);
    if (!targetTask) {
      return;
    }

    handledTaskDeepLinkRef.current = taskId;
    setBrowseFilter("all");
    setStageFilter("all");
    setProjectFilter(ALL_PROJECTS);
    setProviderFilter("all");
    setSearchQuery("");
    setSelectedTaskId(taskId);

    if (targetTask.asset_type === "video") {
      const nextIndex = allVideoLightboxItems.findIndex((item) => item.taskId === taskId);
      if (nextIndex >= 0) {
        setLightboxState({ kind: "video", index: nextIndex });
      }
      return;
    }
    const nextIndex = allImageLightboxItems.findIndex((item) => item.taskId === taskId);
    if (nextIndex >= 0) {
      setLightboxState({ kind: "image", index: nextIndex });
    }
  }, [allImageLightboxItems, allVideoLightboxItems, completedTasks, location.search]);

  const deleteMutation = useMutation<unknown, Error, TaskActionPayload>({
    mutationFn: (payload) => runTaskAction(payload, settings.gatewayToken),
    onSuccess: async (_data, payload) => {
      setHint(formatTaskActionSuccessMessage(payload, t));
      setSelectedTaskId((current) => (current === payload.taskId ? null : current));
      setExtraTasks((current) => current.filter((task) => task.task_id !== payload.taskId));
      await queryClient.invalidateQueries({ queryKey: ["tasks", settings.gatewayToken] });
      await queryClient.invalidateQueries({ queryKey: ["task-cost-summary", settings.gatewayToken] });
    },
    onError: (error: Error, payload) => {
      setHint(formatTaskActionErrorMessage(payload, error, t));
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (targets: VideoTaskDetail[]) => {
      let deleted = 0;
      for (const task of targets) {
        await runTaskAction(
          { taskId: task.task_id, assetType: task.asset_type, action: "delete" },
          settings.gatewayToken,
        );
        deleted += 1;
      }
      return deleted;
    },
    onSuccess: async (deleted, targets) => {
      const removed = new Set(targets.map((task) => task.task_id));
      setExtraTasks((current) => current.filter((task) => !removed.has(task.task_id)));
      setHint(t("works.deletedCount", { count: deleted }));
      exitSelectMode();
    },
    onError: (error: Error) => {
      setHint(t("works.deleteFailed", { message: error.message }));
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["tasks", settings.gatewayToken] });
      await queryClient.invalidateQueries({ queryKey: ["task-cost-summary", settings.gatewayToken] });
    },
  });

  const retryMutation = useMutation<VideoTaskResponse, Error, RetryTaskPayload>({
    mutationFn: (payload) => runRetryTask(payload, settings.gatewayToken),
    onSuccess: async (response, payload) => {
      setQueuedRetryTaskId(payload.task.task_id);
      setHint(formatRetryQueuedMessage(response.task_id, t));
      await queryClient.invalidateQueries({ queryKey: ["tasks", settings.gatewayToken] });
      await queryClient.invalidateQueries({ queryKey: ["task-cost-summary", settings.gatewayToken] });
    },
    onError: (error: Error) => {
      setHint(formatRetryErrorMessage(error, t));
    },
  });
  const reuseMutation = useMutation({
    mutationFn: (payload: ReuseTaskPayload) => buildReuseDraft(payload, settings.gatewayToken),
    onMutate: () => {
      settings.setPendingReuseDraft(null);
      settings.setPendingReuseError(null);
      settings.setPendingReuseLoading(true);
      navigate("/create");
    },
    onSuccess: (draft) => {
      settings.setPendingReuseDraft(draft);
      settings.setPendingReuseLoading(false);
    },
    onError: (error: Error) => {
      settings.setPendingReuseLoading(false);
      settings.setPendingReuseError(error.message);
    },
  });
  const adoptMutation = useMutation({
    mutationFn: (payload: { generationId: string; taskId: string }) =>
      adoptGenerationVersion(payload.generationId, payload.taskId, settings.gatewayToken),
    onSuccess: async () => {
      setHint(locale === "zh-CN" ? "已采用此版本。" : "Version adopted.");
      await queryClient.invalidateQueries({ queryKey: ["tasks", settings.gatewayToken] });
    },
    onError: (error: Error) => {
      setHint(locale === "zh-CN" ? `采用失败：${error.message}` : `Could not adopt version: ${error.message}`);
    },
  });
  const loadMoreMutation = useMutation({
    mutationFn: () => fetchTaskPage(TASK_PAGE_SIZE, settings.gatewayToken, "summary", nextOffset),
    onSuccess: (page) => {
      setExtraTasks((current) => mergeTaskLists(current, page.tasks));
      setNextOffset((current) => current + TASK_PAGE_SIZE);
      setHasMorePages(page.has_more);
    },
    onError: (error: Error) => {
      setHint(t("works.loadMoreFailed", { message: error.message }));
    },
  });

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel || !hasMorePages || loadMoreMutation.isPending) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting && !loadMoreMutation.isPending) {
          loadMoreMutation.mutate();
        }
      },
      {
        rootMargin: "1200px 0px",
        threshold: 0.01,
      },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMorePages, loadMoreMutation, nextOffset]);

  function exitSelectMode() {
    setSelectMode(false);
    setCheckedIds(new Set());
  }

  const toggleChecked = (taskId: string) => {
    setCheckedIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  };

  const recordRatio = (taskId: string, ratio: number) => {
    if (!Number.isFinite(ratio) || ratio <= 0) {
      return;
    }
    setMeasuredRatios((current) => {
      const previous = current[taskId];
      if (previous != null && Math.abs(previous - ratio) < 0.01) {
        return current;
      }
      return { ...current, [taskId]: ratio };
    });
  };

  const sidebarActions = currentLightboxTask
    ? buildMediaSidebarActions({
        task: currentLightboxTask,
        t,
        deleteDisabled: deleteMutation.isPending,
        retryDisabled: retryMutation.isPending,
        showBothRetryActions: settings.showBothRetryActions,
        retryModeDefault: settings.retryModeDefault,
        supportsSeedRetry: providerSupportsSeedRetry(currentLightboxTask.provider),
        onDeleteConfirmed: () => {
          deleteMutation.mutate({
            taskId: currentLightboxTask.task_id,
            assetType: currentLightboxTask.asset_type,
            action: "delete",
          });
          setLightboxState(null);
        },
        onCancelConfirmed: () => {
          deleteMutation.mutate({
            taskId: currentLightboxTask.task_id,
            assetType: currentLightboxTask.asset_type,
            action: "cancel",
          });
        },
        onRetry: (mode) =>
          retryMutation.mutate({
            task: currentLightboxTask,
            mode,
          }),
      })
    : null;
  const retryActions =
    currentLightboxTask && queuedRetryTaskId === currentLightboxTask.task_id
      ? {
          disabled: true,
          defaultLabel: t("works.retryQueuedSticky"),
          onDefault: () => undefined,
        }
      : sidebarActions?.retryActions;

  const kindLabels: Record<BrowseFilter, string> = {
    all: t("works.filter.all"),
    image: t("works.kindImage"),
    video: t("works.kindVideo"),
  };
  const stageLabels: Record<StageFilter, string> = {
    all: t("works.filter.allStages"),
    draft: t("works.filter.draft"),
    final: t("works.filter.final"),
  };
  const kindTriggerLabel =
    browseFilter !== "all"
      ? kindLabels[browseFilter]
      : stageFilter !== "all"
        ? stageLabels[stageFilter]
        : kindLabels.all;
  const projectTriggerLabel =
    projectFilter === ALL_PROJECTS
      ? providerFilter !== "all"
        ? providerFilter
        : t("works.filter.project")
      : projectFilter === STANDALONE_PROJECT
        ? t("works.filter.standalone")
        : projectOptions.find((option) => option.id === projectFilter)?.title ?? t("works.filter.project");
  const checkedTasks = assetList.filter((task) => checkedIds.has(task.task_id));

  return (
    <div className="flex w-full flex-col">
      <HeaderActions mobileMenu>
        <button
          type="button"
          className={`btn-outline ${selectMode ? "btn-outline-active" : ""}`}
          onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
          disabled={!selectMode && !assetList.length}
        >
          {selectMode ? t("works.selectDone") : t("works.select")}
        </button>
      </HeaderActions>

      <header className="page-header">
        <div>
          <h1 className="page-title">{t("works.title")}</h1>
          <p className="page-subtitle">{t("works.subtitle")}</p>
        </div>
      </header>

      <div className="asset-toolbar">
        <label className="search-field flex-1">
          <MagnifyingGlass size={13} weight="regular" className="shrink-0" />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t("works.searchPlaceholder")}
            aria-label={t("works.searchPlaceholder")}
          />
        </label>
        <Dropdown label={kindTriggerLabel} highlighted={browseFilter !== "all" || stageFilter !== "all"}>
          {(close) => (
            <>
              <p className="menu-section-label">{t("works.filter.kind")}</p>
              {(["all", "image", "video"] as BrowseFilter[]).map((value) => (
                <DropdownOption
                  key={value}
                  label={kindLabels[value]}
                  meta={kindCounts[value]}
                  selected={browseFilter === value}
                  onSelect={() => {
                    setBrowseFilter(value);
                    close();
                  }}
                />
              ))}
              <div className="menu-divider" />
              <p className="menu-section-label">{t("works.filter.stage")}</p>
              {(["all", "draft", "final"] as StageFilter[]).map((value) => (
                <DropdownOption
                  key={value}
                  label={stageLabels[value]}
                  selected={stageFilter === value}
                  onSelect={() => {
                    setStageFilter(value);
                    close();
                  }}
                />
              ))}
            </>
          )}
        </Dropdown>
        <Dropdown label={sortOrder === "recent" ? t("works.filter.recent") : t("works.filter.oldest")}>
          {(close) => (
            <>
              <p className="menu-section-label">{t("works.filter.sort")}</p>
              {(["recent", "oldest"] as SortOrder[]).map((value) => (
                <DropdownOption
                  key={value}
                  label={value === "recent" ? t("works.filter.recent") : t("works.filter.oldest")}
                  selected={sortOrder === value}
                  onSelect={() => {
                    setSortOrder(value);
                    close();
                  }}
                />
              ))}
            </>
          )}
        </Dropdown>
        <Dropdown
          label={projectTriggerLabel}
          highlighted={projectFilter !== ALL_PROJECTS || providerFilter !== "all"}
        >
          {(close) => (
            <>
              <p className="menu-section-label">{t("works.filter.project")}</p>
              <DropdownOption
                label={t("works.filter.allProjects")}
                selected={projectFilter === ALL_PROJECTS}
                onSelect={() => {
                  setProjectFilter(ALL_PROJECTS);
                  close();
                }}
              />
              <DropdownOption
                label={t("works.filter.standalone")}
                selected={projectFilter === STANDALONE_PROJECT}
                onSelect={() => {
                  setProjectFilter(STANDALONE_PROJECT);
                  close();
                }}
              />
              {projectOptions.map((option) => (
                <DropdownOption
                  key={option.id}
                  label={option.title}
                  meta={option.count}
                  selected={projectFilter === option.id}
                  onSelect={() => {
                    setProjectFilter(option.id);
                    close();
                  }}
                />
              ))}
              {providerOptions.length > 1 ? (
                <>
                  <div className="menu-divider" />
                  <p className="menu-section-label">{t("works.filter.model")}</p>
                  <DropdownOption
                    label={t("works.allProviders")}
                    selected={providerFilter === "all"}
                    onSelect={() => {
                      setProviderFilter("all");
                      close();
                    }}
                  />
                  {providerOptions.map((provider) => (
                    <DropdownOption
                      key={provider}
                      label={provider}
                      selected={providerFilter === provider}
                      onSelect={() => {
                        setProviderFilter(provider);
                        close();
                      }}
                    />
                  ))}
                </>
              ) : null}
            </>
          )}
        </Dropdown>
      </div>

      {loading ? (
        <MosaicSkeleton />
      ) : gridTasks.length ? (
        <JustifiedGrid
          items={gridTasks}
          getKey={(task) => task.task_id}
          getRatio={(task) => measuredRatios[task.task_id] ?? inferTaskAspectRatio(task)}
          renderItem={(task, width, height, grow) => {
            const inProgress = task.status === "queued" || task.status === "running";
            return (
              <AssetTile
                key={task.task_id}
                task={task}
                width={width}
                height={height}
                grow={grow}
                t={t}
                ringed={selectMode ? checkedIds.has(task.task_id) : task.task_id === selectedTaskId}
                selectMode={selectMode && !inProgress}
                checked={checkedIds.has(task.task_id)}
                onMeasure={(ratio) => recordRatio(task.task_id, ratio)}
                cancelDisabled={deleteMutation.isPending}
                onCancel={() =>
                  deleteMutation.mutate({
                    taskId: task.task_id,
                    assetType: task.asset_type,
                    action: "cancel",
                  })
                }
                onClick={() => {
                  if (inProgress) {
                    return;
                  }
                  if (selectMode) {
                    toggleChecked(task.task_id);
                    return;
                  }
                  setSelectedTaskId(task.task_id);
                  if (task.asset_type === "video") {
                    openVideoLightbox(task.task_id);
                  } else {
                    openImageLightbox(task.task_id);
                  }
                }}
              />
            );
          }}
        />
      ) : (
        <EmptyStateWorks locale={locale} />
      )}

      {hasMorePages && !loading ? (
        <div ref={loadMoreSentinelRef} className="mt-6 flex justify-center">
          <button
            type="button"
            className="btn-outline"
            onClick={() => loadMoreMutation.mutate()}
            disabled={loadMoreMutation.isPending}
          >
            {loadMoreMutation.isPending ? t("works.loadingMore") : t("works.loadMore")}
          </button>
        </div>
      ) : null}

      {selectMode ? (
        <div className="select-bar" role="toolbar">
          <span className="tabular-nums text-[var(--c-text-secondary)]">
            {t("works.selectedCount", { count: checkedTasks.length })}
          </span>
          <button
            type="button"
            className="btn-ghost text-xs"
            onClick={() =>
              setCheckedIds(
                checkedTasks.length === assetList.length
                  ? new Set()
                  : new Set(assetList.map((task) => task.task_id)),
              )
            }
          >
            {checkedTasks.length === assetList.length ? t("works.selectNone") : t("works.selectAll")}
          </button>
          <button
            type="button"
            className="btn-danger text-xs"
            disabled={!checkedTasks.length || bulkDeleteMutation.isPending}
            onClick={() => {
              if (window.confirm(t("works.deleteSelectedConfirm", { count: checkedTasks.length }))) {
                bulkDeleteMutation.mutate(checkedTasks);
              }
            }}
          >
            {bulkDeleteMutation.isPending ? t("works.deleting") : t("works.deleteSelected")}
          </button>
        </div>
      ) : hint ? (
        <div className="select-bar pr-[18px]" role="status">
          <span className="text-[var(--c-text-secondary)]">{hint}</span>
        </div>
      ) : null}

      {lightboxItem && currentLightboxTask ? (
        <>
          <MediaOverlayFrame
            title={t("works.workPreview")}
            currentIndex={lightboxIndex}
            totalItems={lightboxItems.length}
            onClose={() => setLightboxState(null)}
            onExpandMedia={() => setIsMediaExpanded(true)}
            closeLabel={t("common.close")}
            media={
              <AppLightboxStage
                items={lightboxItems}
                index={lightboxIndex ?? 0}
                taskById={taskById}
                onIndexChange={(nextIndex) =>
                  setLightboxState((current) =>
                    current ? { ...current, index: nextIndex } : null,
                  )
                }
              />
            }
            mediaHint={
              currentLightboxOrientation === "portrait"
                ? t("works.portraitHint")
                : currentLightboxOrientation === "square"
                  ? t("works.squareHint")
                  : t("works.landscapeHint")
            }
            sidebar={
              <MediaDetailSidebar
                task={currentLightboxTask}
                versionTasks={versionTasks}
                onVersionSelect={(taskId) => {
                  const nextIndex = lightboxItems.findIndex((item) => item.taskId === taskId);
                  if (nextIndex >= 0) {
                    setLightboxState((current) => current ? { ...current, index: nextIndex } : current);
                  }
                }}
                statusLabel={formatOverlayTaskStatus(currentLightboxTask, t)}
                updatedAtLabel={formatTime(currentLightboxTask.updated_at, locale === "zh-CN" ? "zh-CN" : "en-US")}
                downloadUrl={lightboxItem.url}
                onReuse={() => {
                  reuseMutation.mutate({
                    task: currentLightboxTask,
                    imageIndex: lightboxItem.imageIndex ?? 0,
                    branch: false,
                  });
                }}
                reuseDisabled={reuseMutation.isPending}
                onBranch={() => {
                  reuseMutation.mutate({
                    task: currentLightboxTask,
                    imageIndex: lightboxItem.imageIndex ?? 0,
                    branch: true,
                  });
                }}
                onAdoptVersion={(taskId) => {
                  if (currentLightboxTask.generation_id) {
                    adoptMutation.mutate({ generationId: currentLightboxTask.generation_id, taskId });
                  }
                }}
                adoptDisabled={adoptMutation.isPending}
                gatewayToken={settings.gatewayToken}
                onDelete={sidebarActions?.onDelete ?? (() => undefined)}
                deleteDisabled={sidebarActions?.deleteDisabled}
                cancelAction={sidebarActions?.cancelAction}
                retryActions={retryActions}
                onCopyRequestJson={() => {
                  const payload = buildTaskRequestPayload(currentLightboxTask);
                  const text = JSON.stringify(payload, null, 2);
                  void copyText(text).then(
                    () => setHint(t("works.copyJsonSuccess")),
                    () => setHint(t("works.copyJsonFailed")),
                  );
                }}
                isRawResultOpen={isRawResultOpen}
                onRawResultOpenChange={setIsRawResultOpen}
                rawResultPending={taskDetailQuery.isPending}
                rawResultError={taskDetailQuery.error ? (taskDetailQuery.error as Error).message : null}
                rawResultPayload={rawResultPayload}
                errorText={
                  rawResultTask
                    ? errorMessage(rawResultTask, {
                        fallbackMessage: t("error.defaultFailure"),
                        providerRetryRecommendedMessage: t("error.providerRetryRecommended"),
                      })
                    : null
                }
              />
            }
          />
          {isMediaExpanded ? (
            <div
              className="fixed inset-0 z-[60] bg-[var(--c-overlay)] p-4 backdrop-blur-[4px]"
              role="dialog"
              aria-modal="true"
              onClick={() => setIsMediaExpanded(false)}
            >
              <div
                className="relative mx-auto flex h-full max-w-[min(96vw,1460px)] items-center justify-center"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  className="absolute right-2 top-2 z-10 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--c-overlay-chip)] text-[var(--c-on-media)] shadow-[var(--shadow-lg)]"
                  onClick={() => setIsMediaExpanded(false)}
                  aria-label={t("common.close")}
                  title={t("common.close")}
                >
                  ×
                </button>
                <div className="h-full w-full overflow-hidden rounded-2xl bg-[var(--c-overlay-panel)] p-3 shadow-[var(--shadow-overlay)] md:p-4">
                  <AppLightboxStage
                    items={lightboxItems}
                    index={lightboxIndex ?? 0}
                    taskById={taskById}
                    onIndexChange={(nextIndex) =>
                      setLightboxState((current) =>
                        current ? { ...current, index: nextIndex } : null,
                      )
                    }
                  />
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/* ── Justified mosaic ───────────────────────────────── */

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    setWidth(element.clientWidth);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setWidth(Math.floor(entry.contentRect.width));
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}

function targetRowHeight(width: number): number {
  if (width >= 1200) return 230;
  if (width >= 880) return 200;
  if (width >= 600) return 170;
  return 130;
}

function JustifiedGrid<T>({
  items,
  getKey,
  getRatio,
  renderItem,
}: {
  items: T[];
  getKey: (item: T) => string;
  getRatio: (item: T) => number;
  renderItem: (item: T, width: number, height: number, grow: boolean) => ReactNode;
}) {
  const [containerRef, width] = useElementWidth<HTMLDivElement>();

  const rows = useMemo(() => {
    if (!width) {
      return [];
    }
    const target = targetRowHeight(width);
    const result: Array<{ key: string; height: number; full: boolean; cells: Array<{ item: T; width: number }> }> = [];
    let pending: Array<{ item: T; ratio: number }> = [];
    let ratioSum = 0;

    const flush = (full: boolean) => {
      if (!pending.length) {
        return;
      }
      const gaps = GRID_GAP * (pending.length - 1);
      const height = full ? (width - gaps) / ratioSum : Math.min(target, (width - gaps) / ratioSum);
      result.push({
        key: getKey(pending[0].item),
        height,
        full,
        cells: pending.map(({ item, ratio }) => ({ item, width: Math.floor(ratio * height) })),
      });
      pending = [];
      ratioSum = 0;
    };

    for (const item of items) {
      const ratio = Math.min(Math.max(getRatio(item), 0.5), 2.6);
      pending.push({ item, ratio });
      ratioSum += ratio;
      if (ratioSum * target + GRID_GAP * (pending.length - 1) >= width) {
        flush(true);
      }
    }
    flush(false);
    return result;
  }, [getKey, getRatio, items, width]);

  return (
    <div ref={containerRef} className="w-full">
      {rows.map((row) => (
        <div key={row.key} className="asset-row" style={{ height: row.height }}>
          {row.cells.map((cell, index) =>
            renderItem(cell.item, cell.width, row.height, row.full && index === row.cells.length - 1),
          )}
        </div>
      ))}
    </div>
  );
}

function AssetTile({
  task,
  width,
  height,
  grow,
  t,
  ringed,
  selectMode,
  checked,
  onClick,
  onMeasure,
  onCancel,
  cancelDisabled,
}: {
  task: VideoTaskDetail;
  width: number;
  height: number;
  grow: boolean;
  t: TranslateFn;
  ringed: boolean;
  selectMode: boolean;
  checked: boolean;
  onClick: () => void;
  onMeasure: (ratio: number) => void;
  onCancel: () => void;
  cancelDisabled: boolean;
}) {
  const [hasError, setHasError] = useState(false);
  const inProgress = task.status === "queued" || task.status === "running";
  const isVideo = task.asset_type === "video";
  const thumb = extractImageUrls(task)[0] ?? null;
  const poster = isVideo ? extractVideoPoster(task) ?? thumb : thumb;

  let content: ReactNode;
  if (inProgress) {
    content = (
      <div className="asset-tile-state">
        <CircleNotch size={18} className="animate-spin text-[var(--c-accent)]" />
        <span>
          {task.status === "queued"
            ? task.queue_position
              ? t("works.queuedTileWithPosition", { position: task.queue_position })
              : t("works.queuedTile")
            : t("works.runningTile")}
        </span>
        <span
          role="button"
          tabIndex={0}
          className={`btn-outline mt-1 ${cancelDisabled ? "pointer-events-none opacity-40" : ""}`}
          onClick={(event) => {
            event.stopPropagation();
            onCancel();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              onCancel();
            }
          }}
        >
          {t("works.cancelInProgress")}
        </span>
      </div>
    );
  } else if (task.status === "failed") {
    content = (
      <div className="asset-tile-state bg-[var(--c-error-bg)] text-[var(--c-error-text)]">
        <WarningCircle size={18} />
        <span>{t("works.generationFailed")}</span>
      </div>
    );
  } else if (poster && !hasError) {
    content = (
      <img
        src={poster}
        alt={task.prompt?.slice(0, 80) || task.task_id}
        loading="lazy"
        decoding="async"
        draggable={false}
        onLoad={(event) => {
          const image = event.currentTarget;
          if (image.naturalWidth && image.naturalHeight) {
            onMeasure(image.naturalWidth / image.naturalHeight);
          }
        }}
        onError={() => setHasError(true)}
      />
    );
  } else if (isVideo) {
    content = (
      <div className="asset-tile-state">
        <Play size={18} weight="fill" />
        <span>{t("works.kindVideo")}</span>
      </div>
    );
  } else {
    content = (
      <div className="asset-tile-state bg-[var(--c-warning-bg)] text-[var(--c-warning-text)]">
        <WarningCircle size={18} />
        <span>{t("works.resourceExpired")}</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      className={`asset-tile media-ring ${ringed ? "media-ring-active" : ""} ${inProgress ? "cursor-default" : ""}`}
      style={grow ? { flex: "1 1 0", minWidth: 0, height } : { width, height }}
      onClick={onClick}
      aria-label={task.prompt?.slice(0, 80) || task.task_id}
      aria-pressed={selectMode ? checked : undefined}
    >
      <div className="asset-tile-media">{content}</div>
      {isVideo && !inProgress && task.status !== "failed" ? (
        <span className="asset-tile-badge">
          <Play size={11} weight="fill" />
        </span>
      ) : null}
      {selectMode ? (
        <span className={`asset-tile-check ${checked ? "asset-tile-check-on" : ""}`}>
          {checked ? <Check size={11} weight="bold" /> : null}
        </span>
      ) : null}
    </button>
  );
}

function MosaicSkeleton() {
  const rows = [
    [1.7, 1.4, 1.45],
    [1.1, 1.3, 0.8, 1.6],
    [1.4, 1.1, 1.2],
  ];
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      {rows.map((row, rowIndex) => (
        <div key={rowIndex} className="flex h-[180px] gap-2">
          {row.map((grow, index) => (
            <div key={index} className="skeleton h-full" style={{ flex: `${grow} 1 0` }} />
          ))}
        </div>
      ))}
    </div>
  );
}

function mergeTaskLists(
  baseTasks: VideoTaskDetail[],
  nextTasks: VideoTaskDetail[],
): VideoTaskDetail[] {
  const byId = new Map<string, VideoTaskDetail>();
  for (const task of [...baseTasks, ...nextTasks]) {
    byId.set(task.task_id, task);
  }
  return Array.from(byId.values()).sort(
    (left, right) => Date.parse(right.created_at) - Date.parse(left.created_at),
  );
}

function inferHasMorePages(tasks: VideoTaskDetail[]): boolean {
  const imageCount = tasks.filter((task) => task.asset_type === "image").length;
  const videoCount = tasks.filter((task) => task.asset_type === "video").length;
  return imageCount >= TASK_PAGE_SIZE || videoCount >= TASK_PAGE_SIZE;
}
