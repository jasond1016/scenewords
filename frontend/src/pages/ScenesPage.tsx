import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowSquareOut,
  Check,
  GitBranch,
  PencilSimple,
  Plus,
  Stack,
} from "@phosphor-icons/react";
import { useNavigate, useParams } from "react-router-dom";
import { approveSceneVersion, fetchScene, fetchScenes } from "../api";
import { TaskPreviewCard } from "../components/TaskPreviewCard";
import { useI18n } from "../i18n";
import { buildReuseDraft } from "../overlayTaskActions";
import { useAppSettingsStore } from "../state";
import type { SceneGeneration, VideoTaskDetail } from "../types";

export function ScenesPage() {
  const { sceneId } = useParams<{ sceneId: string }>();
  return sceneId ? <SceneWorkspace sceneId={sceneId} /> : <SceneIndex />;
}

function SceneIndex() {
  const { locale } = useI18n();
  const isZh = locale === "zh-CN";
  const navigate = useNavigate();
  const token = useAppSettingsStore((state) => state.gatewayToken);
  const scenesQuery = useQuery({
    queryKey: ["scenes", token],
    queryFn: () => fetchScenes(token),
  });

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="m-0 text-label">{isZh ? "创作工作台" : "Creation workspace"}</p>
          <h1 className="m-0 mt-2 text-3xl font-semibold tracking-tight text-[var(--c-text)]">
            {isZh ? "场景" : "Scenes"}
          </h1>
          <p className="m-0 mt-2 max-w-2xl text-sm leading-6 text-[var(--c-text-secondary)]">
            {isZh
              ? "在一个场景里比较不同创作方向，选定候选，再沿版本链继续精修。"
              : "Compare creative directions, choose a candidate, and refine it through versions."}
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={() => navigate("/create") }>
          <Plus size={16} /> {isZh ? "创建场景" : "Create scene"}
        </button>
      </header>

      {scenesQuery.isLoading ? (
        <div className="card p-10 text-center text-sm text-[var(--c-text-secondary)]">
          {isZh ? "正在加载场景…" : "Loading scenes…"}
        </div>
      ) : scenesQuery.error ? (
        <div className="card p-6 text-sm text-error-text">{(scenesQuery.error as Error).message}</div>
      ) : (scenesQuery.data?.length ?? 0) === 0 ? (
        <button
          type="button"
          className="card flex min-h-64 flex-col items-center justify-center gap-3 border-dashed text-center"
          onClick={() => navigate("/create")}
        >
          <Stack size={34} className="text-[var(--c-text-tertiary)]" />
          <strong className="text-[var(--c-text)]">{isZh ? "还没有场景" : "No scenes yet"}</strong>
          <span className="max-w-md text-sm text-[var(--c-text-secondary)]">
            {isZh ? "在创作页新建场景并提交第一张候选稿。" : "Create a scene and submit its first candidate."}
          </span>
        </button>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {scenesQuery.data?.map((scene) => (
            <button
              key={scene.scene_id}
              type="button"
              className="card group flex min-h-48 flex-col justify-between text-left"
              onClick={() => navigate(`/scenes/${scene.scene_id}`)}
            >
              <div>
                <div className="flex items-center justify-between gap-3">
                  <span className={scene.approved_version_id ? "tag tag-success" : "tag"}>
                    {scene.approved_version_id
                      ? isZh ? "已选稿" : "Selected"
                      : isZh ? "候选中" : "Exploring"}
                  </span>
                  <ArrowSquareOut size={17} className="text-[var(--c-text-tertiary)] transition-transform group-hover:translate-x-0.5" />
                </div>
                <h2 className="m-0 mt-5 text-lg font-semibold text-[var(--c-text)]">{scene.title}</h2>
                <p className="m-0 mt-2 line-clamp-2 text-sm leading-6 text-[var(--c-text-secondary)]">
                  {scene.description || (isZh ? "尚未填写场景说明" : "No scene description")}
                </p>
              </div>
              <div className="mt-5 flex gap-2 text-xs text-[var(--c-text-tertiary)]">
                <span>{isZh ? `${scene.generation_count} 个候选` : `${scene.generation_count} candidates`}</span>
                <span>·</span>
                <span>{isZh ? `${scene.version_count} 个版本` : `${scene.version_count} versions`}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SceneWorkspace({ sceneId }: { sceneId: string }) {
  const { locale } = useI18n();
  const isZh = locale === "zh-CN";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const settings = useAppSettingsStore();
  const [selectedVersionIds, setSelectedVersionIds] = useState<Record<string, string>>({});
  const [hint, setHint] = useState("");
  const sceneQuery = useQuery({
    queryKey: ["scene", settings.gatewayToken, sceneId],
    queryFn: () => fetchScene(sceneId, settings.gatewayToken),
    refetchInterval: (query) => {
      const hasActive = query.state.data?.generations.some((generation) =>
        generation.versions.some((version) => version.status === "queued" || version.status === "running"),
      );
      return hasActive ? 4_000 : false;
    },
  });
  const displayedCandidates = useMemo(
    () => (sceneQuery.data?.generations ?? []).map((generation) => ({
      generation,
      task: selectCandidateVersion(generation, selectedVersionIds[generation.generation_id]),
    })),
    [sceneQuery.data?.generations, selectedVersionIds],
  );

  const approveMutation = useMutation({
    mutationFn: (taskId: string) => approveSceneVersion(sceneId, taskId, settings.gatewayToken),
    onSuccess: async () => {
      setHint(isZh ? "已将这个版本设为场景选定稿。" : "This version is now the scene selection.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["scene", settings.gatewayToken, sceneId] }),
        queryClient.invalidateQueries({ queryKey: ["scenes", settings.gatewayToken] }),
        queryClient.invalidateQueries({ queryKey: ["tasks", settings.gatewayToken] }),
      ]);
    },
    onError: (error: Error) => setHint(isZh ? `选稿失败：${error.message}` : `Could not select: ${error.message}`),
  });
  const reuseMutation = useMutation({
    mutationFn: (payload: { task: VideoTaskDetail; branch: boolean }) =>
      buildReuseDraft({ task: payload.task, imageIndex: 0, branch: payload.branch }, settings.gatewayToken),
    onSuccess: (draft) => {
      settings.setPendingReuseDraft(draft);
      navigate("/create");
    },
    onError: (error: Error) => setHint(isZh ? `无法准备编辑：${error.message}` : `Could not prepare edit: ${error.message}`),
  });

  if (sceneQuery.isLoading) {
    return <div className="card p-10 text-center text-sm text-[var(--c-text-secondary)]">{isZh ? "正在加载场景…" : "Loading scene…"}</div>;
  }
  if (!sceneQuery.data || sceneQuery.error) {
    return <div className="card p-6 text-sm text-error-text">{(sceneQuery.error as Error | null)?.message ?? (isZh ? "场景不存在。" : "Scene not found.")}</div>;
  }
  const scene = sceneQuery.data;

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <button type="button" className="btn-ghost mb-3 px-0" onClick={() => navigate("/scenes")}>
            <ArrowLeft size={16} /> {isZh ? "全部场景" : "All scenes"}
          </button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="m-0 text-3xl font-semibold tracking-tight text-[var(--c-text)]">{scene.title}</h1>
            <span className={scene.approved_version_id ? "tag tag-success" : "tag tag-warning"}>
              {scene.approved_version_id ? isZh ? "已有选定稿" : "Selection ready" : isZh ? "候选阶段" : "Candidate stage"}
            </span>
          </div>
          {scene.description ? <p className="m-0 mt-2 text-sm text-[var(--c-text-secondary)]">{scene.description}</p> : null}
          <p className="m-0 mt-2 text-xs text-[var(--c-text-tertiary)]">
            {isZh
              ? `${scene.generation_count} 个候选方向 · ${scene.version_count} 个版本`
              : `${scene.generation_count} candidate directions · ${scene.version_count} versions`}
          </p>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => navigate(`/create?sceneId=${encodeURIComponent(sceneId)}`)}
        >
          <Plus size={16} /> {isZh ? "新增候选" : "New candidate"}
        </button>
      </header>

      {hint ? <div className="rounded-xl border border-border bg-[var(--c-surface-inset)] px-4 py-3 text-sm text-[var(--c-text-secondary)]">{hint}</div> : null}

      {displayedCandidates.length === 0 ? (
        <button
          type="button"
          className="card flex min-h-72 flex-col items-center justify-center gap-3 border-dashed text-center"
          onClick={() => navigate(`/create?sceneId=${encodeURIComponent(sceneId)}`)}
        >
          <Plus size={30} className="text-[var(--c-text-tertiary)]" />
          <strong>{isZh ? "生成第一个候选" : "Generate the first candidate"}</strong>
        </button>
      ) : (
        <section className="grid items-start gap-5 md:grid-cols-2 xl:grid-cols-3">
          {displayedCandidates.map(({ generation, task }, index) => {
            if (!task) return null;
            const isApproved = scene.approved_version_id === task.task_id;
            const canUse = task.status === "succeeded";
            return (
              <article key={generation.generation_id} className={`card overflow-hidden p-0 ${isApproved ? "ring-2 ring-[var(--c-accent)]" : ""}`}>
                <div className="p-3 pb-0">
                  <TaskPreviewCard
                    task={task}
                    onClick={() => undefined}
                    timestampLabel={`V${task.version_number ?? 1}`}
                    modelLabel={task.model}
                    className="media-card"
                    aspectClassName="aspect-square"
                    statusBadge={{
                      label: isApproved
                        ? isZh ? "场景选定稿" : "Scene selection"
                        : generation.adopted_version_id === task.task_id
                          ? isZh ? "候选采用版" : "Candidate version"
                          : isZh ? `候选 ${index + 1}` : `Candidate ${index + 1}`,
                      tone: isApproved ? "ok" : "muted",
                    }}
                  />
                </div>
                <div className="flex flex-col gap-4 p-4">
                  <div>
                    <p className="m-0 text-label">{isZh ? `候选方向 ${index + 1}` : `Direction ${index + 1}`}</p>
                    <p className="m-0 mt-1 line-clamp-2 text-sm leading-6 text-[var(--c-text-secondary)]">{task.prompt}</p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {generation.versions.map((version) => (
                      <button
                        key={version.task_id}
                        type="button"
                        className={version.task_id === task.task_id ? "btn-primary px-3 text-xs" : "btn-ghost px-3 text-xs"}
                        onClick={() => setSelectedVersionIds((current) => ({ ...current, [generation.generation_id]: version.task_id }))}
                      >
                        V{version.version_number ?? 1}
                        {generation.adopted_version_id === version.task_id ? " ✓" : ""}
                      </button>
                    ))}
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      className={isApproved ? "btn-secondary" : "btn-primary"}
                      disabled={!canUse || isApproved || approveMutation.isPending}
                      onClick={() => approveMutation.mutate(task.task_id)}
                    >
                      <Check size={15} /> {isApproved ? isZh ? "已选定" : "Selected" : isZh ? "采用候选" : "Use this"}
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={!canUse || reuseMutation.isPending}
                      onClick={() => reuseMutation.mutate({ task, branch: false })}
                    >
                      <PencilSimple size={15} /> {isZh ? "继续编辑" : "Continue edit"}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost sm:col-span-2"
                      disabled={!canUse || reuseMutation.isPending}
                      onClick={() => reuseMutation.mutate({ task, branch: true })}
                    >
                      <GitBranch size={15} /> {isZh ? "从此建立新方向" : "Branch new direction"}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}

function selectCandidateVersion(
  generation: SceneGeneration,
  selectedVersionId?: string,
): VideoTaskDetail | null {
  const explicitlySelected = generation.versions.find((version) => version.task_id === selectedVersionId);
  if (explicitlySelected) return explicitlySelected;
  const adopted = generation.versions.find((version) => version.task_id === generation.adopted_version_id);
  if (adopted) return adopted;
  const succeeded = [...generation.versions].reverse().find((version) => version.status === "succeeded");
  return succeeded ?? generation.versions[generation.versions.length - 1] ?? null;
}
