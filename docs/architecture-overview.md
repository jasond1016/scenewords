# 片语 / SceneWords — 架构总览

> 本文档供后续 UI/UX 重构时参考，完整描述项目的技术架构、数据流、模块职责与前端现状。

---

## 一句话概述

**SceneWords** 是一个面向 iPad 使用的 **多模态（视频/图片）AI 生成网关**，运行在本地 Windows PC 上，通过统一 API 在多个本地和第三方 AI 模型之间切换并提交生成任务。

---

## 整体架构

```
┌─────────────────────┐          ┌──────────────────────────────────┐
│  iPad Safari 前端    │  HTTP    │  FastAPI 后端 (Python)            │
│  React + TypeScript  │ ◄──────► │  端口 8000                        │
│  Vite 构建           │          │                                  │
└─────────────────────┘          │  ┌────────────────────────────┐  │
                                 │  │ TaskWorker (异步队列)       │  │
                                 │  │ 20 个并发 worker            │  │
                                 │  └────────┬───────────────────┘  │
                                 │           │                      │
                                 │  ┌────────▼───────────────────┐  │
                                 │  │ Provider 适配层             │  │
                                 │  │ ComfyUI / Tuzi / Gemini... │  │
                                 │  └────────────────────────────┘  │
                                 │                                  │
                                 │  SQLite (tasks.db) 任务持久化    │
                                 └──────────────────────────────────┘
                                          │
                      ┌───────────────────┼──────────────────┐
                      ▼                   ▼                  ▼
               本地 ComfyUI        Tuzi API (兔子)    Right Codes API
               (WAN2.2/HunyuanVideo)  (Sora2/Veo3.1)   (Gemini Veo)
```

---

## 后端核心 (`app/` 目录)

| 文件 | 职责 |
|------|------|
| `main.py` | FastAPI 入口，定义所有 REST API 路由（视频/图片的创建、查询、重试、取消、删除），文件上传/下载，鉴权中间件，优雅关闭逻辑 |
| `worker.py` | 异步任务队列引擎，20 个 worker 并发处理。支持任务取消、重启恢复（resume）、结果归档（自动下载远程媒体到本地） |
| `db.py` | SQLite 持久化层（`TaskStore`），存储任务状态、上传文件元数据，线程安全 |
| `config.py` | 配置加载：`providers.json`（Provider/模型配置）+ 环境变量（Token、路径等） |
| `pricing.py` | 本地价格表与估算逻辑（从 `pricing.json` 加载） |
| `capabilities.py` | 模型能力描述系统——动态定义每个 Provider/Model/Operation 支持哪些参数字段 |
| `schemas.py` | Pydantic 数据模型（请求/响应 schema） |

---

## Provider 适配器 (`app/providers/`)

支持 **7 种 Provider 类型**：

| Provider 类型 | 类名 | 说明 |
|---------------|------|------|
| `comfyui` | `ComfyUIProvider` | 本地 ComfyUI（注入 workflow JSON，支持 WAN2.2、HunyuanVideo 等本地模型） |
| `tuzi_veo` | `TuziVeoProvider` | 兔子 API 的 Veo 3.1 视频生成（支持首尾帧参考图） |
| `tuzi_sora` | `TuziSoraProvider` | 兔子 API 的 Sora 2 视频生成（generate / storyboard / remix / create_character） |
| `tuzi_image` | `TuziImageProvider` | 兔子 API 的图片生成（Gemini 3 Pro Image，支持同步/异步模式） |
| `gemini_veo_compatible` | `GeminiVeoCompatibleProvider` | Gemini/Vertex Veo 兼容 API（通过 Right Codes 等第三方代理） |
| `openai_compatible` | `OpenAICompatibleProvider` | OpenAI 兼容 API |
| `vertex_veo` | `VertexVeoProvider` | 原生 Google Vertex Veo API |

每种 Provider 都实现 `Provider.generate()` 抽象方法，统一封装：**提交 → 轮询 → 获取结果 → 下载归档** 的完整流程。

Provider 注册表位于 `app/providers/__init__.py` 的 `PROVIDER_TYPE_REGISTRY`。

---

## 当前已配置的 Provider 实例 (`config/providers.json`)

| Provider ID | 显示名 | 类型 | 模型 |
|-------------|--------|------|------|
| `local_comfy` | Local ComfyUI | `comfyui` | WAN2.2 5B / HunyuanVideo |
| `nano_banana2` | Nano Banana 2 (Tuzi) | `tuzi_image` | Gemini 3 Pro Image (1K/2K/4K, 同步/异步) |
| `sora2` | Sora 2 (Tuzi) | `tuzi_sora` | Sora 2 / Sora 2 Pro / 4s/8s/12s 变体 |
| `veo31` | Veo 3.1 (Tuzi) | `tuzi_veo` | Veo 3.1 / Veo 3.1 4K / Veo 3.1 Components |
| `veo31_rightcodes` | Veo 3.1 (Right Codes) | `gemini_veo_compatible` | veo-3.1-generate-preview |

---

## 主要 API 端点

| 方法 | 路径 | 功能 |
|------|------|------|
| `POST` | `/v1/video/generations` | 创建视频生成任务 |
| `POST` | `/v1/image/generations` | 创建图片生成任务 |
| `GET` | `/v1/video/tasks` | 列出视频任务（支持 `view=summary\|full`） |
| `GET` | `/v1/image/tasks` | 列出图片任务 |
| `GET` | `/v1/video/tasks/{task_id}` | 获取单个视频任务详情 |
| `GET` | `/v1/image/tasks/{task_id}` | 获取单个图片任务详情 |
| `POST` | `/v1/video/tasks/{task_id}/retry` | 重试视频任务 |
| `POST` | `/v1/image/tasks/{task_id}/retry` | 重试图片任务 |
| `POST` | `/v1/video/tasks/{task_id}/cancel` | 取消视频任务 |
| `POST` | `/v1/image/tasks/{task_id}/cancel` | 取消图片任务 |
| `DELETE` | `/v1/video/tasks/{task_id}` | 删除视频任务及归档资产 |
| `DELETE` | `/v1/image/tasks/{task_id}` | 删除图片任务及归档资产 |
| `GET` | `/v1/video/tasks/{task_id}/result` | 获取视频任务结果 |
| `GET` | `/v1/image/tasks/{task_id}/result` | 获取图片任务结果 |
| `POST` | `/v1/files` | 上传参考图（jpg/png/webp，限 10MB） |
| `GET` | `/v1/files/{file_id}` | 获取已上传文件 |
| `GET` | `/v1/assets/{task_id}/{filename}` | 获取归档的生成结果文件 |
| `GET` | `/v1/models` | 获取所有 Provider / 模型 / 操作的能力目录 |
| `GET` | `/v1/pricing` | 获取完整价格表 |
| `POST` | `/v1/pricing/estimate` | 单次价格估算 |
| `GET` | `/health` | 健康检查 |

---

## 数据流：一次生成请求的完整生命周期

```
1. 用户在 iPad 前端填写参数 → 点击"生成"
2. 前端 POST /v1/video/generations (或 /v1/image/generations)
3. main.py 验证 Provider/Model/Operation，解析上传文件引用，估算费用
4. 创建 task 记录（status=queued）写入 SQLite
5. 提交 task_id 到 TaskWorker 异步队列
6. 立即返回 { task_id, status: "queued" } 给前端
7. Worker 从队列取出 task_id → 设为 running
8. 调用对应 Provider.generate()：
   - ComfyUI: 提交 workflow → WebSocket 监听进度 → 下载输出
   - Tuzi: POST 提交 → 轮询状态 → 获取 URL
   - Gemini: POST predictLongRunning → 轮询 operation → 获取结果
9. 生成成功 → 下载远程媒体到 data/outputs/assets/{task_id}/
10. 更新 SQLite: status=succeeded, result 包含 local_video_url / local_image_urls
11. 前端定时轮询 GET /v1/video/tasks 发现状态变化 → 显示结果 + Toast 通知
```

---

## 前端现状 (`frontend/` 目录)

### 技术栈

- **React 18** + **TypeScript**
- **Vite** 构建
- **Tailwind CSS v4** — 通过 `@tailwindcss/vite` 插件集成，使用原生 CSS `@theme` 桥接设计 token
- **React Router** 路由
- **@tanstack/react-query** 数据获取与缓存
- **Zustand**（`state.ts`）全局状态管理
- **@phosphor-icons/react** 统一图标系统（weight 可调：regular/bold/fill）
- **yet-another-react-lightbox** 全屏媒体预览
- **Geist Sans / Geist Mono** 字体（x-height 高、数字等宽，iPad Retina 清晰）
- **pnpm** 包管理
- 构建产物输出到 `app/static/`，由 FastAPI 静态托管

> **💡 技术选型理由：**
> - Phosphor Icons 优于 Lucide：weight 可调，触摸界面中通过切换粗细传达交互状态
> - Tailwind v4 优于 v3：原生 CSS `@theme` 桥接设计 token，不再需要 tailwind.config.js
> - Geist Sans：专为 UI 设计的字体，数字等宽便于对齐费用/时长等数值

### 设计系统：Studio Glass

前端在 `ui/studio-glass-redesign` 分支经历了从 editorial minimalist → Studio Glass → Composer Bar 的三阶段演进。最终确立的设计语言为 **Soft Structuralism**——通透、漂浮、高级感，避免"廉价 AI 工具"的视觉印象。

完整 token 定义位于 `frontend/src/styles.css` 前 120 行，以下是关键摘要：

| Token 类别 | 命名空间 | 说明 |
|-----------|---------|------|
| **颜色** | `--c-*` | Canvas 层（canvas/surface/surface-raised/surface-inset）、文字层（text/secondary/tertiary）、CTA 层、强调色（#D97706 琥珀橙，仅用于警示/高亮）、状态色（success/error/warning/info 各含 -bg/-text） |
| **阴影** | `--shadow-*` | 5 级递进：xs → sm → md → lg → overlay。扩散式 + 背景色调，不使用纯黑阴影 |
| **圆角** | `--radius-*` | sm(8) → md(12) → lg(16) → xl(20) → 2xl(24) → full(9999) |
| **动效** | `--ease-*` / `--duration-*` | 曲线：ease-out-expo / ease-spring；时长：fast(150ms) / normal(250ms) / slow(500ms) / reveal(700ms) |

**暗色模式：** 通过 `:root.dark` CSS class toggle 实现，Zustand 持久化 `theme` 偏好（`"light" | "dark" | "system"`）。亮暗两套 token 完整对称，所有 28 个 `--c-*` 变量在两个主题下都有定义。

**Tailwind 桥接：** 通过 `@theme` 块将 CSS 变量映射为 Tailwind utility class，token 在手写 CSS 和 Tailwind 中都可用。

> **💡 设计决策理由：**
> - Cool Zinc 而非纯灰：微妙的冷色调性格，区别于千篇一律的 AI 工具界面
> - 单一暖强调色：在大面积冷色中制造视觉锚点，且只用于需要注意力的元素
> - 5 级阴影语义明确：从 hairline（xs）到浮层（overlay），每级都有固定用途
> - 支持 `prefers-reduced-motion` 降级，确保无障碍体验

### 页面结构

| 页面 | 文件 | 功能 |
|------|------|------|
| **创作** | `pages/CreatePage.tsx` | Composer Bar 布局（Seedance 风格 prompt-first UX）。底部固定输入栏（prompt textarea + 参考图缩略图 + 提交按钮），上方为可选展开的参数区域（Provider/Model/Operation 选择、分辨率、时长等）。根据后端 capabilities 动态渲染字段 |
| **作品** | `pages/WorksPage.tsx` | 已生成作品的列表/网格视图。支持按类型（图片/视频/收藏）筛选、按 Provider/状态过滤、搜索。点击卡片打开 Lightbox 预览 + 详情面板 |
| **设置** | `pages/SettingsPage.tsx` | 网关 Token 配置、语言切换、主题（亮/暗/跟随系统）、通知偏好等 |

> **💡 导航演进：** 从底部 Tab 改为 **顶部固定导航栏**（sticky header，3 列 grid：Logo / 居中 pill nav / 队列指示器）。原因：iPad 横屏时底部 Tab 浪费纵向空间，顶部栏更符合桌面端习惯且不遮挡内容区。
>
> **💡 路由演进：** `/jobs` 重命名为 `/works`（语义更准确——这些是用户的"作品"而非"任务"）。`/jobs` 和 `/assets` 保留为重定向。
>
> **💡 Composer Bar：** 借鉴 Seedance 的"prompt 即核心"理念，将输入框固定在底部，参数区域上推为可选展开区，降低创建任务的认知负担。

### 关键组件

| 组件 | 职责 |
|------|------|
| `App.tsx` | 根组件。顶部 sticky 导航栏（pill nav），任务列表轮询，Toast 通知管理，暗色模式 class toggle |
| `WorkDetailOverlay.tsx` | 任务详情浮层（点击任务卡片展开） |
| `AppLightboxStage.tsx` | 全屏 Lightbox 媒体预览 |
| `MediaOverlayFrame.tsx` | 媒体预览外框 |
| `MediaDetailSidebar.tsx` | 媒体详情侧边栏 |
| `Skeletons.tsx` | 加载骨架屏（替代 spinner，减少布局偏移） |

### 状态管理与数据流

| 模块 | 说明 |
|------|------|
| `state.ts` | Zustand store（持久化 key: `scenewords_gateway_settings_v1`）。持久化网关 Token、上次选择的 Provider/Model、语言偏好、主题偏好（`theme: "light" | "dark" | "system"`）、通知设置、费用显示偏好、Provider 默认参数等。另有非持久化字段 `pendingReuseDraft` 用于跨页面复用草稿 |
| `api.ts` | 封装所有后端 API 调用（fetchTasks, fetchCatalog, createTask, uploadFile 等） |
| `types.ts` | TypeScript 类型定义（VideoTaskDetail, ProviderCatalog 等） |
| `i18n.ts` | 国际化支持（zh-CN / en 双语，~180 个翻译 key） |
| `lightbox.ts` | Lightbox 状态逻辑 |
| `useTaskNotifications.ts` | 任务完成 Toast 通知 hook |
| `useMediaOverlay.ts` | 媒体预览浮层 hook |
| `useScrollEntry.tsx` | IntersectionObserver 驱动的滚动入场动画 hook |

### 轮询策略

- 有进行中任务时：**每 4 秒** 刷新一次
- 全部空闲时：**每 20 秒** 刷新一次
- 页面不可见时（`document.visibilityState === "hidden"`）：**暂停轮询**

---

## 数据存储

| 路径 | 内容 |
|------|------|
| `data/tasks.db` | SQLite 数据库（tasks 表 + files 表） |
| `data/uploads/` | 用户上传的参考图（UUID 命名） |
| `data/outputs/assets/{task_id}/` | 归档的生成结果（video_1.mp4 / image_1.jpg 等） |

---

## 关键设计特点

1. **统一网关模式** — 前端只和一个 API 交互，后端屏蔽不同 AI 服务的接口差异
2. **异步任务队列** — 提交后立即返回 task_id，后台 20 个 worker 并发处理，前端轮询状态
3. **本地资产归档** — 远程生成的视频/图片自动下载到本地 `data/outputs/assets/`
4. **重启恢复** — 服务重启后自动检查未完成任务：queued 重新排队，running 尝试 resume 或标记中断
5. **可选鉴权** — 环境变量 `VIDEO_GATEWAY_BEARER_TOKEN` 启用 Bearer Token 保护
6. **Cloudflare Tunnel** — 支持通过 Cloudflare Tunnel + Access 白名单安全暴露给家人
7. **方向自动适配** — 上传参考图后可自动检测横竖屏并调整输出分辨率
8. **能力驱动表单** — 后端 `capabilities.py` 定义每个 Provider/Model/Operation 的字段能力，前端据此动态渲染表单
9. **费用估算** — 本地价格表提供提交前的费用预估，结果中提取实际费用
10. **iPad 优先** — 前端针对 iPad Safari 触摸交互设计
11. **Studio Glass 设计系统** — CSS 变量 token 体系（`--c-*` / `--shadow-*` / `--radius-*`），Tailwind v4 `@theme` 桥接，亮/暗双主题
12. **Composer Bar UX** — Seedance 风格的 prompt-first 布局，底部固定输入栏，参数区可选展开
13. **骨架屏加载** — `Skeletons.tsx` 组件替代 spinner，减少布局偏移（CLS）
14. **滚动入场动画** — IntersectionObserver 驱动（`useScrollEntry.tsx`），支持 `prefers-reduced-motion` 降级
15. **PWA 支持** — `manifest.json`，支持 iPad "添加到主屏幕"
16. **Phosphor Icons** — 统一图标系统，weight 可调（regular/bold/fill）

---

## 配置文件

| 文件 | 说明 |
|------|------|
| `config/providers.json` | Provider 与模型配置（ID、类型、URL、模型列表等） |
| `config/pricing.json` | 本地价格表 |
| `config/workflows/*.json` | ComfyUI workflow 模板 |
| `.cloudflared/config.yml` | Cloudflare Tunnel 配置 |
| `pyproject.toml` | Python 项目配置（uv 管理依赖） |
| `frontend/vite.config.ts` | Vite 构建配置 |

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `VIDEO_GATEWAY_CONFIG` | `config/providers.json` | Provider 配置文件路径 |
| `VIDEO_GATEWAY_PRICING_CONFIG` | `config/pricing.json` | 价格配置文件路径 |
| `VIDEO_GATEWAY_DB_PATH` | `data/tasks.db` | SQLite 数据库路径 |
| `VIDEO_GATEWAY_OUTPUT_DIR` | `data/outputs` | 输出归档目录 |
| `VIDEO_GATEWAY_UPLOAD_DIR` | `data/uploads` | 上传文件目录 |
| `VIDEO_GATEWAY_BEARER_TOKEN` | _(空)_ | 网关鉴权 Token |
| `VIDEO_GATEWAY_MAX_UPLOAD_MB` | `10` | 单文件上传大小限制 (MB) |
| `VIDEO_GATEWAY_MAX_RECENT_TASKS` | `50` | 任务列表最大返回数 |
| `VIDEO_GATEWAY_ALLOW_ENDPOINT_OVERRIDE` | `true` | 是否允许请求级覆盖 endpoint |
| `OPENAI_API_KEY` | — | OpenAI API Key |
| `GOOGLE_API_KEY` | — | Google API Key |
| `RIGHT_CODES_API_KEY` | — | Right Codes API Key |
| `TUZI_API_KEY` | — | 兔子 API Key |

---

## 测试

```bash
uv run --group dev pytest -q
```

测试文件位于 `tests/`，覆盖 API 路由、capabilities、worker、Tuzi provider 等。

---

## 接口契约与演进记录

### Studio Glass 重构变更记录

以下变更在 `ui/studio-glass-redesign` 分支完成（18 个 commit，+2589/-1028 行）：

- **导航：** 底部 Tab → 顶部 sticky header pill nav（3 列 grid 布局）
- **CSS：** 完全重写为 Studio Glass token 体系（`--c-*` / `--shadow-*` / `--radius-*`）
- **图标：** 内联 SVG → `@phosphor-icons/react` 统一图标系统
- **路由：** `/jobs` → `/works`（`/jobs` 和 `/assets` 保留重定向）
- **文件名：** `JobsPage.tsx` → `WorksPage.tsx`
- **i18n key：** `jobs.*` → `works.*`（182 个 key）
- **新增：** 暗色模式、PWA manifest、骨架屏加载、滚动入场动画、Composer Bar 布局

### 接口契约（不应破坏）

- `api.ts` 中的 API 调用逻辑与函数签名
- `types.ts` 中的数据类型（与后端 Pydantic schema 一一对应）
- `state.ts` 中的持久化 key 命名（`scenewords_gateway_settings_v1`）
- `/v1/models` 返回的 catalog 结构驱动表单渲染
- 核心业务流：创建任务 → 轮询状态 → 查看结果 → 重试/取消/删除
- 轮询策略：4s (有活跃任务) / 20s (空闲) / 暂停 (页面不可见)

### 当前前端源文件清单

```
frontend/src/
  ├── App.tsx                        # 根组件，顶部导航 + 轮询 + Toast + 暗色模式
  ├── api.ts                         # API 调用封装
  ├── main.tsx                       # React 入口
  ├── state.ts                       # Zustand 全局状态（theme / pendingReuseDraft）
  ├── types.ts                       # TypeScript 类型
  ├── styles.css                     # Studio Glass 设计系统 + 全局样式
  ├── i18n.ts                        # 国际化（zh-CN / en）
  ├── lightbox.ts                    # Lightbox 状态
  ├── utils.ts                       # 通用工具函数
  ├── useMediaOverlay.ts             # 媒体预览浮层 hook
  ├── useTaskNotifications.ts        # 任务通知 hook
  ├── useScrollEntry.tsx             # IntersectionObserver 滚动入场动画
  ├── overlayTaskActions.ts          # 浮层任务操作
  ├── overlayTaskPresentation.ts     # 浮层展示逻辑
  ├── overlayTaskUtils.ts            # 浮层工具函数
  ├── components/
  │   ├── AppLightboxStage.tsx       # 全屏 Lightbox
  │   ├── MediaDetailSidebar.tsx     # 媒体详情侧边栏
  │   ├── MediaOverlayFrame.tsx      # 媒体预览框
  │   ├── Skeletons.tsx              # 加载骨架屏组件
  │   └── WorkDetailOverlay.tsx      # 任务详情浮层
  └── pages/
      ├── CreatePage.tsx             # 创建任务页（Composer Bar 布局）
      ├── WorksPage.tsx              # 作品列表页
      └── SettingsPage.tsx           # 设置页
```

### 目标设备

- **主要**: iPad (Safari)，触摸交互
- **次要**: 桌面浏览器
