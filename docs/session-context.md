# Image conversation context

`POST /v1/image/generations` accepts the additive, optional request field:

```ts
image_context?: {
  mode: 'latest' | 'selected' | 'none'
  task_id?: string | null
  image_index?: number // nonnegative integer; default 0
} | null
```

- Omitted, `null`, or `none`: existing behavior; no automatic image reference.
- `latest`: at submission, select the current scene's successful image result by
  `(created_at, task_id)` descending, using output **0** (the supplied index is
  ignored). Failed, running, queued, video, other-scene, and missing-output tasks
  are excluded. A usable local archive or a remote image URL counts as an output;
  a remote URL is not a promise that its download will succeed.
- `selected`: import `task_id` and the requested output index. Without supplied
  reference inputs, `task_id` is required and the source must be a completed image
  task with that output. Explicit cross-scene reuse is allowed.

Ordinary image composition should send `latest` only for a nonempty scene without
user attachments or an explicit detail edit. Opening/reading history never imports
an image. New scenes and videos should omit this field or use `none`.

## Precedence, lineage, and durability

Supplied nonempty `provider_options.image_file_ids`, `image`,
`input_reference_file_ids`, `input_references`, or `input_reference` take precedence
over either context mode. They are not merged with a latest/selected source, and
no context import occurs. Their normal provider validation still applies. Existing
detail edits using imported `image_file_ids` continue to work without this field.
Clients should omit context when supplying explicit references. When both are
supplied, selected metadata is inert and attachments are authoritative.

The scene and caller's parent/generation lineage are validated **before** importing.
For `latest` without explicit references, a chosen source with a generation becomes
the request's parent and generation, replacing valid but stale same-scene lineage
(including a newer failed/running version). Invalid/cross-scene caller lineage is
still rejected, not repaired. A legacy source without a generation leaves caller
lineage unchanged. `selected` and attachment-based edits never rewrite lineage;
their explicit reuse may cross scenes, but their parent must belong to the target
scene and generation as before.

The source is fixed before any asynchronous download. Successful import persists
the actual `provider_options.image_file_ids` and
`image_context: {mode: 'selected', task_id, image_index}` **before routing and enqueue**.
Task details expose this optional field as provenance. Smart-routing intent also
contains those fixed IDs. File resolution adds internal file descriptors without
removing the IDs. Queued execution and both auto/exact retries reuse them without
reselecting or reimporting, even if newer results arrive or the original output
disappears. Existing seed, prompt override, and retry lineage rules are unchanged.

When no scene/result exists, `latest` is persisted as `none`, so retry cannot acquire
a subsequently created image. Import failures fail the submission; they never
silently create a text-only task or fall back to an older result. Identical imported
content can reuse a verified existing file record (SHA-256 plus MIME/content check),
avoiding another upload copy without a database migration. Remote recovery may
still require a download; simultaneous independent imports may create duplicate
files. A missing pinned upload fails normal file validation rather than reselecting.
Import precedes routing/provider validation; a later rejection can leave an unused
local upload, but never enqueues a text-only substitute or calls generation.

`POST /v1/video/generations` rejects `latest`/`selected` with HTTP 400; omitted/null/
`none` retain existing video behavior. Legacy records require no backfill. This
feature adds no LLM call and does not concatenate history or alter prompt text.

## Composer and unsent drafts

History entry (including `/#/create?sceneId=...`) selects a scene, not a sent
prompt or a snapshot. The ordinary composer stays empty unless that exact scene
has an unsent draft. Its implicit latest result is neither a user attachment nor
a permanent context strip. Continuation rules are available in More → Conversations & references.
An explicit image edit in the viewer still uses the chosen task/output, including
an older task or output 1+, and takes precedence over implicit latest context.
User attachments/subject reference images remain visible; removing the final
explicit image returns an existing image scene to ordinary latest continuation.
New chats use an independent draft and never inherit another scene's image.

Unsent drafts use IndexedDB structured cloning (including real `File` contents),
with an in-memory cache for navigation. The namespace hashes
`[origin, gateway identity, sceneId or "$new", image/video kind]`; the raw gateway
token is not stored in draft keys or values. Persisted fields are sanitized
composer values, explicit references/subjects/edit source, lineage, preferences,
`dirty`, `revision`, and `updatedAt`. Model transport overrides are not restored.

Each edit increments the revision. Acceptance clears content only if the submitted
revision still matches, including after unmount/remount; newer edits and other
scenes survive. Submission/import failure retains the draft. Preference-only
values survive clearing. Ratio/format preferences remain separate from content.
Submission also captures the navigation revision: a late first-message response
can clear its accepted draft, but cannot reopen its scene after New chat.
Late history/reuse responses are invalidated by new chat, scene change, gateway
change, or departure. History loading and IndexedDB restoration do not permit
typing into an as-yet-unselected scene.

### Immediate history navigation

Clicking history synchronously changes `sceneId` in the URL and closes the drawer.
The URL (or a legacy `returnSessionId` navigation state) owns the selected identity;
Back/Forward, reload and direct links use the same path. The scene detail query is
the only detail-request owner. The history index, scene detail and scoped draft
restoration start independently; a direct link does not need index membership.

The existing in-memory React Query cache is keyed by gateway identity and scene.
Only the target scene's cached transcript may appear; an uncached target shows a
named loading skeleton, never the preceding transcript. No transcript is added to
localStorage/IndexedDB, and no history-wide prefetch is introduced. Fresh queries
reuse the five-second cache window; stale cached content can refresh in place.
Leaving a scene consumes its query AbortSignal, and navigation revisions still
invalidate late submissions/reuse. Failed or paused/offline reads show a local
error and Retry without redirecting to a different scene.

Composer activation waits for the target's image/video kind, matching operation
and draft hydration, but transcript entry does not. Pending/failed unknown context
cannot submit, including keyboard submission. Image loading/decoding only affects
its existing aspect-ratio placeholder, not navigation or composer activation.
The backend still resolves and pins implicit latest images when accepting a task;
cached history never chooses an automatic upload or sends a historical prompt.

“Restore this chat's unsent draft” controls disk restoration after reopening the
page, not in-memory A → B → A navigation. Drafts are local to this browser, not
synced across devices or live-synchronized between tabs. They persist until sent,
replaced, or cleared via Settings → Privacy & Storage → Clear local cache. Storage/quota/secure-context
failures display a warning and keep the current in-memory draft; disk recovery
then is not guaranteed. The cache summary's byte count covers localStorage only,
not IndexedDB attachment bytes.

The unscoped `scenewords_last_session_v3` snapshot and legacy per-field prompt
keys are **never read to restore composer content**. They are not assigned to any
scene or silently migrated. Existing non-content preferences still load; there
is no automatic legacy draft import, DB migration, or record backfill. Old API
callers that omit `image_context` retain their previous behavior.

## Verification

- `uv run --group dev pytest -q`: temporary stores and fake providers; includes
  deterministic selection, multi-output, unfinished exclusion, precedence,
  lineage, downloads, queued execution, both retry modes and import failures.
- `pnpm --dir frontend test`: existing frontend regression checks.
- `pnpm --dir frontend build`, then `pnpm --dir frontend test:browser`: the built
  bundle in a disposable Vite preview, with all `/v1` requests intercepted. No
  real DB or provider calls. Uses installed Edge by default; set
  `PLAYWRIGHT_CHANNEL=chromium` to use an installed Playwright Chromium instead.
  Browser cases cover direct/history entry, old caches, scoped drafts, File
  restoration/preview/removal, delayed/failed/other-scene/unmounted submission,
  selected older output editing, new chat versus late history responses, videos,
  gateway identity and clearing IndexedDB drafts. Held scene/index/media requests
  cover immediate history entry, scoped cached transcripts, A → B → A,
  Back/Forward, offline/error recovery, unmount and blocked premature submission;
  English dark 200% text is checked at 320px as well.
