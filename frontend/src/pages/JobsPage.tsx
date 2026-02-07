import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { deleteVideoTask, retryVideoTask } from "../api";
import { useI18n } from "../i18n";
import { useAppSettingsStore } from "../state";
import type { RetryMode, VideoTaskDetail } from "../types";
import {
  errorMessage,
  extractVideoUrl,
  formatTime,
} from "../utils";

interface Props {
  tasks: VideoTaskDetail[];
  loading: boolean;
}

const JOB_FILTERS_KEY = "scenewords_jobs_filters_v1";

interface JobsFilterSnapshot {
  segment: "in_progress" | "history";
  searchKeyword: string;
  providerFilter: string;
  statusFilter: string;
  dateFrom: string;
  dateTo: string;
}

export function JobsPage(props: Props) {
  const { tasks, loading } = props;
  const { locale, t } = useI18n();
  const settings = useAppSettingsStore();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const savedFilters = useMemo(() => readFilters(), []);

  const [segment, setSegment] = useState<"in_progress" | "history">(savedFilters.segment);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [retryPrompt, setRetryPrompt] = useState("");
  const [playerTaskId, setPlayerTaskId] = useState<string | null>(null);
  const [hint, setHint] = useState("");
  const [searchKeyword, setSearchKeyword] = useState(savedFilters.searchKeyword);
  const [providerFilter, setProviderFilter] = useState(savedFilters.providerFilter);
  const [statusFilter, setStatusFilter] = useState(savedFilters.statusFilter);
  const [dateFrom, setDateFrom] = useState(savedFilters.dateFrom);
  const [dateTo, setDateTo] = useState(savedFilters.dateTo);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.task_id === selectedTaskId) ?? null,
    [selectedTaskId, tasks],
  );

  useEffect(() => {
    if (selectedTask) {
      setRetryPrompt(selectedTask.prompt ?? "");
    }
  }, [selectedTask?.task_id]);

  useEffect(() => {
    if (!playerTaskId || !videoRef.current) {
      return;
    }
    void videoRef.current.play().catch(() => undefined);
    const parent = videoRef.current.parentElement;
    if (parent) {
      void parent.requestFullscreen().catch(() => undefined);
    }
  }, [playerTaskId]);

  const retryMutation = useMutation({
    mutationFn: async (payload: { taskId: string; mode: RetryMode; prompt: string }) =>
      retryVideoTask(
        payload.taskId,
        payload.mode,
        payload.prompt.trim() || null,
        settings.gatewayToken,
      ),
    onSuccess: async (response) => {
      setHint(t("jobs.retryQueued", { taskId: response.task_id.slice(0, 8) }));
      await queryClient.invalidateQueries({ queryKey: ["tasks", settings.gatewayToken] });
    },
    onError: (error: Error) => {
      setHint(t("jobs.retryFailed", { message: error.message }));
    },
  });
  const deleteMutation = useMutation({
    mutationFn: async (taskId: string) => deleteVideoTask(taskId, settings.gatewayToken),
    onSuccess: async (_data, taskId) => {
      setHint(t("jobs.deleteSuccess", { taskId: taskId.slice(0, 8) }));
      setSelectedTaskId((current) => (current === taskId ? null : current));
      setPlayerTaskId((current) => (current === taskId ? null : current));
      await queryClient.invalidateQueries({ queryKey: ["tasks", settings.gatewayToken] });
    },
    onError: (error: Error) => {
      setHint(t("jobs.deleteFailed", { message: error.message }));
    },
  });

  const providerOptions = useMemo(
    () => ["all", ...Array.from(new Set(tasks.map((task) => task.provider))).sort()],
    [tasks],
  );

  useEffect(() => {
    if (providerFilter !== "all" && !providerOptions.includes(providerFilter)) {
      setProviderFilter("all");
    }
  }, [providerFilter, providerOptions]);

  useEffect(() => {
    writeFilters({
      segment,
      searchKeyword,
      providerFilter,
      statusFilter,
      dateFrom,
      dateTo,
    });
  }, [dateFrom, dateTo, providerFilter, searchKeyword, segment, statusFilter]);

  const baseList = tasks.filter((task) => {
    if (segment === "in_progress") {
      return task.status === "queued" || task.status === "running";
    }
    return task.status !== "queued" && task.status !== "running";
  });
  const taskList = baseList.filter((task) =>
    passesFilters(task, {
      searchKeyword,
      providerFilter,
      statusFilter,
      dateFrom,
      dateTo,
    }),
  );

  useEffect(() => {
    if (!taskList.length) {
      setSelectedTaskId(null);
      return;
    }
    if (!selectedTaskId || !taskList.some((task) => task.task_id === selectedTaskId)) {
      setSelectedTaskId(taskList[0].task_id);
    }
  }, [selectedTaskId, taskList]);

  const playerTask = tasks.find((task) => task.task_id === playerTaskId) ?? null;
  const playerUrl = playerTask ? extractVideoUrl(playerTask) : null;
  const mapErrorCode = (code: string): string | null => {
    const key = `error.${code}`;
    const translated = t(key);
    return translated === key ? null : translated;
  };
  const statusLabel = (status: string): string => {
    const key = `status.${status}`;
    const translated = t(key);
    return translated === key ? status : translated;
  };
  const formatLocalizedStatus = (task: VideoTaskDetail): string => {
    if (task.status === "queued" && task.queue_position != null) {
      return t("jobs.statusQueuedWithPosition", { position: task.queue_position });
    }
    return statusLabel(task.status);
  };
  const canDeleteSelectedTask =
    selectedTask != null &&
    selectedTask.status !== "queued" &&
    selectedTask.status !== "running";

  if (loading) {
    return <section className="panel">{t("jobs.loading")}</section>;
  }

  return (
    <section className="panel jobs-layout">
      <div className="panel-header">
        <h2>{t("jobs.title")}</h2>
        <p>{t("jobs.subtitle")}</p>
      </div>

      <div className="segment-control">
        <button
          type="button"
          className={segment === "in_progress" ? "segment active" : "segment"}
          onClick={() => setSegment("in_progress")}
        >
          {t("common.inProgress")}
        </button>
        <button
          type="button"
          className={segment === "history" ? "segment active" : "segment"}
          onClick={() => setSegment("history")}
        >
          {t("common.history")}
        </button>
      </div>

      <div className="jobs-filters">
        <input
          value={searchKeyword}
          onChange={(event) => setSearchKeyword(event.target.value)}
          placeholder={t("jobs.searchPlaceholder")}
        />
        <select
          value={providerFilter}
          onChange={(event) => setProviderFilter(event.target.value)}
        >
          {providerOptions.map((provider) => (
            <option key={provider} value={provider}>
              {provider === "all" ? t("jobs.allProviders") : provider}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
        >
          <option value="all">{t("jobs.allStatus")}</option>
          <option value="queued">{statusLabel("queued")}</option>
          <option value="running">{statusLabel("running")}</option>
          <option value="succeeded">{statusLabel("succeeded")}</option>
          <option value="failed">{statusLabel("failed")}</option>
          <option value="canceled">{statusLabel("canceled")}</option>
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={(event) => setDateFrom(event.target.value)}
        />
        <input
          type="date"
          value={dateTo}
          onChange={(event) => setDateTo(event.target.value)}
        />
        <button
          type="button"
          onClick={() => {
            setSearchKeyword("");
            setProviderFilter("all");
            setStatusFilter("all");
            setDateFrom("");
            setDateTo("");
          }}
        >
          {t("jobs.clearFilters")}
        </button>
      </div>

      <div className="jobs-main">
        <ul className="job-list">
          {taskList.map((task) => (
            <li
              key={task.task_id}
              className={task.task_id === selectedTaskId ? "job-card active" : "job-card"}
              onClick={() => setSelectedTaskId(task.task_id)}
            >
              <div className="job-head">
                <strong>{task.task_id.slice(0, 8)}</strong>
                <span className={`status ${task.status}`}>{formatLocalizedStatus(task)}</span>
              </div>
              <p className="job-meta">
                {task.provider} / {task.model} / {task.operation ?? "generate"}
              </p>
              <p className="job-prompt">{task.prompt || t("jobs.emptyPrompt")}</p>
              <p className="job-meta">
                {t("jobs.seed")} {task.seed ?? "-"} ·{" "}
                {formatTime(task.updated_at, locale === "zh-CN" ? "zh-CN" : "en-US")}
              </p>
              {task.status === "failed" &&
              errorMessage(task, {
                mapErrorCode,
                fallbackMessage: t("error.defaultFailure"),
              }) ? (
                <p className="error-text">
                  {errorMessage(task, {
                    mapErrorCode,
                    fallbackMessage: t("error.defaultFailure"),
                  })}
                </p>
              ) : null}
            </li>
          ))}
        </ul>

        <aside className="job-detail">
          {selectedTask ? (
            <>
              <h3>{t("jobs.detail")}</h3>
              <p className="job-meta">
                {selectedTask.task_id} · {formatLocalizedStatus(selectedTask)}
              </p>
              <p className="job-meta">
                {t("jobs.cost")}{" "}
                {settings.showActualCostPostDone && selectedTask.actual_cost != null
                  ? `${selectedTask.actual_cost.toFixed(3)} ${selectedTask.currency ?? settings.currency}`
                  : selectedTask.estimated_cost != null
                    ? `${selectedTask.estimated_cost.toFixed(3)} ${selectedTask.currency ?? settings.currency} ${t("jobs.estimatedSuffix")}`
                    : t("common.na")}
              </p>
              <label>
                {t("jobs.retryPrompt")}
                <textarea
                  rows={4}
                  value={retryPrompt}
                  onChange={(event) => setRetryPrompt(event.target.value)}
                />
              </label>
              <div className="job-actions">
                <button
                  type="button"
                  onClick={() => {
                    settings.setPendingReuseDraft(toDraft(selectedTask));
                    navigate("/create");
                  }}
                >
                  {t("jobs.reuseSettings")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    settings.setPendingReuseDraft(toDraftWithPrompt(selectedTask, retryPrompt));
                    navigate("/create");
                  }}
                >
                  {t("jobs.refillInCreate")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const payload = buildTaskRequestPayload(selectedTask, retryPrompt);
                    const text = JSON.stringify(payload, null, 2);
                    void copyText(text).then(
                      () => setHint(t("jobs.copyJsonSuccess")),
                      () => setHint(t("jobs.copyJsonFailed")),
                    );
                  }}
                >
                  {t("jobs.copyRequestJson")}
                </button>
                {canDeleteSelectedTask ? (
                  <button
                    type="button"
                    className="danger-button"
                    onClick={() => {
                      if (!selectedTask) {
                        return;
                      }
                      const confirmed = window.confirm(
                        t("jobs.deleteConfirm", {
                          taskId: selectedTask.task_id.slice(0, 8),
                        }),
                      );
                      if (!confirmed) {
                        return;
                      }
                      deleteMutation.mutate(selectedTask.task_id);
                    }}
                    disabled={deleteMutation.isPending}
                  >
                    {t("jobs.delete")}
                  </button>
                ) : null}
                {settings.showBothRetryActions ? (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        retryMutation.mutate({
                          taskId: selectedTask.task_id,
                          mode: "same_seed",
                          prompt: retryPrompt,
                        })
                      }
                      disabled={retryMutation.isPending}
                    >
                      {t("common.retrySameSeed")}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        retryMutation.mutate({
                          taskId: selectedTask.task_id,
                          mode: "new_seed",
                          prompt: retryPrompt,
                        })
                      }
                      disabled={retryMutation.isPending}
                    >
                      {t("common.retryNewSeed")}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      retryMutation.mutate({
                        taskId: selectedTask.task_id,
                        mode: settings.retryModeDefault,
                        prompt: retryPrompt,
                      })
                    }
                    disabled={retryMutation.isPending}
                  >
                    {t("jobs.retry", {
                      mode:
                        settings.retryModeDefault === "same_seed"
                          ? t("settings.sameSeed")
                          : t("settings.newSeed"),
                    })}
                  </button>
                )}
                {extractVideoUrl(selectedTask) ? (
                  <button type="button" onClick={() => setPlayerTaskId(selectedTask.task_id)}>
                    {t("jobs.fullscreenPlay")}
                  </button>
                ) : null}
              </div>
              {errorMessage(selectedTask, {
                mapErrorCode,
                fallbackMessage: t("error.defaultFailure"),
              }) ? (
                <p className="error-text">
                  {errorMessage(selectedTask, {
                    mapErrorCode,
                    fallbackMessage: t("error.defaultFailure"),
                  })}
                </p>
              ) : null}
              <details>
                <summary>{t("jobs.rawResult")}</summary>
                <pre>{JSON.stringify(selectedTask.result, null, 2)}</pre>
              </details>
            </>
          ) : (
            <p className="hint">{t("jobs.selectHint")}</p>
          )}
        </aside>
      </div>

      <p className="hint">{hint}</p>

      {playerTask && playerUrl ? (
        <div className="player-block">
          <div className="player-head">
            <strong>{playerTask.task_id.slice(0, 8)}</strong>
            <button type="button" onClick={() => setPlayerTaskId(null)}>
              {t("common.close")}
            </button>
          </div>
          <div className="video-shell">
            <video ref={videoRef} controls autoPlay playsInline src={playerUrl} />
          </div>
        </div>
      ) : null}
    </section>
  );
}

function readFilters(): JobsFilterSnapshot {
  const defaults: JobsFilterSnapshot = {
    segment: "in_progress",
    searchKeyword: "",
    providerFilter: "all",
    statusFilter: "all",
    dateFrom: "",
    dateTo: "",
  };
  const raw = localStorage.getItem(JOB_FILTERS_KEY);
  if (!raw) {
    return defaults;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<JobsFilterSnapshot>;
    const segment =
      parsed.segment === "history" || parsed.segment === "in_progress"
        ? parsed.segment
        : defaults.segment;
    return {
      segment,
      searchKeyword: typeof parsed.searchKeyword === "string" ? parsed.searchKeyword : "",
      providerFilter: typeof parsed.providerFilter === "string" ? parsed.providerFilter : "all",
      statusFilter: typeof parsed.statusFilter === "string" ? parsed.statusFilter : "all",
      dateFrom: typeof parsed.dateFrom === "string" ? parsed.dateFrom : "",
      dateTo: typeof parsed.dateTo === "string" ? parsed.dateTo : "",
    };
  } catch {
    return defaults;
  }
}

function writeFilters(snapshot: JobsFilterSnapshot): void {
  localStorage.setItem(JOB_FILTERS_KEY, JSON.stringify(snapshot));
}

function passesFilters(
  task: VideoTaskDetail,
  filters: {
    searchKeyword: string;
    providerFilter: string;
    statusFilter: string;
    dateFrom: string;
    dateTo: string;
  },
): boolean {
  if (filters.providerFilter !== "all" && task.provider !== filters.providerFilter) {
    return false;
  }
  if (filters.statusFilter !== "all" && task.status !== filters.statusFilter) {
    return false;
  }
  if (filters.searchKeyword.trim()) {
    const keyword = filters.searchKeyword.trim().toLowerCase();
    const haystack = [
      task.task_id,
      task.prompt ?? "",
      task.provider,
      task.model,
      task.operation ?? "",
    ]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(keyword)) {
      return false;
    }
  }
  const taskTs = Date.parse(task.updated_at);
  if (Number.isFinite(taskTs)) {
    if (filters.dateFrom) {
      const fromTs = Date.parse(`${filters.dateFrom}T00:00:00`);
      if (Number.isFinite(fromTs) && taskTs < fromTs) {
        return false;
      }
    }
    if (filters.dateTo) {
      const toTs = Date.parse(`${filters.dateTo}T23:59:59`);
      if (Number.isFinite(toTs) && taskTs > toTs) {
        return false;
      }
    }
  }
  return true;
}

function toDraft(task: VideoTaskDetail) {
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

function toDraftWithPrompt(task: VideoTaskDetail, prompt: string) {
  return {
    ...toDraft(task),
    prompt: prompt.trim() || task.prompt,
  };
}

function buildTaskRequestPayload(task: VideoTaskDetail, prompt: string) {
  return {
    provider: task.provider,
    model: task.model,
    operation: task.operation ?? "generate",
    prompt: prompt.trim() || task.prompt,
    negative_prompt: task.negative_prompt,
    duration_sec: task.duration_sec,
    resolution: task.resolution,
    fps: task.fps,
    seed: task.seed,
    provider_options: task.provider_options ?? {},
  };
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    const success = document.execCommand("copy");
    if (!success) {
      throw new Error("copy command failed");
    }
  } finally {
    document.body.removeChild(textarea);
  }
}
