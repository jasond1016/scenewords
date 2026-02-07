import { NavLink, Route, Routes } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchCatalog, fetchPricing, fetchTasks } from "./api";
import { useAppSettingsStore } from "./state";
import { useTaskNotifications } from "./useTaskNotifications";
import { CreatePage } from "./pages/CreatePage";
import { JobsPage } from "./pages/JobsPage";
import { SettingsPage } from "./pages/SettingsPage";

const TASK_POLL_INTERVAL_MS = 4000;

export default function App() {
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

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <h1>SceneWords</h1>
          <p>Video Gateway</p>
        </div>
        <nav>
          <NavLink className={({ isActive }) => (isActive ? "active" : "")} to="/create">
            Create
          </NavLink>
          <NavLink className={({ isActive }) => (isActive ? "active" : "")} to="/jobs">
            Jobs
          </NavLink>
          <NavLink className={({ isActive }) => (isActive ? "active" : "")} to="/settings">
            Settings
          </NavLink>
        </nav>
      </aside>
      <main className="content">
        <Routes>
          <Route
            path="/"
            element={<CreatePage catalog={catalogQuery.data} loading={catalogQuery.isLoading} />}
          />
          <Route
            path="/create"
            element={<CreatePage catalog={catalogQuery.data} loading={catalogQuery.isLoading} />}
          />
          <Route
            path="/jobs"
            element={<JobsPage tasks={tasksQuery.data ?? []} loading={tasksQuery.isLoading} />}
          />
          <Route
            path="/settings"
            element={<SettingsPage pricingVersion={pricingQuery.data?.pricing_version ?? null} />}
          />
        </Routes>
      </main>
    </div>
  );
}
