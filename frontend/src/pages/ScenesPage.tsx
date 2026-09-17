import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  ArrowSquareOut,
  Check,
  DownloadSimple,
  GitBranch,
  PencilSimple,
  Plus,
  Sparkle,
  Stack,
  Trash,
} from "@phosphor-icons/react";
import { useNavigate, useParams } from "react-router-dom";
import {
  approveSceneVersion,
  deleteGeneration,
  deleteVideoTask,
  fetchScene,
  fetchScenes,
  finalizeScene,
} from "../api";
import { TaskPreviewCard } from "../components/TaskPreviewCard";
import { useI18n } from "../i18n";
import { buildReuseDraft } from "../overlayTaskActions";
import { useAppSettingsStore } from "../state";
import type {
  ProviderCatalogResponse,
  ProviderOperationField,
  ProviderModelOperationInfo,
  SceneGeneration,
  VideoTaskDetail,
} from "../types";
import { extractImageUrls } from "../utils";

interface Props {
  catalog?: ProviderCatalogResponse;
}

export function ScenesPage({ catalog }: Props) {
  const { sceneId } = useParams<{ sceneId: string }>();
  return sceneId ? <SceneWorkspace sceneId={sceneId} catalog={catalog} /> : <SceneIndex />;
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
                  <span className={scene.current_final_id ? "tag tag-success" : scene.approved_version_id ? "tag tag-warning" : "tag"}>
                    {scene.current_final_id
                      ? isZh ? "已定稿" : "Finalized"
                      : scene.approved_version_id
                      ? isZh ? "候选已选" : "Candidate selected"
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

function SceneWorkspace({ sceneId, catalog }: { sceneId: string; catalog?: ProviderCatalogResponse }) {
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
      ) || query.state.data?.finals.some((task) => task.status === "queued" || task.status === "running");
      return hasActive ? 4_000 : false;
    },
  });
  const finalizeChoices = useMemo(() => buildFinalizeChoices(catalog), [catalog]);
  const [finalizeChoiceKey, setFinalizeChoiceKey] = useState("");
  const [finalizeResolution, setFinalizeResolution] = useState("");
  const [finalizeResolutionTier, setFinalizeResolutionTier] = useState("");
  const currentFinalSettings = sceneQuery.data?.finals.find(
    (task) => task.task_id === sceneQuery.data?.current_final_id,
  ) ?? null;
  const previousChoice = currentFinalSettings
    ? finalizeChoices.find((choice) =>
        choice.providerId === currentFinalSettings.provider &&
        choice.modelName === currentFinalSettings.model &&
        choice.operation.id === currentFinalSettings.operation
      )
    : null;
  const finalizeChoice = finalizeChoices.find((choice) => choice.key === finalizeChoiceKey) ?? previousChoice ?? finalizeChoices[0] ?? null;
  const resolutionField = finalizeChoice?.operation.fields.find((field) => field.key === "resolution");
  const resolutionTierField = finalizeChoice?.operation.fields.find((field) => field.key === "resolution_tier");
  const reusingCurrentSettings = finalizeChoice?.key === previousChoice?.key;
  const previousResolutionTier = readResolutionTier(currentFinalSettings);
  const selectedResolution = finalizeResolution || (reusingCurrentSettings ? currentFinalSettings?.resolution ?? "" : "") || fieldDefault(resolutionField);
  const selectedResolutionTier = finalizeResolutionTier || (reusingCurrentSettings ? previousResolutionTier : "") || fieldDefault(resolutionTierField);
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
  const finalizeMutation = useMutation({
    mutationFn: () => {
      if (!finalizeChoice) throw new Error(isZh ? "没有支持参考图的定稿模型。" : "No reference-capable final model is available.");
      return finalizeScene(sceneId, {
        provider: finalizeChoice.providerId,
        model: finalizeChoice.modelName,
        operation: finalizeChoice.operation.id,
        resolution: selectedResolution || null,
        resolution_tier: selectedResolutionTier || null,
      }, settings.gatewayToken);
    },
    onSuccess: async () => {
      setHint(isZh ? "定稿任务已提交。完成后会自动成为当前定稿。" : "Final render queued. It becomes current when completed.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["scene", settings.gatewayToken, sceneId] }),
        queryClient.invalidateQueries({ queryKey: ["scenes", settings.gatewayToken] }),
        queryClient.invalidateQueries({ queryKey: ["tasks", settings.gatewayToken] }),
      ]);
    },
    onError: (error: Error) => setHint(isZh ? `定稿失败：${error.message}` : `Could not finalize: ${error.message}`),
  });
  const deleteMutation = useMutation({
    mutationFn: (payload: { kind: "version" | "final"; task: VideoTaskDetail } | { kind: "generation"; generationId: string }) => {
      if (payload.kind === "generation") {
        return deleteGeneration(payload.generationId, settings.gatewayToken);
      }
      return deleteVideoTask(payload.task.task_id, settings.gatewayToken, payload.task.asset_type);
    },
    onSuccess: async (_data, payload) => {
      setHint(
        payload.kind === "version"
          ? isZh ? "已删除当前版本。" : "Version deleted."
          : payload.kind === "final"
            ? isZh ? "已删除定稿记录。" : "Final render deleted."
          : isZh ? "已删除整个候选方向。" : "Candidate direction deleted.",
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["scene", settings.gatewayToken, sceneId] }),
        queryClient.invalidateQueries({ queryKey: ["scenes", settings.gatewayToken] }),
        queryClient.invalidateQueries({ queryKey: ["tasks", settings.gatewayToken] }),
      ]);
    },
    onError: (error: Error) => setHint(isZh ? `删除失败：${error.message}` : `Could not delete: ${error.message}`),
  });

  if (sceneQuery.isLoading) {
    return <div className="card p-10 text-center text-sm text-[var(--c-text-secondary)]">{isZh ? "正在加载场景…" : "Loading scene…"}</div>;
  }
  if (!sceneQuery.data || sceneQuery.error) {
    return <div className="card p-6 text-sm text-error-text">{(sceneQuery.error as Error | null)?.message ?? (isZh ? "场景不存在。" : "Scene not found.")}</div>;
  }
  const scene = sceneQuery.data;
  const currentFinal = scene.finals.find((task) => task.task_id === scene.current_final_id) ?? null;
  const previousFinals = scene.finals.filter((task) => task.task_id !== scene.current_final_id);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <button type="button" className="btn-ghost mb-3 px-0" onClick={() => navigate("/scenes")}>
            <ArrowLeft size={16} /> {isZh ? "全部场景" : "All scenes"}
          </button>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="m-0 text-3xl font-semibold tracking-tight text-[var(--c-text)]">{scene.title}</h1>
            <span className={scene.current_final_id ? "tag tag-success" : scene.approved_version_id ? "tag tag-warning" : "tag"}>
              {scene.current_final_id
                ? isZh ? "已定稿" : "Final ready"
                : scene.approved_version_id
                  ? isZh ? "候选已选定" : "Candidate selected"
                  : isZh ? "候选阶段" : "Candidate stage"}
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

      <section className="card overflow-hidden p-0">
        <div className="grid lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <div className="border-b border-border p-5 lg:border-b-0 lg:border-r">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="m-0 text-label">{isZh ? "交付结果" : "Delivery"}</p>
                <h2 className="m-0 mt-1 text-xl font-semibold text-[var(--c-text)]">
                  {currentFinal ? isZh ? "当前定稿" : "Current final" : isZh ? "尚未定稿" : "No final yet"}
                </h2>
              </div>
              {currentFinal ? <span className="tag tag-success">{isZh ? "当前" : "Current"}</span> : null}
            </div>
            {currentFinal ? (
              <div className="max-w-xl">
                <TaskPreviewCard
                  task={currentFinal}
                  onClick={() => undefined}
                  timestampLabel={new Date(currentFinal.created_at).toLocaleString(isZh ? "zh-CN" : "en-US")}
                  modelLabel={currentFinal.model}
                  className="media-card"
                  aspectClassName="aspect-video"
                  statusBadge={{ label: isZh ? "定稿" : "Final", tone: "ok" }}
                />
                <FinalActions
                  task={currentFinal}
                  isZh={isZh}
                  deleteDisabled={deleteMutation.isPending}
                  onDelete={() => deleteMutation.mutate({ kind: "final", task: currentFinal })}
                />
              </div>
            ) : (
              <div className="flex min-h-44 flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-[var(--c-surface-inset)] p-6 text-center">
                <Sparkle size={28} className="text-[var(--c-text-tertiary)]" />
                <p className="m-0 mt-3 text-sm text-[var(--c-text-secondary)]">
                  {scene.approved_version_id
                    ? isZh ? "选定稿已就绪，可在右侧生成高质量定稿。" : "Your selection is ready for a high-quality final render."
                    : isZh ? "先在下方采用一个成功版本，再生成定稿。" : "Choose a successful version below before finalizing."}
                </p>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-4 bg-[var(--c-surface-inset)] p-5">
            <div>
              <p className="m-0 text-label">{isZh ? "从选定稿定稿" : "Finalize selection"}</p>
              <p className="m-0 mt-2 text-sm leading-6 text-[var(--c-text-secondary)]">
                {isZh
                  ? "使用选定版本作为首要参考，保持主体、构图与风格，只提升输出质量。"
                  : "Use the exact selection as the primary reference, preserving subjects, composition, and style."}
              </p>
            </div>
            <label className="grid gap-1.5 text-xs text-[var(--c-text-secondary)]">
              {isZh ? "定稿模型" : "Final model"}
              <select
                className="input-base"
                value={finalizeChoice?.key ?? ""}
                disabled={!finalizeChoices.length}
                onChange={(event) => {
                  setFinalizeChoiceKey(event.target.value);
                  setFinalizeResolution("");
                  setFinalizeResolutionTier("");
                }}
              >
                {finalizeChoices.map((choice) => (
                  <option key={choice.key} value={choice.key}>{choice.label}</option>
                ))}
              </select>
            </label>
            {resolutionField?.options.length ? (
              <label className="grid gap-1.5 text-xs text-[var(--c-text-secondary)]">
                {isZh ? "画面比例" : "Aspect ratio"}
                <select className="input-base" value={selectedResolution} onChange={(event) => setFinalizeResolution(event.target.value)}>
                  {resolutionField.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            ) : null}
            {resolutionTierField?.options.length ? (
              <label className="grid gap-1.5 text-xs text-[var(--c-text-secondary)]">
                {isZh ? "输出分辨率" : "Output resolution"}
                <select className="input-base" value={selectedResolutionTier} onChange={(event) => setFinalizeResolutionTier(event.target.value)}>
                  {resolutionTierField.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
            ) : null}
            <div className="rounded-xl border border-border bg-surface px-3 py-2 text-xs text-[var(--c-text-tertiary)]">
              {isZh ? "来源：当前场景的精确选定版本" : "Source: the exact approved version for this scene"}
            </div>
            <button
              type="button"
              className="btn-primary mt-auto w-full"
              disabled={!scene.approved_version_id || !finalizeChoice || finalizeMutation.isPending}
              onClick={() => finalizeMutation.mutate()}
            >
              <Sparkle size={16} />
              {finalizeMutation.isPending
                ? isZh ? "正在提交…" : "Submitting…"
                : scene.finals.length
                  ? isZh ? "重新定稿" : "Render another final"
                  : isZh ? "生成定稿" : "Generate final"}
            </button>
          </div>
        </div>
        {previousFinals.length ? (
          <div className="border-t border-border p-5">
            <h3 className="m-0 text-sm font-semibold text-[var(--c-text)]">{isZh ? "历史定稿" : "Previous finals"}</h3>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {previousFinals.map((task) => (
                <div key={task.task_id}>
                  <TaskPreviewCard
                    task={task}
                    onClick={() => undefined}
                    timestampLabel={new Date(task.created_at).toLocaleString(isZh ? "zh-CN" : "en-US")}
                    modelLabel={task.model}
                    className="media-card"
                    aspectClassName="aspect-square"
                    statusBadge={{ label: isZh ? "历史定稿" : "Previous final", tone: "muted" }}
                  />
                  <FinalActions
                    task={task}
                    isZh={isZh}
                    deleteDisabled={deleteMutation.isPending}
                    onDelete={() => deleteMutation.mutate({ kind: "final", task })}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>

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
                        ? isZh ? "已选候选" : "Selected candidate"
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
                  <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-3">
                    <button
                      type="button"
                      className="btn-ghost px-3 text-xs text-[var(--c-error-text)]"
                      disabled={deleteMutation.isPending}
                      onClick={() => {
                        const warning = generation.versions.length === 1
                          ? isZh
                            ? "这是该候选的最后一个版本。删除后整个候选方向也会消失，确定继续？"
                            : "This is the candidate's last version. Deleting it also removes the candidate direction. Continue?"
                          : isZh
                            ? `删除当前 V${task.version_number ?? 1}？此操作无法撤销。`
                            : `Delete the current V${task.version_number ?? 1}? This cannot be undone.`;
                        if (window.confirm(warning)) {
                          deleteMutation.mutate({ kind: "version", task });
                        }
                      }}
                    >
                      <Trash size={14} /> {isZh ? "删除当前版本" : "Delete version"}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost px-3 text-xs text-[var(--c-error-text)]"
                      disabled={deleteMutation.isPending}
                      onClick={() => {
                        const warning = isZh
                          ? `删除候选方向 ${index + 1} 及其全部 ${generation.versions.length} 个版本？此操作无法撤销。`
                          : `Delete direction ${index + 1} and all ${generation.versions.length} versions? This cannot be undone.`;
                        if (window.confirm(warning)) {
                          deleteMutation.mutate({ kind: "generation", generationId: generation.generation_id });
                        }
                      }}
                    >
                      <Trash size={14} /> {isZh ? "删除整个候选" : "Delete candidate"}
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

interface FinalizeChoice {
  key: string;
  label: string;
  providerId: string;
  modelName: string;
  operation: ProviderModelOperationInfo;
}

function buildFinalizeChoices(catalog?: ProviderCatalogResponse): FinalizeChoice[] {
  return (catalog?.providers ?? [])
    .filter((provider) => provider.type === "tuzi_image")
    .flatMap((provider) => provider.models.flatMap((model) =>
      model.operations
        .filter((operation) => operation.fields.some((field) =>
          field.key === "image_file_ids" || field.key === "input_reference_file_ids"
        ))
        .map((operation) => ({
          key: `${provider.id}:${model.name}:${operation.id}`,
          label: `${model.display_name} · ${operation.display_name}`,
          providerId: provider.id,
          modelName: model.name,
          operation,
        })),
    ));
}

function fieldDefault(field?: ProviderOperationField): string {
  if (!field) return "";
  if (typeof field.default === "string" && field.default) return field.default;
  return field.options[0]?.value ?? "";
}

function readResolutionTier(task: VideoTaskDetail | null): string {
  if (!task) return "";
  const current = task.provider_options.resolution_tier;
  if (typeof current === "string" && current) return current.toLowerCase();
  const legacy = task.provider_options.quality;
  return typeof legacy === "string" && ["1k", "2k", "4k"].includes(legacy.toLowerCase())
    ? legacy.toLowerCase()
    : "";
}

function FinalActions({
  task,
  isZh,
  deleteDisabled,
  onDelete,
}: {
  task: VideoTaskDetail;
  isZh: boolean;
  deleteDisabled: boolean;
  onDelete: () => void;
}) {
  const downloadUrl = extractImageUrls(task)[0] ?? "";
  const resolutionValidation = readResolutionValidation(task);
  return (
    <>
      {resolutionValidation ? (
        <div
          className={`mt-2 rounded-xl px-3 py-2 text-xs ${
            resolutionValidation.matches
              ? "bg-[var(--c-success-bg)] text-[var(--c-success-text)]"
              : "bg-[var(--c-warning-bg)] text-[var(--c-warning-text)]"
          }`}
        >
          {resolutionValidation.matches
            ? isZh
              ? `已验证输出尺寸：${resolutionValidation.actual}`
              : `Verified output size: ${resolutionValidation.actual}`
            : resolutionValidation.actual
              ? isZh
                ? `尺寸未达标：请求 ${resolutionValidation.requested}，实际 ${resolutionValidation.actual}`
                : `Size mismatch: requested ${resolutionValidation.requested}, received ${resolutionValidation.actual}`
              : isZh
                ? `无法验证输出尺寸（请求 ${resolutionValidation.requested}）`
                : `Could not verify output size (requested ${resolutionValidation.requested})`}
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        {downloadUrl ? (
          <a className="btn-ghost px-3 text-xs no-underline" href={downloadUrl} download target="_blank" rel="noreferrer">
            <DownloadSimple size={14} /> {isZh ? "下载" : "Download"}
          </a>
        ) : null}
        <button
          type="button"
          className="btn-ghost px-3 text-xs text-[var(--c-error-text)]"
          disabled={deleteDisabled}
          onClick={() => {
            const warning = isZh ? "删除这条定稿记录？此操作无法撤销。" : "Delete this final render? This cannot be undone.";
            if (window.confirm(warning)) onDelete();
          }}
        >
          <Trash size={14} /> {isZh ? "删除" : "Delete"}
        </button>
      </div>
    </>
  );
}

function readResolutionValidation(task: VideoTaskDetail): {
  requested: string;
  actual: string | null;
  matches: boolean | null;
} | null {
  const value = task.result?.resolution_validation;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const requested = "requested" in value && typeof value.requested === "string" ? value.requested : "";
  const actual = "actual" in value && typeof value.actual === "string" ? value.actual : null;
  const matches = "matches" in value && typeof value.matches === "boolean" ? value.matches : null;
  return requested ? { requested, actual, matches } : null;
}
