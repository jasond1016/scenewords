# TODOS

> 优先级: P0 (紧急) > P1 (重要) > P2 (改善) > P3 (Nice-to-have)

---

## ~~P3: WorksPage.tsx 内部变量名 jobs → works 清理~~

**Status:** ✅ DONE (2026-03-22, commit a881580)

经检查，WorksPage.tsx 内部已无残留的 `job` 变量名。唯一遗漏的是 `nav.jobs` i18n key，已修复为 `nav.works`。

剩余的 `job` 引用均为合法保留：
- `"/jobs"` 路径检查 → 重定向兼容性
- `provider_job_id` → 后端 API 字段名
- `"works.upstreamJob"` → 描述上游 Provider 的 job 概念
