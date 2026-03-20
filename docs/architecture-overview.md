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
- **React Router** 路由
- **@tanstack/react-query** 数据获取与缓存
- **Zustand**（`state.ts`）全局状态管理
- **pnpm** 包管理
- 构建产物输出到 `app/static/`，由 FastAPI 静态托管

### 页面结构

| 页面 | 文件 | 功能 |
|------|------|------|
| **创建** | `pages/CreatePage.tsx` | 新任务表单。根据选择的 Provider → Model → Operation 动态渲染参数字段（prompt、分辨率、时长、参考图上传等） |
| **任务列表** | `pages/JobsPage.tsx` | 已提交任务的列表视图。显示状态、缩略图/视频预览、操作按钮（重试/取消/删除） |
| **设置** | `pages/SettingsPage.tsx` | 网关 Token 配置、语言切换等 |

### 关键组件

| 组件 | 职责 |
|------|------|
| `App.tsx` | 根组件。底部 Tab 导航，轮询任务列表，Toast 通知管理 |
| `WorkDetailOverlay.tsx` | 任务详情浮层（点击任务卡片展开） |
| `AppLightboxStage.tsx` | 全屏 Lightbox 媒体预览 |
| `MediaOverlayFrame.tsx` | 媒体预览外框 |
| `MediaDetailSidebar.tsx` | 媒体详情侧边栏 |

### 状态管理与数据流

| 模块 | 说明 |
|------|------|
| `state.ts` | Zustand store。持久化网关 Token、上次选择的 Provider/Model、语言偏好等 |
| `api.ts` | 封装所有后端 API 调用（fetchTasks, fetchCatalog, createTask, uploadFile 等） |
| `types.ts` | TypeScript 类型定义（VideoTaskDetail, ProviderCatalog 等） |
| `i18n.ts` | 国际化支持 |
| `lightbox.ts` | Lightbox 状态逻辑 |
| `useTaskNotifications.ts` | 任务完成 Toast 通知 hook |
| `useMediaOverlay.ts` | 媒体预览浮层 hook |

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

## UI/UX 重构备注

以下是当前前端的关键约束和重构时需注意的点：

### 必须保留的接口契约

- 所有 API 调用通过 `api.ts` 封装，返回类型定义在 `types.ts`
- `/v1/models` 返回的 catalog 结构驱动表单渲染
- 任务轮询逻辑在 `App.tsx` 中，通过 react-query 管理
- Zustand store (`state.ts`) 持久化用户偏好

### 当前前端源文件清单

```
frontend/src/
  ├── App.tsx                        # 根组件，Tab 导航 + 轮询 + Toast
  ├── api.ts                         # API 调用封装
  ├── main.tsx                       # React 入口
  ├── state.ts                       # Zustand 全局状态
  ├── types.ts                       # TypeScript 类型
  ├── styles.css                     # 全局样式
  ├── i18n.ts                        # 国际化
  ├── lightbox.ts                    # Lightbox 状态
  ├── utils.ts                       # 通用工具函数
  ├── useMediaOverlay.ts             # 媒体预览 hook
  ├── useTaskNotifications.ts        # 任务通知 hook
  ├── overlayTaskActions.ts          # 浮层任务操作
  ├── overlayTaskPresentation.ts     # 浮层展示逻辑
  ├── overlayTaskUtils.ts            # 浮层工具函数
  ├── components/
  │   ├── AppLightboxStage.tsx       # 全屏 Lightbox
  │   ├── MediaDetailSidebar.tsx     # 媒体详情侧边栏
  │   ├── MediaOverlayFrame.tsx      # 媒体预览框
  │   └── WorkDetailOverlay.tsx      # 任务详情浮层
  └── pages/
      ├── CreatePage.tsx             # 创建任务页
      ├── JobsPage.tsx               # 任务列表页
      └── SettingsPage.tsx           # 设置页
```

### 目标设备

- **主要**: iPad (Safari)，触摸交互
- **次要**: 桌面浏览器

### 重构时可自由变更的部分

- 所有 CSS / 样式 / 布局
- 组件结构与拆分方式
- 动画与过渡效果
- 配色方案、字体、间距
- 导航模式（当前为底部 Tab）
- 卡片/列表展示方式
- 表单交互体验

### 重构时不应破坏的部分

- `api.ts` 中的 API 调用逻辑
- `types.ts` 中的数据类型（与后端 schema 对应）
- `state.ts` 中的持久化状态 key
- 核心业务流：创建任务 → 轮询 → 查看结果 → 重试/取消/删除
