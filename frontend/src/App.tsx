import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchCatalog, fetchPricing, fetchTasks } from "./api";
import { useI18n } from "./i18n";
import { useAppSettingsStore } from "./state";
import { useTaskNotifications, type TaskToastNotice } from "./useTaskNotifications";
import { CreatePage } from "./pages/CreatePage";
import { JobsPage } from "./pages/JobsPage";
import { SettingsPage } from "./pages/SettingsPage";

const TASK_POLL_INTERVAL_MS = 4000;
const TOAST_TTL_MS = 5200;

interface ToastItem extends TaskToastNotice {
  id: string;
}

export default function App() {
  const { locale, t } = useI18n();
  const settings = useAppSettingsStore();
  const location = useLocation();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [visibility, setVisibility] = useState<"visible" | "hidden">(
    typeof document !== "undefined" && document.visibilityState === "hidden" ? "hidden" : "visible",
  );
  const tasksQuery = useQuery({
    queryKey: ["tasks", settings.gatewayToken],
    queryFn: () => fetchTasks(60, settings.gatewayToken),
    refetchInterval: TASK_POLL_INTERVAL_MS,
  });
  const catalogQuery = useQuery({
    queryKey: ["catalog", settings.gatewayToken],
    queryFn: () => fetchCatalog(settings.gatewayToken),
  });
  const pricingQuery = useQuery({
    queryKey: ["pricing", settings.gatewayToken],
    queryFn: () => fetchPricing(settings.gatewayToken),
  });
  const inProgressCount = useMemo(
    () =>
      (tasksQuery.data ?? []).filter(
        (task) => task.status === "queued" || task.status === "running",
      ).length,
    [tasksQuery.data],
  );
  const hasGatewayToken = settings.gatewayToken.trim().length > 0;

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const pushToast = useCallback((notice: TaskToastNotice) => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    setToasts((current) => [...current, { ...notice, id }].slice(-4));
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, TOAST_TTL_MS);
  }, []);

  useTaskNotifications({
    tasks: tasksQuery.data ?? [],
    enabledSuccess: settings.notifyOnSuccess,
    enabledFailure: settings.notifyOnFailure,
    soundEnabled: settings.notifySound,
    currentPath: location.pathname,
    onToast: pushToast,
    onUnreadIncrement: settings.notifyBadge
      ? (delta) => setUnreadCount((current) => current + delta)
      : undefined,
  });

  useEffect(() => {
    const onVisibilityChange = () => {
      setVisibility(document.visibilityState === "hidden" ? "hidden" : "visible");
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useEffect(() => {
    if (
      location.pathname !== "/works" &&
      location.pathname !== "/assets" &&
      location.pathname !== "/jobs"
    ) {
      return;
    }
    if (visibility !== "visible") {
      return;
    }
    setUnreadCount(0);
  }, [location.pathname, visibility]);

  useEffect(() => {
    document.documentElement.lang = locale;
    const baseTitle = t("app.documentTitle");
    document.title =
      settings.notifyBadge && unreadCount > 0 ? `(${unreadCount}) ${baseTitle}` : baseTitle;
  }, [locale, settings.notifyBadge, t, unreadCount]);

  // Apply Theme
  useEffect(() => {
    const root = document.documentElement;
    const isDark =
      settings.theme === "dark" ||
      (settings.theme === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);

    if (isDark) {
      root.classList.add("dark");
      // Optional: Add specific meta theme-color logic here if needed
    } else {
      root.classList.remove("dark");
    }
  }, [settings.theme]);

  return (
    <div className="min-h-screen bg-[var(--c-bg-main)] transition-colors duration-300">
      {/* ── Top Bar ────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-[#DDD6C8] bg-[#F6F3EC]/95 backdrop-blur-sm">
        <div className="px-4 py-3 sm:px-6 md:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <NavLink
              to="/create"
              className="min-w-0 text-xl font-semibold tracking-tight text-[#1C1917] no-underline"
            >
              SceneWords
            </NavLink>

            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[#ECE7DC] px-3 py-1 text-xs font-semibold text-[#57534E]">
                {t("app.topbar.queue", { count: inProgressCount })}
              </span>
              <span className="rounded-full bg-[#ECE7DC] px-3 py-1 text-xs font-semibold text-[#57534E]">
                {hasGatewayToken
                  ? t("app.topbar.gatewayConfigured")
                  : t("app.topbar.gatewayUnconfigured")}
              </span>
            </div>
          </div>

          <nav className="mt-3 flex flex-wrap gap-2">
            <NavLink
              to="/create"
              className={({ isActive }) =>
                `rounded-lg px-3 py-1.5 text-sm font-medium no-underline transition-colors ${
                  isActive
                    ? "bg-[#FBF8F2] text-[#1C1917]"
                    : "text-[#78716C] hover:bg-[#ECE7DC] hover:text-[#1C1917]"
                }`
              }
            >
              {t("nav.create")}
            </NavLink>
            <NavLink
              to="/works"
              className={({ isActive }) =>
                `rounded-lg px-3 py-1.5 text-sm font-medium no-underline transition-colors ${
                  isActive
                    ? "bg-[#FBF8F2] text-[#1C1917]"
                    : "text-[#78716C] hover:bg-[#ECE7DC] hover:text-[#1C1917]"
                }`
              }
            >
              {t("nav.jobs")}
            </NavLink>
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                `rounded-lg px-3 py-1.5 text-sm font-medium no-underline transition-colors ${
                  isActive
                    ? "bg-[#FBF8F2] text-[#1C1917]"
                    : "text-[#78716C] hover:bg-[#ECE7DC] hover:text-[#1C1917]"
                }`
              }
            >
              {t("nav.settings")}
            </NavLink>
          </nav>
        </div>
      </header>

      {/* ── Main Content ───────────────────────────── */}
      <main>
        <Routes>
          <Route
            path="/"
            element={
              <CreatePage
                catalog={catalogQuery.data}
                loading={catalogQuery.isLoading}
                tasks={tasksQuery.data ?? []}
              />
            }
          />
          <Route
            path="/create"
            element={
              <CreatePage
                catalog={catalogQuery.data}
                loading={catalogQuery.isLoading}
                tasks={tasksQuery.data ?? []}
              />
            }
          />
          <Route path="/jobs" element={<Navigate to="/works" replace />} />
          <Route path="/assets" element={<Navigate to="/works" replace />} />
          <Route
            path="/works"
            element={<JobsPage tasks={tasksQuery.data ?? []} loading={tasksQuery.isLoading} />}
          />
          <Route
            path="/settings"
            element={
              <SettingsPage
                pricingVersion={pricingQuery.data?.pricing_version ?? null}
                providers={catalogQuery.data?.providers ?? []}
              />
            }
          />
        </Routes>
      </main>

      {/* ── Toast Stack ────────────────────────────── */}
      {toasts.length ? (
        <div className="toast-stack" aria-live="polite" aria-atomic="true">
          {toasts.map((toast) => (
            <article
              key={toast.id}
              className={toast.level === "failure" ? "toast-card failure" : "toast-card success"}
              role="status"
            >
              <div className="toast-head">
                <strong>{toast.title}</strong>
                <button type="button" className="toast-close" onClick={() => dismissToast(toast.id)}>
                  {t("common.close")}
                </button>
              </div>
              <p>{toast.body}</p>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}
