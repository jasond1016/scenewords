# SceneWords (片语)

> iPad 优先的多模态 AI 生成网关，本地 Windows PC 运行。
> 通过统一 API 在多个本地和第三方 AI 模型之间切换并提交视频/图片生成任务。

## 技术栈

- **后端:** FastAPI (Python) + SQLite + 20 并发 async TaskWorker
- **前端:** React 18 + TypeScript + Vite + Tailwind CSS v4
- **图标:** @phosphor-icons/react（weight: regular）
- **字体:** Geist Sans / Geist Mono
- **状态:** Zustand (persist → localStorage) + @tanstack/react-query
- **Lightbox:** yet-another-react-lightbox
- **包管理:** pnpm (前端) / uv (后端)

## 设计系统: Studio Glass

- **风格:** Soft Structuralism — 通透、漂浮、高级感
- **配色:** Cool Zinc Neutral + 单一暖琥珀强调色 (#D97706)
- **Token 命名:** `--c-*`(颜色) / `--shadow-*`(阴影) / `--radius-*`(圆角)
- **暗色模式:** `:root.dark` class toggle，Zustand 持久化 `theme` 偏好
- **动效:** `--ease-out-expo` / `--ease-spring`，支持 `prefers-reduced-motion`
- **完整 token 定义:** `frontend/src/styles.css` 前 120 行

## 关键文件

| 文件 | 职责 |
|------|------|
| `docs/architecture-overview.md` | 详尽架构全文（后端 + 前端 + 数据流） |
| `frontend/src/styles.css` | Studio Glass 设计 token + 全局样式 |
| `frontend/src/api.ts` | 所有后端 API 调用封装 |
| `frontend/src/types.ts` | TypeScript 类型（与后端 Pydantic schema 对应） |
| `frontend/src/state.ts` | Zustand 全局状态（持久化 key: `scenewords_gateway_settings_v1`） |
| `frontend/src/i18n.ts` | 国际化（zh-CN / en） |
| `config/providers.json` | Provider 与模型配置 |
| `config/pricing.json` | 本地价格表 |
| `app/main.py` | FastAPI 入口，所有 REST 路由 |
| `app/worker.py` | 异步任务队列引擎 |
| `app/providers/` | Provider 适配器（ComfyUI / Tuzi / Gemini 等） |

## 常用 API 端点

```
POST /v1/video/generations   — 创建视频生成任务
POST /v1/image/generations   — 创建图片生成任务
GET  /v1/video/tasks         — 列出视频任务 (view=summary|full)
GET  /v1/image/tasks         — 列出图片任务
GET  /v1/models              — Provider/Model/Operation 能力目录
POST /v1/files               — 上传参考图 (jpg/png/webp, ≤10MB)
GET  /v1/pricing             — 完整价格表
```

## 编码约定

- CSS 颜色 **必须** 使用 `--c-*` 变量，禁止硬编码 hex 值
- 组件样式优先用 Tailwind utility class，复杂组件用 `styles.css` 中的命名类
- 新 Provider 须实现 `Provider.generate()` 抽象方法，注册到 `PROVIDER_TYPE_REGISTRY`
- i18n key 格式: `{page}.{section}.{label}`（如 `works.kindAll`, `create.submit`）
- 前端构建产物输出到 `app/static/`，由 FastAPI 静态托管

## 接口契约（不应破坏）

- `api.ts` 中的 API 调用签名
- `types.ts` 中的数据类型（与后端 Pydantic schema 对应）
- `state.ts` 持久化 key 命名: `scenewords_gateway_settings_v1`
- 核心业务流: 创建任务 → 轮询状态 → 查看结果 → 重试/取消/删除
- 轮询策略: 4s (有活跃任务) / 20s (空闲) / 暂停 (页面不可见)

## 测试

```bash
uv run --group dev pytest -q          # 后端测试
cd frontend && pnpm build             # 前端 tsc + vite 构建检查
```
