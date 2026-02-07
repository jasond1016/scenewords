import { useEffect, useRef } from "react";
import type { TaskStatus, VideoTaskDetail } from "./types";

export function useTaskNotifications(
  tasks: VideoTaskDetail[],
  enabledSuccess: boolean,
  enabledFailure: boolean,
  soundEnabled: boolean,
): void {
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
        notify("Video ready", `${task.provider} / ${task.model} / ${task.task_id.slice(0, 8)}`, soundEnabled);
      }
      if (task.status === "failed" && enabledFailure) {
        notify("Generation failed", task.task_id.slice(0, 8), soundEnabled);
      }
    }

    previous.current = current;
  }, [enabledFailure, enabledSuccess, soundEnabled, tasks]);
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
