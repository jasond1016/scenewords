import { CaretDown, DotsThree, WarningCircle, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n, type TranslateFn } from "../i18n";
import { describeTaskPrompt, deriveTaskFormatMeta } from "../overlayTaskPresentation";
import { copyText } from "../overlayTaskUtils";
import { useFeedbackTimeout } from "../useActionFeedback";
import type { ProviderCatalogResponse, VideoTaskDetail } from "../types";
import { extractImageUrls, formatCostAmount, formatTime, resolveTaskCostState } from "../utils";

export interface SidebarRetryActions {
  disabled: boolean;
  sameSeedLabel?: string;
  newSeedLabel?: string;
  defaultLabel?: string;
  onSameSeed?: () => void;
  onNewSeed?: () => void;
  onDefault?: () => void;
}

export interface SidebarCancelAction {
  disabled: boolean;
  onCancel: () => void;
}

interface Props {
  task: VideoTaskDetail;
  catalog?: ProviderCatalogResponse;
  versionTasks?: VideoTaskDetail[];
  onVersionSelect?: (taskId: string) => void;
  statusLabel: string;
  updatedAtLabel: string;
  downloadUrl?: string | null;
  onReuse: () => void;
  reuseDisabled?: boolean;
  gatewayToken?: string;
  onDelete: () => void;
  deleteDisabled?: boolean;
  cancelAction?: SidebarCancelAction;
  retryActions?: SidebarRetryActions;
  errorText?: string | null;
}

export function MediaDetailSidebar(props: Props) {
  const { task, catalog, versionTasks = [], onVersionSelect, statusLabel, updatedAtLabel,
    downloadUrl, onReuse, reuseDisabled, gatewayToken = "", onDelete, deleteDisabled,
    cancelAction, retryActions, errorText } = props;
  const { locale, t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const compareButtonRef = useRef<HTMLButtonElement>(null);
  const descriptionRef = useRef<HTMLParagraphElement>(null);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const menuTriggerRef = useRef<HTMLElement>(null);
  const menuId = useId();
  const description = describeTaskPrompt(task.prompt);
  const summaryText = description.text.replace(/\s+/g, " ");
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [descriptionTruncated, setDescriptionTruncated] = useState(false);
  const [parametersOpen, setParametersOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isComparing, setIsComparing] = useState(false);
  const [copyMessage, setCopyMessage] = useState<{ text: string; error: boolean } | null>(null);
  const copyRequest = useRef(0);
  const clearCopyMessage = useCallback(() => setCopyMessage(null), []);
  useFeedbackTimeout(clearCopyMessage, copyMessage, !!copyMessage && !copyMessage.error);
  useEffect(() => {
    copyRequest.current += 1;
    return () => { copyRequest.current += 1; };
  }, [task.task_id]);
  const closeComparison = useCallback(() => setIsComparing(false), []);
  useEffect(() => {
    rootRef.current?.closest<HTMLElement>("[data-overlay-scroll='allow']")?.scrollTo(0, 0);
    setDescriptionOpen(false);
    setParametersOpen(false);
    if (menuRef.current) menuRef.current.open = false;
    setCopyMessage(null);
    setIsComparing(false);
  }, [task.task_id]);
  useEffect(() => {
    const paragraph = descriptionRef.current;
    if (!paragraph) return;
    let active = true;
    const measure = () => {
      if (!active || !paragraph.clientWidth) return;
      // While expanded, measure a hidden clamped copy at the exact rendered width.
      // This keeps resize/font changes accurate without collapsing the visible text.
      const probe = descriptionOpen ? paragraph.cloneNode(true) as HTMLParagraphElement : paragraph;
      if (probe !== paragraph) {
        probe.removeAttribute("id");
        probe.dataset.expanded = "false";
        probe.textContent = summaryText;
        Object.assign(probe.style, { position: "absolute", top: "0", left: "0", visibility: "hidden", pointerEvents: "none", width: `${paragraph.clientWidth}px` });
        paragraph.parentElement?.appendChild(probe);
      }
      setDescriptionTruncated(probe.scrollHeight > probe.clientHeight + 1);
      if (probe !== paragraph) probe.remove();
    };
    const observer = new ResizeObserver(measure);
    observer.observe(paragraph);
    document.fonts.addEventListener("loadingdone", measure);
    void document.fonts.ready.then(measure);
    measure();
    return () => {
      active = false;
      observer.disconnect();
      document.fonts.removeEventListener("loadingdone", measure);
    };
  }, [summaryText, descriptionOpen, locale]);
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target)) {
        if (menuRef.current) menuRef.current.open = false;
      }
    };
    const keyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || !menuRef.current?.open) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (menuRef.current) menuRef.current.open = false;
      menuTriggerRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", keyDown, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", keyDown, true);
    };
  }, [menuOpen]);
  useEffect(() => {
    const versions = rootRef.current?.querySelector<HTMLElement>(".media-detail-versions");
    if (!versions) return;
    const showSelectedVersion = () => {
      const selected = versions.querySelector<HTMLElement>("[aria-current='true']");
      if (!selected || !versions.clientWidth) return;
      const left = selected.getBoundingClientRect().left - versions.getBoundingClientRect().left + versions.scrollLeft;
      const right = left + selected.offsetWidth;
      if (left < versions.scrollLeft) versions.scrollLeft = Math.max(0, left - 2);
      else if (right > versions.scrollLeft + versions.clientWidth) versions.scrollLeft = right - versions.clientWidth + 2;
    };
    const observer = new ResizeObserver(showSelectedVersion);
    observer.observe(versions);
    showSelectedVersion();
    return () => observer.disconnect();
  }, [task.task_id, versionTasks.length]);
  const comparisonCandidates = useMemo(() => versionTasks.filter((version) =>
    version.task_id !== task.task_id && version.status === "succeeded" && extractImageUrls(version).length > 0),
  [task.task_id, versionTasks]);
  const provider = catalog?.providers.find((entry) => entry.id === task.provider);
  const modelName = provider?.models.find((entry) => entry.name === task.model)?.display_name ?? task.model;
  const format = deriveTaskFormatMeta(task);
  const cost = resolveTaskCostState(task);
  const costLabel = cost.kind === "estimated" || task.cost_source === "local_config"
    ? "works.detail.estimatedCost"
    : task.cost_source === "provider_api" ? "works.detail.actualCost" : "works.detail.indicativeCost";
  const normalizedLocale = locale === "zh-CN" ? "zh-CN" : "en-US";
  const copy = async (value: string) => {
    const request = ++copyRequest.current;
    setCopyMessage(null);
    try {
      await copyText(value);
      if (request === copyRequest.current) setCopyMessage({ text: t("works.detail.copied"), error: false });
    } catch {
      if (request === copyRequest.current) setCopyMessage({ text: t("works.copyJsonFailed"), error: true });
    }
  };

  return (
    <div ref={rootRef} className="media-detail">
      <div className="media-detail-heading">
        {task.generation_id ? (
          <div className="media-detail-versions" role="group" aria-label={t("works.detail.versions")} data-overlay-scroll="allow" data-overlay-gesture="allow" tabIndex={0}>
            {(versionTasks.length ? versionTasks : [task]).map((version) => (
              <button key={version.task_id} type="button" className="media-detail-version"
                aria-current={version.task_id === task.task_id ? "true" : undefined}
                aria-pressed={version.task_id === task.task_id}
                title={`V${version.version_number ?? 1} · ${t(`status.${version.status}`)}`}
                onClick={() => onVersionSelect?.(version.task_id)}>
                V{version.version_number ?? 1}
              </button>
            ))}
          </div>
        ) : <span className="media-detail-muted">{t("works.detail.imageInfo")}</span>}
        {downloadUrl && comparisonCandidates.length ? (
          <button ref={compareButtonRef} type="button" className="media-detail-link" aria-label={t("works.detail.compare")} onClick={() => setIsComparing(true)}>
            {t("works.detail.compareAction")}
          </button>
        ) : null}
        <details ref={menuRef} className="media-detail-menu" onToggle={(event) => setMenuOpen(event.currentTarget.open)}>
          <summary ref={menuTriggerRef} aria-label={t("works.detail.actions")} aria-expanded={menuOpen} aria-controls={menuId}><DotsThree size={20} weight="regular" /></summary>
          <button id={menuId} type="button" className="media-detail-delete" onClick={onDelete} disabled={deleteDisabled}>{t("works.delete")}</button>
        </details>
      </div>

      {task.status !== "succeeded" || errorText || !downloadUrl || task.asset_type !== "image" || retryActions ? (
        <section className="media-detail-feedback" aria-label={t("works.statusLabel")}>
          {task.status !== "succeeded" ? <p className="media-detail-status" role="status">{statusLabel}</p> : null}
          {errorText ? <p className="media-detail-error" role="alert"><WarningCircle size={16} weight="regular" />{errorText}</p> : null}
          {task.status === "succeeded" && !downloadUrl ? <p>{t("works.resourceExpiredHint")}</p> : null}
          <div className="media-detail-recovery">
            {cancelAction ? <button type="button" className="btn-secondary text-xs" disabled={cancelAction.disabled} onClick={cancelAction.onCancel}>{t("works.cancelInProgress")}</button> : null}
            {renderRetryButtons(retryActions, t)}
            {!cancelAction && (task.asset_type !== "image" || task.status !== "succeeded") ? (
              <button type="button" className="media-detail-link" onClick={onReuse} disabled={reuseDisabled}>{t("works.editAgain")}</button>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="media-detail-description">
        <h3>{t(description.modification ? "works.detail.modification" : "works.detail.myDescription")}</h3>
        <p ref={descriptionRef} id="media-detail-description" data-expanded={descriptionOpen}>{(descriptionOpen ? description.text : summaryText) || t("works.emptyPrompt")}</p>
        {description.text ? <div className="media-detail-text-actions">
          {descriptionTruncated ? <button type="button" className="media-detail-link" aria-expanded={descriptionOpen} aria-controls="media-detail-description" onClick={() => setDescriptionOpen((open) => !open)}>{t(descriptionOpen ? "works.detail.collapse" : "works.detail.expand")}</button> : null}
          <button type="button" className="media-detail-link" onClick={() => void copy(description.text)}>{t("works.detail.copy")}</button>
        </div> : null}
      </section>

      <dl className="media-detail-meta">
        <InfoCell label={t("works.model")} value={modelName} />
        {format.ratio ? <InfoCell label={t("create.quickRatio")} value={format.ratio} /> : null}
        {format.resolution ? <InfoCell label={t("works.detail.targetSize")} value={format.resolution} /> : null}
        {cost.amount != null && (cost.kind === "charged" || cost.kind === "estimated") ? (
          <InfoCell label={t(costLabel)} value={formatCostAmount(cost.amount, cost.currency, normalizedLocale)} />
        ) : null}
      </dl>

      <details className="media-detail-section" open={parametersOpen} onToggle={(event) => setParametersOpen(event.currentTarget.open)}>
        <summary>{t("works.detail.parameters")}<CaretDown size={16} weight="regular" aria-hidden="true" /></summary>
        {parametersOpen ? <div className="media-detail-section-body">
          <dl className="media-detail-meta">
            <InfoCell label={t("works.provider")} value={provider?.display_name ?? task.provider} />
            {task.provider_options.quality != null ? <InfoCell label={t("works.detail.quality")} value={String(task.provider_options.quality)} /> : null}
            {task.seed != null ? <InfoCell label={t("works.seed")} value={String(task.seed)} /> : null}
            {task.resolution ? <InfoCell label={t("works.detail.requestSize")} value={task.resolution} /> : null}
            <InfoCell label={t("works.created")} value={formatTime(task.created_at, normalizedLocale)} />
            <InfoCell label={t("works.detail.updated")} value={updatedAtLabel} />
          </dl>
          <h3>{t("works.detail.fullPrompt")}</h3><p className="media-detail-full-text">{task.prompt || t("works.emptyPrompt")}</p>
          <button type="button" className="media-detail-link" onClick={() => void copy(task.prompt)}>{t("works.detail.copy")}</button>
          {task.negative_prompt ? <><h3>{t("works.negativePrompt")}</h3><p className="media-detail-full-text">{task.negative_prompt}</p></> : null}
        </div> : null}
      </details>

      {copyMessage ? <p className="media-detail-muted" role={copyMessage.error ? "alert" : "status"}>{copyMessage.text}</p> : null}
      {isComparing && comparisonCandidates.length ? <VersionComparison task={task} imageUrl={downloadUrl ?? ""} candidates={comparisonCandidates} token={gatewayToken} trigger={compareButtonRef.current} onClose={closeComparison} /> : null}
    </div>
  );
}

function VersionComparison(props: { task: VideoTaskDetail; imageUrl: string; candidates: VideoTaskDetail[]; token: string; trigger: HTMLButtonElement | null; onClose: () => void }) {
  const { task, imageUrl, candidates, token, trigger, onClose } = props;
  const { t } = useI18n();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [comparisonTaskId, setComparisonTaskId] = useState(candidates.find((version) => version.task_id === task.parent_version_id)?.task_id ?? candidates[candidates.length - 1].task_id);
  const [side, setSide] = useState("a");
  const comparison = candidates.find((version) => version.task_id === comparisonTaskId) ?? candidates[candidates.length - 1];
  useEffect(() => {
    const frame = trigger?.closest<HTMLElement>(".media-overlay-frame");
    if (frame) frame.inert = true;
    closeRef.current?.focus();
    const keyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); onClose(); }
      if (event.key === "Tab") {
        const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled),select,summary,[tabindex='0']") ?? []).filter((element) => element.getClientRects().length > 0);
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", keyDown, true);
    return () => {
      document.removeEventListener("keydown", keyDown, true);
      if (frame) frame.inert = false;
      trigger?.focus({ preventScroll: true });
    };
  }, [onClose, trigger]);
  return createPortal(
    <div className="media-comparison" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="media-comparison-title" data-overlay-scroll="allow" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="media-comparison-panel">
        <header className="media-comparison-header">
          <h2 id="media-comparison-title">{t("works.detail.compare")}</h2>
          <label>{t("works.detail.comparisonVersion")}
            <select value={comparison.task_id} onChange={(event) => setComparisonTaskId(event.target.value)}>
              {candidates.map((version) => <option key={version.task_id} value={version.task_id}>V{version.version_number ?? 1}</option>)}
            </select>
          </label>
          <button ref={closeRef} type="button" className="media-detail-icon" aria-label={t("common.close")} onClick={onClose}><X size={22} weight="regular" /></button>
        </header>
        <div className="media-comparison-switch" role="group" aria-label={t("works.detail.visibleVersion")}>
          <button type="button" aria-pressed={side === "a"} onClick={() => setSide("a")}>A · V{task.version_number ?? 1}</button>
          <button type="button" aria-pressed={side === "b"} onClick={() => setSide("b")}>B · V{comparison.version_number ?? 1}</button>
        </div>
        <div className="media-comparison-body" data-overlay-scroll="allow" tabIndex={0}>
          <VersionComparisonCard key={task.task_id} task={task} imageUrl={imageUrl} token={token} label={`A · V${task.version_number ?? 1}`} visible={side === "a"} />
          <VersionComparisonCard key={comparison.task_id} task={comparison} token={token} label={`B · V${comparison.version_number ?? 1}`} visible={side === "b"} />
        </div>
      </div>
    </div>, document.body,
  );
}

function VersionComparisonCard(props: { task: VideoTaskDetail; imageUrl?: string; token: string; label: string; visible: boolean }) {
  const { task, token, label, visible } = props;
  const { t } = useI18n();
  const imageUrl = props.imageUrl ?? extractImageUrls(task)[0] ?? "";
  const [source, setSource] = useState("");
  const [state, setState] = useState("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setSource(""); setState("loading");
    if (!imageUrl) { setState("error"); return; }
    const controller = new AbortController();
    let objectUrl = "";
    const headers = new Headers();
    if (token.trim()) headers.set("Authorization", `Bearer ${token.trim()}`);
    void fetch(imageUrl, { headers, signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.blob(); })
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob); setSource(objectUrl); setState("ready");
      })
      .catch(() => { if (!controller.signal.aborted) setState("error"); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [imageUrl, token, attempt]);
  return <article className="media-comparison-card" data-visible={visible}>
    <h3>{label}</h3>
    <div className="media-comparison-image">
      {state === "ready" ? <img src={source} alt={label} onError={() => setState("error")} />
        : <div className="media-comparison-placeholder" data-state={state} role="status">
          <p>{t(state === "error" ? "works.detail.imageFailed" : "common.loading")}</p>
          {state === "error" ? <button type="button" className="btn-secondary" onClick={() => setAttempt((value) => value + 1)}>{t("create.failure.retry")}</button> : null}
        </div>}
    </div>
    <details className="media-comparison-caption"><summary>{t("works.detail.description")}<CaretDown size={16} weight="regular" aria-hidden="true" /></summary><p data-overlay-scroll="allow" tabIndex={0}>{describeTaskPrompt(task.prompt).text || t("works.emptyPrompt")}</p></details>
  </article>;
}

function renderRetryButtons(actions: SidebarRetryActions | undefined, t: TranslateFn) {
  if (!actions) return null;
  if (actions.onDefault) return <button type="button" className="btn-secondary text-xs" onClick={actions.onDefault} disabled={actions.disabled}>{actions.defaultLabel ?? t("works.generateAgain")}</button>;
  return <>
    {actions.onSameSeed ? <button type="button" className="btn-secondary text-xs" onClick={actions.onSameSeed} disabled={actions.disabled}>{actions.sameSeedLabel ?? t("works.generateAgainSameSeed")}</button> : null}
    {actions.onNewSeed ? <button type="button" className="btn-secondary text-xs" onClick={actions.onNewSeed} disabled={actions.disabled}>{actions.newSeedLabel ?? t("works.generateAgainNewSeed")}</button> : null}
  </>;
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}
