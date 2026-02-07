import { useEffect, useRef } from "react";
import { useI18n } from "./i18n";
import type { TaskStatus, VideoTaskDetail } from "./types";

export function useTaskNotifications(
  tasks: VideoTaskDetail[],
  enabledSuccess: boolean,
  enabledFailure: boolean,
  soundEnabled: boolean,
): void {
  const { t } = useI18n();
  const previous = useRef<Map<string, TaskStatus>>(new Map());
  const initialized = useRef(false);

  useEffect(() => {
    const current = new Map(tasks.map((task) => [task.task_id, task.status]));
    if (!initialized.current) {
      initialized.current = true;
      previous.current = current;
      return;
    }

    for (const task of tasks) {
      const oldStatus = previous.current.get(task.task_id);
      if (!oldStatus || oldStatus === task.status) {
        continue;
      }
      const fromActive = oldStatus === "queued" || oldStatus === "running";
      if (!fromActive) {
        continue;
      }
      if (task.status === "succeeded" && enabledSuccess) {
        notify(
          t("notify.videoReadyTitle"),
          t("notify.videoReadyBody", {
            provider: task.provider,
            model: task.model,
            taskId: task.task_id.slice(0, 8),
          }),
          soundEnabled,
        );
      }
      if (task.status === "failed" && enabledFailure) {
        notify(t("notify.generationFailedTitle"), task.task_id.slice(0, 8), soundEnabled);
      }
    }

    previous.current = current;
  }, [enabledFailure, enabledSuccess, soundEnabled, t, tasks]);
}

function notify(title: string, body: string, soundEnabled: boolean): void {
  if (!("Notification" in window)) {
    return;
  }
  if (Notification.permission !== "granted") {
    return;
  }
  const notice = new Notification(title, {
    body,
    silent: !soundEnabled,
  });
  notice.onclick = () => {
    window.focus();
    window.location.hash = "#/jobs";
  };
}
