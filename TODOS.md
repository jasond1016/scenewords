# TODOS

> 优先级: P0 (紧急) > P1 (重要) > P2 (改善) > P3 (Nice-to-have)

---

## P3: WorksPage.tsx 内部变量名 jobs → works 清理

**What:** `WorksPage.tsx` 内部仍有局部变量/函数名包含 `job`（如类型别名、内部 state 名等），需要统一为 `works` 命名。

**Why:** 文件已重命名为 `WorksPage.tsx`，路由为 `/works`，i18n key 为 `works.*`，但内部变量名仍残留 `job`。不影响功能，但影响代码阅读一致性。

**Pros:** 完成后全栈命名 100% 一致，消除最后一处认知摩擦。

**Cons:** 纯重命名，需要小心不改到后端 API 返回的字段名（如 `task_id`、`status` 等是后端 schema 定义的，不应改）。

**Context:** 本次 eng review 已完成文件重命名（`JobsPage.tsx` → `WorksPage.tsx`）、导出名重命名（`JobsPage` → `WorksPage`）、i18n key 重命名（`jobs.*` → `works.*`）、以及 `useTaskNotifications.ts` 中的 `isJobsPath` → `isWorksPath`。剩余的是 WorksPage.tsx 内部的局部变量。

**Depends on / blocked by:** 无。可随时做。

**Added:** 2026-03-22 by /plan-eng-review
