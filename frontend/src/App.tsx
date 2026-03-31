import { useEffect, useMemo, useState } from "react";
import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, Images, GearSix, CircleNotch } from "@phosphor-icons/react";
import { fetchCatalog, fetchPricing, fetchTasks } from "./api";
import { useI18n } from "./i18n";
import { useAppSettingsStore } from "./state";
import type { VideoTaskDetail } from "./types";
import { CreatePage } from "./pages/CreatePage";
import { WorksPage } from "./pages/WorksPage";
import { SettingsPage } from "./pages/SettingsPage";

const ACTIVE_TASK_POLL_INTERVAL_MS = 4000;
const IDLE_TASK_POLL_INTERVAL_MS = 20000;
const LOGO_MARK_SRC = `${import.meta.env.BASE_URL}logo-mark-header.png`;

export default function App() {
  const { locale, t } = useI18n();
  const settings = useAppSettingsStore();
  const [visibility, setVisibility] = useState<"visible" | "hidden">(
    typeof document !== "undefined" && document.visibilityState === "hidden" ? "hidden" : "visible",
  );
  const tasksQuery = useQuery({
    queryKey: ["tasks", settings.gatewayToken],
    queryFn: () => fetchTasks(60, settings.gatewayToken, "summary"),
    refetchInterval: (query) => {
      if (visibility !== "visible") {
        return false;
      }
      const tasks = (query.state.data as VideoTaskDetail[] | undefined) ?? [];
      const hasInProgress = tasks.some(
        (task) => task.status === "queued" || task.status === "running",
      );
      return hasInProgress ? ACTIVE_TASK_POLL_INTERVAL_MS : IDLE_TASK_POLL_INTERVAL_MS;
    },
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

  useEffect(() => {
    const onVisibilityChange = () => {
      setVisibility(document.visibilityState === "hidden" ? "hidden" : "visible");
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.setAttribute("translate", "no");
    document.body.classList.add("notranslate");
    document.title = t("app.documentTitle");
  }, [locale, t]);

  useEffect(() => {
    const root = document.documentElement;
    const isDark =
      settings.theme === "dark" ||
      (settings.theme === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);

    if (isDark) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [settings.theme]);

  const navItems = [
    { to: "/create", label: t("nav.create"), icon: Plus },
    { to: "/works", label: t("nav.works"), icon: Images },
    { to: "/settings", label: t("nav.settings"), icon: GearSix },
  ];

  return (
    <div className="min-h-[100dvh] bg-canvas">
      {/* ── Top Bar ──────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-border bg-surface/80 backdrop-blur-md">
        <div className="mx-auto grid max-w-[1400px] grid-cols-[1fr_auto_1fr] items-center px-5 py-3 sm:px-8">
          {/* Left: Logo */}
          <div className="flex items-center">
            <NavLink
              to="/create"
              className="inline-flex items-center gap-2.5 no-underline"
            >
              <img
                src={LOGO_MARK_SRC}
                alt=""
                aria-hidden="true"
                className="h-7 w-7 shrink-0 rounded-lg"
              />
              <span className="hidden text-base font-bold tracking-tight text-[var(--c-text)] sm:inline">
                SceneWords
              </span>
            </NavLink>
          </div>

          {/* Center: Nav (all sizes) */}
          <nav className="flex items-center gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium no-underline transition-all duration-150 ${
                    isActive
                      ? "bg-[var(--c-surface-inset)] text-[var(--c-text)] font-semibold"
                      : "text-[var(--c-text-secondary)] hover:text-[var(--c-text)] hover:bg-[var(--c-border-subtle)]"
                  }`
                }
              >
                <item.icon size={15} weight="regular" />
                <span className="hidden sm:inline">{item.label}</span>
              </NavLink>
            ))}
          </nav>

          {/* Right: queue indicator */}
          <div className="flex items-center justify-end gap-3">
            {inProgressCount > 0 ? (
              <span className="tag tag-warning font-mono tabular-nums">
                <CircleNotch size={11} className="animate-spin" />
                {t("app.topbar.queue", { count: inProgressCount })}
              </span>
            ) : null}
          </div>
        </div>
      </header>

      {/* ── Main Content ───────────────────────────── */}
      <main className="mx-auto max-w-[1400px] px-5 py-8 sm:px-8 sm:py-10">
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
            element={<WorksPage tasks={tasksQuery.data ?? []} loading={tasksQuery.isLoading} />}
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
    </div>
  );
}
