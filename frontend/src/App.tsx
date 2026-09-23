import { useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchCatalog, fetchTasks } from "./api";
import { AppTopBar, HeaderSlotProvider } from "./components/AppTopBar";
import { useI18n } from "./i18n";
import { useAppSettingsStore } from "./state";
import type { VideoTaskDetail } from "./types";
import { CreatePage } from "./pages/CreatePage";
import { WorksPage } from "./pages/WorksPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ScenesPage } from "./pages/ScenesPage";
import { SubjectsPage } from "./pages/SubjectsPage";

const ACTIVE_TASK_POLL_INTERVAL_MS = 4000;
const IDLE_TASK_POLL_INTERVAL_MS = 20000;
const TASK_PAGE_SIZE = 50;

export default function App() {
  const { locale, t } = useI18n();
  const settings = useAppSettingsStore();
  const location = useLocation();
  const isCreateRoute = location.pathname === "/" || location.pathname === "/create";
  const [headerSlot, setHeaderSlot] = useState<HTMLDivElement | null>(null);
  const [visibility, setVisibility] = useState<"visible" | "hidden">(
    typeof document !== "undefined" && document.visibilityState === "hidden" ? "hidden" : "visible",
  );
  const tasksQuery = useQuery({
    queryKey: ["tasks", settings.gatewayToken],
    queryFn: () => fetchTasks(TASK_PAGE_SIZE, settings.gatewayToken, "summary"),
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

  const createPage = (
    <CreatePage
      catalog={catalogQuery.data}
      loading={catalogQuery.isLoading}
      tasks={tasksQuery.data ?? []}
    />
  );

  if (isCreateRoute) {
    return <div className="app-shell">{createPage}</div>;
  }

  return (
    <div className="app-shell">
      <AppTopBar inProgressCount={inProgressCount} onSlotChange={setHeaderSlot} />
      <HeaderSlotProvider value={headerSlot}>
        <main className="page-container">
          <Routes>
            <Route path="/jobs" element={<Navigate to="/works" replace />} />
            <Route path="/assets" element={<Navigate to="/works" replace />} />
            <Route path="/subjects" element={<SubjectsPage tasks={tasksQuery.data ?? []} />} />
            <Route path="/scenes" element={<ScenesPage catalog={catalogQuery.data} />} />
            <Route path="/scenes/:sceneId" element={<ScenesPage catalog={catalogQuery.data} />} />
            <Route
              path="/works"
              element={<WorksPage tasks={tasksQuery.data ?? []} loading={tasksQuery.isLoading} />}
            />
            <Route
              path="/settings"
              element={
                <SettingsPage
                  providers={catalogQuery.data?.providers ?? []}
                />
              }
            />
            <Route path="*" element={<Navigate to="/create" replace />} />
          </Routes>
        </main>
      </HeaderSlotProvider>
    </div>
  );
}
