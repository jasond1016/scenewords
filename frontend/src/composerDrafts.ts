import { useEffect, useRef, useState, type SetStateAction } from "react";
import { sanitizeComposerValues } from "./composerOptions";

export interface ComposerDraft {
  revision: number;
  dirty: boolean;
  updatedAt: string;
  routingModel: string;
  values: Record<string, string>;
  files: Record<string, File[]>;
  reusedFileIds: Record<string, string[]>;
  imageSourceFiles: File[];
  imageSourceReusedFileIds: string[];
  selectedSubjectIds: string[];
  versionEditBasePrompt: string | null;
  modificationInstruction: string;
  generationId: string | null;
  parentVersionId: string | null;
}

export function emptyComposerDraft(revision = 0): ComposerDraft {
  return { revision, dirty: false, updatedAt: new Date().toISOString(), routingModel: "", values: {}, files: {},
    reusedFileIds: {}, imageSourceFiles: [], imageSourceReusedFileIds: [], selectedSubjectIds: [],
    versionEditBasePrompt: null, modificationInstruction: "", generationId: null, parentVersionId: null };
}

export function reviseComposerDraft(current: ComposerDraft, patch: Partial<ComposerDraft>): ComposerDraft {
  const next = { ...current, ...patch, revision: current.revision + 1, updatedAt: new Date().toISOString() };
  next.values = sanitizeComposerValues(next.values);
  next.dirty = Boolean(next.values["request:prompt"]?.trim() || next.modificationInstruction.trim()
    || next.versionEditBasePrompt !== null || next.imageSourceFiles.length || next.imageSourceReusedFileIds.length
    || next.selectedSubjectIds.length || Object.values(next.files).some((files) => files.length)
    || Object.values(next.reusedFileIds).some((ids) => ids.length));
  return next;
}

// Blob/File values use structured cloning, never JSON/localStorage. Credentials
// are only hashed for the namespace and are not saved with a draft.
async function draftDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("scenewords_composer_drafts_v1", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function diskKey(scope: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(scope));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const drafts = new Map<string, ComposerDraft>();
const writes = new Map<string, Promise<void>>();
const listeners = new Map<string, Set<(draft: ComposerDraft) => void>>();

async function readDraft(scope: string): Promise<ComposerDraft | undefined> {
  if (drafts.has(scope)) return drafts.get(scope);
  const key = await diskKey(scope);
  const database = await draftDatabase();
  try {
    const saved = await new Promise<ComposerDraft | undefined>((resolve, reject) => {
      const request = database.transaction("drafts").objectStore("drafts").get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    // An acknowledgement or edit may have arrived while IndexedDB was loading.
    if (!drafts.has(scope) && saved) drafts.set(scope, saved);
    return drafts.get(scope);
  } finally { database.close(); }
}

function writeDraft(scope: string, draft: ComposerDraft): Promise<void> {
  drafts.set(scope, draft);
  listeners.get(scope)?.forEach((listener) => listener(draft));
  const write = (writes.get(scope) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const key = await diskKey(scope);
    const database = await draftDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction("drafts", "readwrite");
        transaction.objectStore("drafts").put(draft, key);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally { database.close(); }
  });
  writes.set(scope, write);
  return write;
}

export async function clearComposerDrafts(): Promise<void> {
  drafts.clear(); // A late acceptance can no longer revive a deleted draft.
  await Promise.allSettled(writes.values());
  writes.clear();
  const database = await draftDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("drafts", "readwrite");
      transaction.objectStore("drafts").clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { database.close(); }
}

export function useComposerDraft(gateway: string, sceneId: string, kind: "image" | "video", restore: boolean) {
  const scope = JSON.stringify([location.origin, gateway, sceneId || "$new", kind]);
  const [entry, setEntry] = useState({ scope: "", ready: false, draft: emptyComposerDraft() });
  const active = useRef(entry);
  const mounted = useRef(false);
  const [storageError, setStorageError] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const publish = (next: typeof entry) => { active.current = next; setEntry(next); };
  const persist = (key: string, draft: ComposerDraft) => {
    void writeDraft(key, draft).catch(() => { if (mounted.current) setStorageError(true); });
  };
  useEffect(() => {
    let cancelled = false;
    publish({ scope, ready: false, draft: emptyComposerDraft() });
    const subscribers = listeners.get(scope) ?? new Set<(draft: ComposerDraft) => void>();
    const listener = (draft: ComposerDraft) => {
      if (active.current.scope === scope && active.current.ready && active.current.draft !== draft) {
        publish({ scope, ready: true, draft });
      }
    };
    subscribers.add(listener);
    listeners.set(scope, subscribers);
    // The preference controls disk restoration after reopening the app, not
    // loss of an in-memory unsent draft when switching A -> B -> A.
    void (drafts.has(scope) ? Promise.resolve(drafts.get(scope)) : restore ? readDraft(scope) : Promise.resolve(undefined)).then((saved) => {
      if (cancelled) return;
      const draft = drafts.get(scope) ?? saved ?? emptyComposerDraft();
      drafts.set(scope, draft);
      publish({ scope, ready: true, draft });
    }, () => {
      if (cancelled) return;
      setStorageError(true);
      publish({ scope, ready: true, draft: drafts.get(scope) ?? emptyComposerDraft() });
    });
    return () => {
      cancelled = true;
      subscribers.delete(listener);
      if (!subscribers.size) listeners.delete(scope);
    };
  }, [scope, restore]);
  const setField = <K extends keyof ComposerDraft>(key: K) => (value: SetStateAction<ComposerDraft[K]>) => {
    const current = active.current;
    if (!mounted.current || !current.ready || current.scope !== scope) return;
    const nextValue = typeof value === "function"
      ? (value as (previous: ComposerDraft[K]) => ComposerDraft[K])(current.draft[key]) : value;
    if (nextValue === current.draft[key]) return;
    if (key === "values" && JSON.stringify(nextValue) === JSON.stringify(current.draft.values)) return;
    const draft = reviseComposerDraft(current.draft, { [key]: nextValue });
    publish({ ...current, draft });
    persist(scope, draft);
  };
  const acknowledge = (key: string, revision: number) => {
    const saved = drafts.get(key);
    if (!saved || saved.revision !== revision) return;
    const { "request:prompt": _sentPrompt, ...preferences } = saved.values;
    const cleared = { ...emptyComposerDraft(revision + 1), routingModel: saved.routingModel, values: preferences };
    persist(key, cleared);
    if (mounted.current && active.current.scope === key && active.current.draft.revision === revision) {
      publish({ scope: key, ready: true, draft: cleared });
    }
  };
  return { draft: entry.scope === scope ? entry.draft : emptyComposerDraft(),
    ready: entry.scope === scope && entry.ready, scope, setField, acknowledge, storageError,
    isCurrent: (key: string, revision: number) => mounted.current && scope === key
      && active.current.scope === key && active.current.draft.revision === revision };
}
