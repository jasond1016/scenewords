import { useEffect } from "react";
import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchCatalog, fetchPricing, fetchTasks } from "./api";
import { useI18n } from "./i18n";
import { useAppSettingsStore } from "./state";
import { useTaskNotifications } from "./useTaskNotifications";
import { CreatePage } from "./pages/CreatePage";
import { JobsPage } from "./pages/JobsPage";
import { SettingsPage } from "./pages/SettingsPage";

const TASK_POLL_INTERVAL_MS = 4000;

export default function App() {
  const { locale, t } = useI18n();
  const settings = useAppSettingsStore();
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

  useTaskNotifications(
    tasksQuery.data ?? [],
    settings.notifyOnSuccess,
    settings.notifyOnFailure,
    settings.notifySound,
  );

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t("app.documentTitle");
  }, [locale, t]);

  return (
    <div className="app-shell">
      <aside className="side-rail">
        <div className="rail-logo" aria-label={t("app.brandTitle")}>
          {t("app.brandTitle").slice(0, 1)}
        </div>
        <nav className="rail-nav">
          <NavLink className={({ isActive }) => (isActive ? "active" : "")} to="/create">
            {t("nav.create")}
          </NavLink>
          <NavLink className={({ isActive }) => (isActive ? "active" : "")} to="/assets">
            {t("nav.jobs")}
          </NavLink>
        </nav>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="topbar-brand">
            <h1>{t("app.brandTitle")}</h1>
            <p>
              {t("app.brandSubtitle")} · {t("app.gateway")}
            </p>
          </div>
          <NavLink
            className={({ isActive }) =>
              isActive ? "topbar-settings active" : "topbar-settings"
            }
            to="/settings"
          >
            {t("nav.settings")}
          </NavLink>
        </header>
        <main className="content">
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
      </div>
    </div>
  );
}
