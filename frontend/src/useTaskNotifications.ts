import { useEffect, useRef } from "react";
import { useI18n, type TranslateFn } from "./i18n";
import type { TaskStatus, VideoTaskDetail } from "./types";

const BATCH_WINDOW_MS = 3500;

export interface TaskToastNotice {
  level: "success" | "failure";
  title: string;
  body: string;
}

interface UseTaskNotificationsOptions {
  tasks: VideoTaskDetail[];
  enabledSuccess: boolean;
  enabledFailure: boolean;
  soundEnabled: boolean;
  currentPath: string;
  onToast: (notice: TaskToastNotice) => void;
  onUnreadIncrement?: (delta: number) => void;
}

interface PendingBatch {
  successCount: number;
  failureCount: number;
  successSample: VideoTaskDetail | null;
  failureSample: VideoTaskDetail | null;
}

interface RuntimeOptions {
  enabledSuccess: boolean;
  enabledFailure: boolean;
  soundEnabled: boolean;
  currentPath: string;
  onToast: (notice: TaskToastNotice) => void;
  onUnreadIncrement?: (delta: number) => void;
  t: TranslateFn;
}

export function useTaskNotifications(options: UseTaskNotificationsOptions): void {
  const { t } = useI18n();
  const previous = useRef<Map<string, TaskStatus>>(new Map());
  const initialized = useRef(false);
  const pending = useRef<PendingBatch>(emptyBatch());
  const timerId = useRef<number | null>(null);
  const runtime = useRef<RuntimeOptions>({
    enabledSuccess: options.enabledSuccess,
    enabledFailure: options.enabledFailure,
    soundEnabled: options.soundEnabled,
    currentPath: options.currentPath,
    onToast: options.onToast,
    onUnreadIncrement: options.onUnreadIncrement,
    t,
  });

  runtime.current = {
    enabledSuccess: options.enabledSuccess,
    enabledFailure: options.enabledFailure,
    soundEnabled: options.soundEnabled,
    currentPath: options.currentPath,
    onToast: options.onToast,
    onUnreadIncrement: options.onUnreadIncrement,
    t,
  };

  const flushPending = () => {
    const snapshot = pending.current;
    if (!snapshot.successCount && !snapshot.failureCount) {
      return;
    }
    pending.current = emptyBatch();

    const currentRuntime = runtime.current;
    const summary = buildSummary(snapshot, currentRuntime.t);
    const foreground =
      typeof document === "undefined" ? true : document.visibilityState === "visible";
    const onJobsPage = isJobsPath(currentRuntime.currentPath);

    let systemNotificationShown = false;
    if (foreground) {
      currentRuntime.onToast(summary);
    } else {
      systemNotificationShown = showSystemNotification(
        summary.title,
        summary.body,
        currentRuntime.soundEnabled,
      );
    }

    const shouldPlayForegroundTone = foreground && !onJobsPage;
    const shouldPlayBackgroundFallbackTone = !foreground && !systemNotificationShown;
    if (currentRuntime.soundEnabled && (shouldPlayForegroundTone || shouldPlayBackgroundFallbackTone)) {
      playNotificationTone(summary.level);
    }

    if (currentRuntime.onUnreadIncrement && (!foreground || !onJobsPage)) {
      currentRuntime.onUnreadIncrement(snapshot.successCount + snapshot.failureCount);
    }
  };

  const scheduleFlush = () => {
    if (timerId.current != null) {
      return;
    }
    timerId.current = window.setTimeout(() => {
      timerId.current = null;
      flushPending();
    }, BATCH_WINDOW_MS);
  };

  useEffect(() => {
    const current = new Map(options.tasks.map((task) => [task.task_id, task.status]));
    if (!initialized.current) {
      initialized.current = true;
      previous.current = current;
      return;
    }

    let changed = false;
    for (const task of options.tasks) {
      const oldStatus = previous.current.get(task.task_id);
      if (!oldStatus || oldStatus === task.status) {
        continue;
      }
      if (oldStatus !== "queued" && oldStatus !== "running") {
        continue;
      }
      if (task.status === "succeeded" && runtime.current.enabledSuccess) {
        pending.current.successCount += 1;
        pending.current.successSample = pending.current.successSample ?? task;
        changed = true;
      }
      if (task.status === "failed" && runtime.current.enabledFailure) {
        pending.current.failureCount += 1;
        pending.current.failureSample = pending.current.failureSample ?? task;
        changed = true;
      }
    }

    if (changed) {
      scheduleFlush();
    }

    previous.current = current;
  }, [options.tasks]);

  useEffect(
    () => () => {
      if (timerId.current != null) {
        window.clearTimeout(timerId.current);
        timerId.current = null;
      }
    },
    [],
  );
}

function emptyBatch(): PendingBatch {
  return {
    successCount: 0,
    failureCount: 0,
    successSample: null,
    failureSample: null,
  };
}

function isJobsPath(path: string): boolean {
  return path === "/assets" || path === "/jobs";
}

function buildSummary(batch: PendingBatch, t: TranslateFn): TaskToastNotice {
  if (batch.failureCount > 0) {
    if (batch.failureCount === 1 && batch.successCount === 0 && batch.failureSample) {
      const assetType =
        batch.failureSample.asset_type === "image"
          ? t("notify.assetImage")
          : t("notify.assetVideo");
      return {
        level: "failure",
        title: t("notify.generationFailedTitle"),
        body: t("notify.taskFailedBody", {
          assetType,
          taskId: batch.failureSample.task_id.slice(0, 8),
        }),
      };
    }
    return {
      level: "failure",
      title: t("notify.tasksFailedTitle"),
      body:
        batch.successCount > 0
          ? t("notify.tasksMixedBody", {
              successCount: batch.successCount,
              failureCount: batch.failureCount,
            })
          : t("notify.tasksFailedBody", { count: batch.failureCount }),
    };
  }

  if (batch.successCount === 1 && batch.successSample) {
    return {
      level: "success",
      title:
        batch.successSample.asset_type === "image"
          ? t("notify.imageReadyTitle")
          : t("notify.videoReadyTitle"),
      body: t("notify.taskReadyBody", {
        provider: batch.successSample.provider,
        model: batch.successSample.model,
        taskId: batch.successSample.task_id.slice(0, 8),
      }),
    };
  }

  return {
    level: "success",
    title: t("notify.tasksSucceededTitle"),
    body: t("notify.tasksSucceededBody", { count: batch.successCount }),
  };
}

function showSystemNotification(title: string, body: string, soundEnabled: boolean): boolean {
  if (!("Notification" in window)) {
    return false;
  }
  if (Notification.permission !== "granted") {
    return false;
  }
  const notice = new Notification(title, {
    body,
    silent: !soundEnabled,
  });
  notice.onclick = () => {
    window.focus();
    window.location.hash = "#/assets";
  };
  return true;
}

function playNotificationTone(level: "success" | "failure"): void {
  const audioContextType =
    window.AudioContext ??
    (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!audioContextType) {
    return;
  }

  const context = new audioContextType();
  const gain = context.createGain();
  gain.connect(context.destination);

  const frequencies = level === "failure" ? [360, 240] : [700, 880];
  const base = context.currentTime;

  frequencies.forEach((frequency, index) => {
    const start = base + index * 0.12;
    const stop = start + 0.1;
    const oscillator = context.createOscillator();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    oscillator.connect(gain);

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.045, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, stop);

    oscillator.start(start);
    oscillator.stop(stop);
  });

  void context.resume();
  window.setTimeout(() => {
    void context.close();
  }, 500);
}
