import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Cube,
  IdentificationCard,
  MapPin,
  PencilSimple,
  Plus,
  Star,
  Trash,
  UploadSimple,
  X,
} from "@phosphor-icons/react";
import { createSubject, deleteSubject, fetchSubjects, updateSubject, uploadFile } from "../api";
import { UploadedImage } from "../components/UploadedImage";
import { useI18n } from "../i18n";
import { useAppSettingsStore } from "../state";
import type {
  SubjectAsset,
  SubjectAssetInput,
  SubjectKind,
  SubjectReference,
} from "../types";

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

export function SubjectsPage() {
  const { locale } = useI18n();
  const isZh = locale === "zh-CN";
  const token = useAppSettingsStore((state) => state.gatewayToken);
  const queryClient = useQueryClient();
  const subjectsQuery = useQuery({
    queryKey: ["subjects", token],
    queryFn: () => fetchSubjects(token),
  });
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

  const resetEditor = (subject?: SubjectAsset) => {
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
  });

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

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="m-0 text-label">{isZh ? "视觉资产" : "Visual assets"}</p>
          <h1 className="m-0 mt-2 text-3xl font-semibold tracking-tight text-[var(--c-text)]">
            {isZh ? "主体库" : "Subjects"}
          </h1>
          <p className="m-0 mt-2 max-w-2xl text-sm leading-6 text-[var(--c-text-secondary)]">
            {isZh
              ? "保存人物、物品和固定场景的身份描述与参考图，在创作时一键复用。"
              : "Keep identity notes and approved references for recurring characters, objects, and locations."}
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={() => resetEditor()}>
          <Plus size={16} />
          {isZh ? "新建主体" : "New subject"}
        </button>
      </header>

      {subjectsQuery.isLoading ? (
        <div className="card p-10 text-center text-sm text-[var(--c-text-secondary)]">
          {isZh ? "正在加载主体库…" : "Loading subjects…"}
        </div>
      ) : (subjectsQuery.data?.length ?? 0) === 0 ? (
        <button
          type="button"
          className="card flex min-h-64 flex-col items-center justify-center gap-3 border-dashed text-center"
          onClick={() => resetEditor()}
        >
          <IdentificationCard size={32} className="text-[var(--c-text-tertiary)]" />
          <strong className="text-[var(--c-text)]">{isZh ? "建立第一个固定主体" : "Create your first subject"}</strong>
          <span className="max-w-md text-sm leading-6 text-[var(--c-text-secondary)]">
            {isZh ? "先添加一张身份锚点，之后可继续补充正面、侧面或细节参考。" : "Start with one identity anchor, then add useful angles and details."}
          </span>
        </button>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {subjectsQuery.data?.map((subject) => {
            const Icon = KIND_ICONS[subject.kind];
            const primary = subject.references.find((item) => item.is_primary) ?? subject.references[0];
            return (
              <article key={subject.subject_id} className="card overflow-hidden p-0">
                <div className="aspect-[4/3] bg-[var(--c-surface-inset)]">
                  {primary ? (
                    <UploadedImage
                      fileId={primary.file_id}
                      token={token}
                      alt={subject.name}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-[var(--c-text-tertiary)]">
                      <Icon size={36} />
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <Icon size={15} />
                        <span className="text-xs text-[var(--c-text-secondary)]">{kindLabel(subject.kind, isZh)}</span>
                      </div>
                      <h2 className="m-0 mt-1 text-base font-semibold text-[var(--c-text)]">{subject.name}</h2>
                    </div>
                    <button type="button" className="btn-ghost" onClick={() => resetEditor(subject)} aria-label={isZh ? "编辑" : "Edit"}>
                      <PencilSimple size={16} />
                    </button>
                  </div>
                  <p
                    className="m-0 min-h-10 text-sm leading-5 text-[var(--c-text-secondary)]"
                    style={{ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, overflow: "hidden" }}
                  >
                    {subject.description || (isZh ? "尚未填写身份描述" : "No identity description yet")}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {subject.fixed_traits.slice(0, 3).map((trait) => <span key={trait} className="tag">{trait}</span>)}
                    <span className="tag">{isZh ? `${subject.references.length} 张参考` : `${subject.references.length} refs`}</span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {showEditor ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[var(--c-overlay-scrim)] p-0 sm:items-center sm:p-6" onMouseDown={() => setShowEditor(false)}>
          <form
            className="max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-t-3xl border border-border bg-[var(--c-surface)] p-5 shadow-[var(--shadow-overlay)] sm:rounded-3xl sm:p-7"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event: FormEvent) => { event.preventDefault(); saveMutation.mutate(); }}
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="m-0 text-label">{editing ? (isZh ? "编辑主体" : "Edit subject") : (isZh ? "新建主体" : "New subject")}</p>
                <h2 className="m-0 mt-1 text-xl font-semibold text-[var(--c-text)]">{name || (isZh ? "未命名主体" : "Untitled subject")}</h2>
              </div>
              <button type="button" className="btn-ghost min-h-11 min-w-11" onClick={() => setShowEditor(false)}><X size={18} /></button>
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
                <input className="input-base" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} />
              </label>
            </div>

            <label className="mt-5 flex flex-col gap-2 text-sm font-medium text-[var(--c-text)]">
              {isZh ? "身份描述" : "Identity description"}
              <textarea className="input-base min-h-24 resize-y" value={description} onChange={(event) => setDescription(event.target.value)} placeholder={isZh ? "描述这个主体最稳定、最容易辨认的外观。" : "Describe the stable, recognizable appearance of this subject."} />
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

            <div className="mt-6 flex items-center justify-between gap-3">
              <div>
                <h3 className="m-0 text-sm font-semibold text-[var(--c-text)]">{isZh ? "参考集" : "Reference set"}</h3>
                <p className="m-0 mt-1 text-xs text-[var(--c-text-secondary)]">{isZh ? "标记一张主参考，并注明角度或用途。" : "Choose one primary anchor and label each angle or purpose."}</p>
              </div>
              <label className="btn-secondary min-h-11 cursor-pointer">
                <UploadSimple size={16} />
                {isZh ? "添加图片" : "Add images"}
                <input
                  type="file"
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
              </label>
            </div>

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

            {error ? <p className="mt-4 text-sm text-[var(--c-error-text)]">{error}</p> : null}
            <div className="mt-7 flex items-center justify-between gap-3 border-t border-border pt-5">
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
              <div className="flex gap-2">
                <button type="button" className="btn-secondary min-h-11" onClick={() => setShowEditor(false)}>{isZh ? "取消" : "Cancel"}</button>
                <button type="submit" className="btn-primary min-h-11" disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? (isZh ? "保存中…" : "Saving…") : (isZh ? "保存主体" : "Save subject")}
                </button>
              </div>
            </div>
          </form>
        </div>
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
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-[var(--c-surface-raised)] p-2.5">
      {props.image}
      <div className="min-w-0 flex-1">
        <p className="m-0 truncate text-xs text-[var(--c-text-secondary)]">{props.name}</p>
        <input className="input-base mt-1 w-full py-1.5 text-sm" value={props.role} onChange={(event) => props.onRoleChange(event.target.value)} placeholder={props.isZh ? "例如：3/4 全身" : "e.g. 3/4 full body"} />
      </div>
      <button type="button" className={props.primary ? "btn-primary px-3" : "btn-ghost px-3"} onClick={props.onPrimary} title={props.isZh ? "设为主参考" : "Set primary"}>
        <Star size={16} weight={props.primary ? "fill" : "regular"} />
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

function splitTraits(value: string): string[] {
  return Array.from(new Set(value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)));
}

function kindLabel(kind: SubjectKind, isZh: boolean): string {
  if (kind === "character") return isZh ? "人物" : "Character";
  if (kind === "object") return isZh ? "物品" : "Object";
  return isZh ? "场景" : "Location";
}
