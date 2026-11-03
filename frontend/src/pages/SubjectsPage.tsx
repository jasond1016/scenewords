import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  Cube,
  IdentificationCard,
  MapPin,
  Sparkle,
  Star,
  Trash,
  UploadSimple,
  UserPlus,
  X,
} from "@phosphor-icons/react";
import {
  addSubjectReferenceFromTask,
  createSubject,
  deleteSubject,
  fetchSubjects,
  updateSubject,
  uploadFile,
} from "../api";
import { HeaderActions } from "../components/AppTopBar";
import { UploadedImage } from "../components/UploadedImage";
import { useI18n } from "../i18n";
import { useAppSettingsStore } from "../state";
import type {
  SubjectAsset,
  SubjectAssetInput,
  SubjectKind,
  SubjectReference,
  VideoTaskDetail,
} from "../types";
import { extractImageUrls } from "../utils";

interface PendingReference {
  file: File;
  role: string;
  isPrimary: boolean;
}

const KIND_ICONS = {
  character: IdentificationCard,
  object: Cube,
  location: MapPin,
};

export function SubjectsPage({ tasks }: { tasks: VideoTaskDetail[] }) {
  const { locale, t } = useI18n();
  const isZh = locale === "zh-CN";
  const token = useAppSettingsStore((state) => state.gatewayToken);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const subjectsQuery = useQuery({
    queryKey: ["subjects", token],
    queryFn: () => fetchSubjects(token),
  });
  const [kindFilter, setKindFilter] = useState<"all" | SubjectKind>("all");
  const [editing, setEditing] = useState<SubjectAsset | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [kind, setKind] = useState<SubjectKind>("character");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [fixedTraits, setFixedTraits] = useState("");
  const [variableTraits, setVariableTraits] = useState("");
  const [existingReferences, setExistingReferences] = useState<SubjectReference[]>([]);
  const [pendingReferences, setPendingReferences] = useState<PendingReference[]>([]);
  const [error, setError] = useState("");
  const editorRef = useRef<HTMLDialogElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const editorTriggerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!showEditor) return;
    const dialog = editorRef.current;
    dialog?.showModal();
    dialog?.querySelector<HTMLInputElement>("input[name='name']")?.focus();
    return () => {
      dialog?.close();
      if (editorTriggerRef.current?.isConnected) editorTriggerRef.current.focus();
    };
  }, [showEditor]);

  const resetEditor = (subject?: SubjectAsset) => {
    editorTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setEditing(subject ?? null);
    setKind(subject?.kind ?? "character");
    setName(subject?.name ?? "");
    setDescription(subject?.description ?? "");
    setFixedTraits(subject?.fixed_traits.join("\n") ?? "");
    setVariableTraits(subject?.variable_traits.join("\n") ?? "");
    setExistingReferences(subject?.references ?? []);
    setPendingReferences([]);
    setError("");
    setShowEditor(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const cleanName = name.trim();
      if (!cleanName) {
        throw new Error(isZh ? "请输入主体名称。" : "Enter a subject name.");
      }
      const uploaded = [];
      for (const reference of pendingReferences) {
        const file = await uploadFile(reference.file, token);
        uploaded.push({
          file_id: file.file_id,
          role: reference.role.trim() || (isZh ? "参考" : "Reference"),
          is_primary: reference.isPrimary,
        });
      }
      const payload: SubjectAssetInput = {
        kind,
        name: cleanName,
        description: description.trim(),
        fixed_traits: splitTraits(fixedTraits),
        variable_traits: splitTraits(variableTraits),
        references: [
          ...existingReferences.map((reference) => ({
            file_id: reference.file_id,
            role: reference.role,
            is_primary: reference.is_primary,
          })),
          ...uploaded,
        ],
      };
      return editing
        ? updateSubject(editing.subject_id, payload, token)
        : createSubject(payload, token);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["subjects", token] });
      setShowEditor(false);
    },
    onError: (reason) => setError(reason instanceof Error ? reason.message : String(reason)),
  });

  const removeMutation = useMutation({
    mutationFn: (subjectId: string) => deleteSubject(subjectId, token),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["subjects", token] });
      setShowEditor(false);
    },
    onError: (reason) => setError(reason instanceof Error ? reason.message : String(reason)),
  });

  const collectMutation = useMutation({
    mutationFn: (input: { taskId: string; imageIndex: number; role: string }) => {
      if (!editing) {
        throw new Error("Missing subject");
      }
      return addSubjectReferenceFromTask(
        editing.subject_id,
        {
          task_id: input.taskId,
          image_index: input.imageIndex,
          role: input.role,
          is_primary: existingReferences.length === 0,
        },
        token,
      );
    },
    onSuccess: async (subject) => {
      setEditing(subject);
      setExistingReferences(subject.references);
      await queryClient.invalidateQueries({ queryKey: ["subjects", token] });
    },
    onError: (reason) => setError(reason instanceof Error ? reason.message : String(reason)),
  });

  const generatedCandidates = editing
    ? tasks
        .filter(
          (task) =>
            task.asset_type === "image" &&
            task.status === "succeeded" &&
            task.subject_bindings.some((binding) => binding.subject_id === editing.subject_id),
        )
        .flatMap((task) =>
          extractImageUrls(task).map((url, imageIndex) => ({ task, url, imageIndex })),
        )
    : [];

  const generateReference = (role: string) => {
    if (!editing) return;
    setShowEditor(false);
    navigate(
      `/create?subjectId=${encodeURIComponent(editing.subject_id)}&subjectRole=${encodeURIComponent(role)}`,
    );
  };

  const markPrimary = (source: "existing" | "pending", index: number) => {
    setExistingReferences((items) =>
      items.map((item, itemIndex) => ({
        ...item,
        is_primary: source === "existing" && itemIndex === index,
      })),
    );
    setPendingReferences((items) =>
      items.map((item, itemIndex) => ({
        ...item,
        isPrimary: source === "pending" && itemIndex === index,
      })),
    );
  };

  const allSubjects = subjectsQuery.data ?? [];
  const visibleSubjects =
    kindFilter === "all" ? allSubjects : allSubjects.filter((subject) => subject.kind === kindFilter);
  const kindFilters: Array<{ value: "all" | SubjectKind; label: string }> = [
    { value: "all", label: t("subjects.filter.all") },
    { value: "character", label: kindLabel("character", isZh) },
    { value: "object", label: kindLabel("object", isZh) },
    { value: "location", label: kindLabel("location", isZh) },
  ];

  return (
    <div className="flex w-full min-w-0 flex-col">
      <HeaderActions>
        <button
          type="button"
          className="btn-secondary min-h-11"
          aria-label={t("subjects.create")}
          title={t("subjects.create")}
          onClick={() => resetEditor()}
        >
          <UserPlus size={19} weight="regular" />
          {t("subjects.create")}
        </button>
      </HeaderActions>

      <header className="page-header mb-10">
        <div>
          <h1 className="page-title">{t("subjects.title")}</h1>
        </div>
        <div className="mb-1 flex min-w-0 flex-wrap items-center gap-2" role="group" aria-label={t("subjects.title")}>
          {kindFilters.map((filter) => (
            <button
              key={filter.value}
              type="button"
              aria-pressed={kindFilter === filter.value}
              className={`filter-pill ${kindFilter === filter.value ? "filter-pill-active" : ""}`}
              onClick={() => setKindFilter(filter.value)}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </header>

      {subjectsQuery.isLoading ? (
        <div role="status" aria-label={t("common.loading")}><div className="subject-grid" aria-hidden="true">
          {Array.from({ length: 10 }, (_, index) => (
            <div key={index} className="flex flex-col gap-3">
              <div className="skeleton aspect-square w-full" />
              <div className="skeleton h-3 w-1/3" />
            </div>
          ))}
        </div></div>
      ) : subjectsQuery.isError ? (
        <div className="card flex flex-wrap items-center gap-3" role="alert">
          <span>{subjectsQuery.error.message}</span>
          <button type="button" className="btn-secondary" onClick={() => void subjectsQuery.refetch()}>{t("create.failure.retry")}</button>
        </div>
      ) : allSubjects.length === 0 ? (
        <button
          type="button"
          className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-[var(--radius-lg)] border border-dashed border-[var(--c-border-strong)] bg-transparent text-center"
          onClick={() => resetEditor()}
        >
          <IdentificationCard size={30} weight="light" className="text-[var(--c-text-tertiary)]" />
          <strong className="text-sm font-medium text-[var(--c-text)]">{t("subjects.emptyTitle")}</strong>
        </button>
      ) : visibleSubjects.length === 0 ? (
        <p className="py-16 text-center text-sm text-[var(--c-text-secondary)]">{t("subjects.emptyFiltered")}</p>
      ) : (
        <div className="subject-grid">
          {visibleSubjects.map((subject) => {
            const Icon = KIND_ICONS[subject.kind];
            const primary = subject.references.find((item) => item.is_primary) ?? subject.references[0];
            return (
              <div
                key={subject.subject_id}
                className="subject-card min-w-0"
                onClick={() => resetEditor(subject)}
              >
                <div className="subject-card-media media-ring">
                  <button type="button" className="subject-card-media-inner block w-full border-0 bg-transparent p-0" aria-label={subject.name}>
                    {primary ? (
                      <UploadedImage
                        fileId={primary.file_id}
                        token={token}
                        alt={subject.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-[var(--c-text-tertiary)]">
                        <Icon size={32} weight="light" />
                      </div>
                    )}
                  </button>
                </div>
                <span className="subject-card-name">{subject.name}</span>
                <button
                  type="button"
                  className="subject-use-pill"
                  onClick={(event) => {
                    event.stopPropagation();
                    navigate(`/create?useSubject=${encodeURIComponent(subject.subject_id)}`);
                  }}
                >
                  {t("subjects.useForCreate")}
                  <ArrowRight size={13} weight="regular" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {showEditor ? (
        <dialog
          ref={editorRef}
          aria-labelledby="subject-editor-title"
          className="fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none items-end justify-center border-0 bg-[var(--c-overlay-scrim)] p-0 open:flex sm:items-center sm:p-6"
          onCancel={() => setShowEditor(false)}
          onMouseDown={(event) => { if (event.target === event.currentTarget) setShowEditor(false); }}
        >
          <form
            className="subject-editor max-h-[92dvh] w-full min-w-0 max-w-3xl overflow-y-auto rounded-t-3xl border border-border bg-[var(--c-surface)] shadow-[var(--shadow-overlay)] sm:rounded-3xl"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event: FormEvent) => { event.preventDefault(); saveMutation.mutate(); }}
          >
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <h2 id="subject-editor-title" className="m-0 text-heading">{editing ? (isZh ? "编辑主体" : "Edit subject") : (isZh ? "新建主体" : "New subject")}</h2>
              </div>
              <button type="button" className="topbar-icon-btn" aria-label={t("common.close")} onClick={() => setShowEditor(false)}><X size={20} /></button>
            </div>

            <div className="mt-6 grid gap-5 sm:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm font-medium text-[var(--c-text)]">
                {isZh ? "类型" : "Type"}
                <select className="input-base" value={kind} onChange={(event) => setKind(event.target.value as SubjectKind)}>
                  <option value="character">{kindLabel("character", isZh)}</option>
                  <option value="object">{kindLabel("object", isZh)}</option>
                  <option value="location">{kindLabel("location", isZh)}</option>
                </select>
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium text-[var(--c-text)]">
                {isZh ? "名称" : "Name"}
                <input name="name" required className="input-base min-w-0" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
              </label>
            </div>

            <label className="mt-5 flex flex-col gap-2 text-sm font-medium text-[var(--c-text)]">
              {isZh ? "身份描述" : "Identity description"}
              <textarea className="input-base min-h-24 resize-y" value={description} onChange={(event) => setDescription(event.target.value)} />
            </label>

            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <label className="flex flex-col gap-2 text-sm font-medium text-[var(--c-text)]">
                {isZh ? "固定特征（每行一条）" : "Fixed traits (one per line)"}
                <textarea className="input-base min-h-28 resize-y" value={fixedTraits} onChange={(event) => setFixedTraits(event.target.value)} placeholder={isZh ? "黑色短发\n黄色卫衣\n圆脸" : "Short black hair\nYellow hoodie\nRound face"} />
              </label>
              <label className="flex flex-col gap-2 text-sm font-medium text-[var(--c-text)]">
                {isZh ? "可变特征（每行一条）" : "Variable traits (one per line)"}
                <textarea className="input-base min-h-28 resize-y" value={variableTraits} onChange={(event) => setVariableTraits(event.target.value)} placeholder={isZh ? "表情\n姿势\n手持物" : "Expression\nPose\nHeld object"} />
              </label>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="m-0 text-sm font-semibold text-[var(--c-text)]">{isZh ? "参考集" : "Reference set"}</h3>
              </div>
              <button type="button" className="btn-secondary min-h-11" onClick={() => uploadRef.current?.click()}>
                <UploadSimple size={16} />
                {isZh ? "添加图片" : "Add images"}
              </button>
                <input
                  ref={uploadRef}
                  type="file"
                  aria-label={isZh ? "添加参考图片" : "Add reference images"}
                  className="hidden"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    const hasPrimary = existingReferences.some((item) => item.is_primary) || pendingReferences.some((item) => item.isPrimary);
                    setPendingReferences((items) => [
                      ...items,
                      ...files.map((file, index) => ({ file, role: isZh ? "参考" : "Reference", isPrimary: !hasPrimary && index === 0 })),
                    ]);
                    event.target.value = "";
                  }}
                />
            </div>

            {editing ? (
              <section className="mt-4 rounded-2xl border border-border bg-[var(--c-surface-raised)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="m-0 flex items-center gap-2 text-sm font-semibold text-[var(--c-text)]">
                      <Sparkle size={16} />
                      {isZh ? "AI 辅助参考集" : "AI-assisted reference set"}
                    </h3>
                    <p className="m-0 mt-1 text-xs leading-5 text-[var(--c-text-secondary)]">
                      {isZh ? "生成完成后，回到这里收录参考。" : "Return here after generation to add references."}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {existingReferences.length === 0 ? (
                    <button type="button" className="btn-primary text-xs" onClick={() => generateReference("anchor")}>
                      <Sparkle size={14} /> {isZh ? "生成身份候选" : "Generate identity candidate"}
                    </button>
                  ) : (
                    [
                      ["front", isZh ? "正面全身" : "Front"],
                      ["threeQuarter", isZh ? "3/4 全身" : "Three-quarter"],
                      ["side", isZh ? "侧面全身" : "Side"],
                      ["expression", isZh ? "表情特写" : "Expressions"],
                    ].map(([role, label]) => (
                      <button key={role} type="button" className="btn-secondary text-xs" onClick={() => generateReference(role)}>
                        {label}
                      </button>
                    ))
                  )}
                </div>
                {generatedCandidates.length ? (
                  <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {generatedCandidates.slice(0, 9).map(({ task, url, imageIndex }) => (
                      <article key={`${task.task_id}-${imageIndex}`} className="overflow-hidden rounded-2xl border border-border bg-[var(--c-surface)]">
                        <AuthenticatedResultImage url={url} token={token} alt={editing.name} />
                        <div className="p-2">
                          <button
                            type="button"
                            className="btn-secondary w-full text-xs"
                            disabled={collectMutation.isPending}
                            onClick={() =>
                              collectMutation.mutate({
                                taskId: task.task_id,
                                imageIndex,
                                role: existingReferences.length ? (isZh ? "AI 派生参考" : "AI-derived reference") : (isZh ? "身份锚点" : "Identity anchor"),
                              })
                            }
                          >
                            {existingReferences.length === 0
                              ? isZh ? "设为主锚点" : "Use as anchor"
                              : isZh ? "收录参考" : "Add reference"}
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}

            <div className="mt-4 space-y-2">
              {existingReferences.map((reference, index) => (
                <ReferenceRow
                  key={reference.reference_id}
                  image={<UploadedImage fileId={reference.file_id} token={token} alt={reference.role} className="h-14 w-14 rounded-xl object-cover" />}
                  name={reference.original_name}
                  role={reference.role}
                  primary={reference.is_primary}
                  onRoleChange={(role) => setExistingReferences((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, role } : item))}
                  onPrimary={() => markPrimary("existing", index)}
                  onRemove={() => setExistingReferences((items) => items.filter((_, itemIndex) => itemIndex !== index))}
                  isZh={isZh}
                />
              ))}
              {pendingReferences.map((reference, index) => (
                <ReferenceRow
                  key={`${reference.file.name}-${reference.file.lastModified}-${index}`}
                  image={<LocalImage file={reference.file} />}
                  name={reference.file.name}
                  role={reference.role}
                  primary={reference.isPrimary}
                  onRoleChange={(role) => setPendingReferences((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, role } : item))}
                  onPrimary={() => markPrimary("pending", index)}
                  onRemove={() => setPendingReferences((items) => items.filter((_, itemIndex) => itemIndex !== index))}
                  isZh={isZh}
                />
              ))}
            </div>

            {error ? <p role="alert" className="mt-4 text-sm text-[var(--c-error-text)]">{error}</p> : null}
            <div className="mt-7 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
              {editing ? (
                <button
                  type="button"
                  className="btn-ghost text-[var(--c-error-text)]"
                  disabled={removeMutation.isPending}
                  onClick={() => {
                    if (window.confirm(isZh ? `删除“${editing.name}”？参考图片文件会保留。` : `Delete “${editing.name}”? Uploaded files will remain.`)) {
                      removeMutation.mutate(editing.subject_id);
                    }
                  }}
                >
                  <Trash size={16} /> {isZh ? "删除主体" : "Delete subject"}
                </button>
              ) : <span />}
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-secondary min-h-11" onClick={() => setShowEditor(false)}>{isZh ? "取消" : "Cancel"}</button>
                <button type="submit" className="btn-primary min-h-11" disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? (isZh ? "保存中…" : "Saving…") : (isZh ? "保存主体" : "Save subject")}
                </button>
              </div>
            </div>
          </form>
        </dialog>
      ) : null}
    </div>
  );
}

function ReferenceRow(props: {
  image: React.ReactNode;
  name: string;
  role: string;
  primary: boolean;
  onRoleChange: (role: string) => void;
  onPrimary: () => void;
  onRemove: () => void;
  isZh: boolean;
}) {
  const roleId = useId();
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-3 rounded-2xl border border-border bg-[var(--c-surface-raised)] p-2.5">
      {props.image}
      <div className="min-w-0 flex-[1_1_12rem]">
        <p className="m-0 break-all text-xs text-[var(--c-text-secondary)]">{props.name}</p>
        <label htmlFor={roleId} className="text-xs text-[var(--c-text-secondary)]">{props.isZh ? "角度或用途" : "Angle or purpose"}</label>
        <input id={roleId} className="input-base mt-1 w-full min-w-0 py-1.5 text-sm" value={props.role} onChange={(event) => props.onRoleChange(event.target.value)} placeholder={props.isZh ? "例如：3/4 全身" : "e.g. 3/4 full body"} />
      </div>
      <button type="button" className={props.primary ? "btn-primary px-3" : "btn-ghost px-3"} onClick={props.onPrimary} aria-pressed={props.primary} aria-label={`${props.isZh ? "设为主参考" : "Set primary"}: ${props.name}`} title={props.isZh ? "设为主参考" : "Set primary"}>
        <Star size={16} weight={props.primary ? "fill" : "regular"} />
        {props.primary ? (props.isZh ? "主参考" : "Primary") : (props.isZh ? "设为主参考" : "Set primary")}
      </button>
      <button type="button" className="btn-ghost px-3" onClick={props.onRemove} aria-label={props.isZh ? "移除" : "Remove"}><X size={16} /></button>
    </div>
  );
}

function LocalImage({ file }: { file: File }) {
  const [source, setSource] = useState("");
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSource(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return source ? <img src={source} alt="" className="h-14 w-14 rounded-xl object-cover" /> : <div className="h-14 w-14 rounded-xl bg-[var(--c-surface-inset)]" />;
}

function AuthenticatedResultImage(props: { url: string; token: string; alt: string }) {
  const [source, setSource] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    const headers = new Headers();
    if (props.token.trim()) headers.set("Authorization", `Bearer ${props.token.trim()}`);
    fetch(props.url, { headers, signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [props.token, props.url]);
  return source ? (
    <img src={source} alt={props.alt} className="aspect-square w-full object-cover" />
  ) : (
    <div className="aspect-square w-full animate-pulse bg-[var(--c-surface-inset)]" />
  );
}

function splitTraits(value: string): string[] {
  return Array.from(new Set(value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)));
}

function kindLabel(kind: SubjectKind, isZh: boolean): string {
  if (kind === "character") return isZh ? "人物" : "Character";
  if (kind === "object") return isZh ? "物体" : "Object";
  return isZh ? "场景" : "Location";
}
