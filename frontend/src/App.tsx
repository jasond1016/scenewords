import { useCallback, useEffect, useState } from "react";
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
    if (location.pathname !== "/assets" && location.pathname !== "/jobs") {
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
      <header className="flex items-center justify-between h-16 px-8 border-b border-border-light sticky top-0 bg-[var(--c-bg-main)]/95 backdrop-blur-sm z-30 transition-colors duration-300">
        {/* Left: Logo + Page Tabs */}
        <div className="flex items-center gap-8">
          {/* Logo */}
          <NavLink to="/create" className="flex items-center gap-2 no-underline">
            <span className="text-coral text-xl font-bold">✦</span>
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-100 tracking-tight">SceneWords</span>
          </NavLink>

          {/* Page tabs */}
          <nav className="flex items-center gap-1">
            <NavLink
              to="/create"
              className={({ isActive }) =>
                `px-4 py-1.5 text-sm font-medium rounded-lg transition-colors no-underline ${isActive
                  ? "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white"
                  : "text-gray-500 hover:text-gray-700 hover:bg-gray-50 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-800"
                }`
              }
            >
              ✨ {t("nav.create")}
            </NavLink>
            <NavLink
              to="/assets"
              className={({ isActive }) =>
                `px-4 py-1.5 text-sm font-medium rounded-lg transition-colors no-underline ${isActive
                  ? "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white"
                  : "text-gray-500 hover:text-gray-700 hover:bg-gray-50 dark:text-gray-400 dark:hover:text-gray-200 dark:hover:bg-gray-800"
                }`
              }
            >
              📂 {t("nav.jobs")}
            </NavLink>
          </nav>
        </div>

        {/* Right: Settings + Avatar */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-50 dark:hover:text-gray-200 dark:hover:bg-gray-800 transition-colors"
            onClick={() => {
              const next = settings.theme === "light" ? "dark" : "light";
              settings.setSettings({ theme: next });
            }}
            title={t("app.toggleTheme")}
          >
            {settings.theme === "dark" ? "🌙" : "☀️"}
          </button>

          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `p-2 rounded-lg transition-colors no-underline text-sm ${isActive
                ? "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-white"
                : "text-gray-400 hover:text-gray-600 hover:bg-gray-50 dark:hover:text-gray-200 dark:hover:bg-gray-800"
              }`
            }
          >
            ⚙️
          </NavLink>
          <div className="w-9 h-9 rounded-full bg-coral flex items-center justify-center text-white text-sm font-bold">
            {t("app.brandTitle").slice(0, 1)}
          </div>
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
          <Route path="/jobs" element={<Navigate to="/assets" replace />} />
          <Route
            path="/assets"
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
