# 片语 / SceneWords

SceneWords 是一个面向 iPad 的媒体生成网关：通过统一 API 在本地模型与第三方模型之间切换并提交视频/图片任务。

## 功能

- 统一 API：
  - `POST /v1/video/generations`
  - `POST /v1/video/tasks/{task_id}/retry`
  - `POST /v1/image/generations`
  - `POST /v1/image/tasks/{task_id}/retry`
  - `POST /v1/files`
  - `GET /v1/files/{file_id}`
  - `GET /v1/video/tasks`
  - `GET /v1/video/tasks/{task_id}`
  - `GET /v1/video/tasks/{task_id}/result`
  - `GET /v1/image/tasks`
  - `GET /v1/image/tasks/{task_id}`
  - `GET /v1/image/tasks/{task_id}/result`
  - `GET /v1/pricing`
  - `POST /v1/pricing/estimate`
  - `GET /v1/models`
  - 模型能力描述（`operations` 与字段定义）
- 前端支持按 `Provider / Model / Operation` 动态切换参数（仅显示接口支持项）
- 支持按请求覆盖 `base_url`、`api_path`、`model`
- 支持本地 `ComfyUI`（可注入 workflow）和第三方 API（OpenAI-compatible / Vertex Veo / Tuzi Video / Tuzi Image）
- ComfyUI 支持后端默认 workflow 与请求级 workflow JSON
- 可选网关 `Bearer Token` 鉴权

## 目录

```text
app/
  main.py                 # FastAPI 入口
  worker.py               # 后台任务队列
  db.py                   # SQLite 任务存储
  pricing.py              # 本地价格表与估算逻辑
  config.py               # 配置加载
  providers/              # Provider 适配器
  static/                 # 前端构建产物
frontend/                 # React + TypeScript + Vite 前端源码
config/providers.json     # Provider 与模型配置
config/pricing.json       # 本地价格配置（无 provider 计费接口时）
```

## 快速启动

1. 安装依赖

```bash
uv sync --python 3.11
```

2. 配置环境变量（可选）

```bash
export OPENAI_API_KEY="..."
export GOOGLE_API_KEY="..."
export RIGHT_CODES_API_KEY="..."
export TUZI_API_KEY="..."
export VIDEO_GATEWAY_BEARER_TOKEN="your-token"
export VIDEO_GATEWAY_UPLOAD_DIR="data/uploads"
export VIDEO_GATEWAY_MAX_UPLOAD_MB="10"
```

3. 启动服务

```bash
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

4. 在 iPad Safari 访问

```text
http://<Windows-PC-IP>:8000
```

## 前端开发

前端统一使用 `pnpm` 作为包管理器。

1. 安装依赖

```bash
cd frontend
pnpm install
```

2. 本地开发

```bash
pnpm dev
```

3. 构建到网关静态目录（`app/static`）

```bash
pnpm build
```

构建后继续按原方式启动 FastAPI 即可。

## 通过 Cloudflare Tunnel 公开（仅家人访问）

参见 `docs/cloudflare-tunnel-access.md`。

该方案使用：

- Cloudflare Tunnel 暴露本地服务到自有域名
- Cloudflare Access 做邮箱白名单认证（OTP/Google）

## 测试

```bash
uv run --group dev pytest -q
```

## Provider 配置

默认读取 `config/providers.json`，可通过 `VIDEO_GATEWAY_CONFIG` 指向其他文件。
价格配置默认读取 `config/pricing.json`，可通过 `VIDEO_GATEWAY_PRICING_CONFIG` 覆盖。

依赖管理改为 `uv`：

- 新增依赖：`uv add <package>`
- 锁定并同步：`uv lock && uv sync`

关键字段：

- `id`: provider 唯一标识（前端选择值）
- `type`: `comfyui` / `openai_compatible` / `vertex_veo` / `gemini_veo_compatible` / `tuzi_veo` / `tuzi_sora` / `tuzi_image`
- `base_url`, `api_path`: 默认上游地址
- `auth_env`: 默认 API Key 的环境变量名
- `models`: 可选模型列表（前端可切换）
  - `duration_options`（可选）: 指定该模型允许的离散时长（秒），例如 `[8]` 或 `[10, 15]`

## 请求示例

```bash
curl -X POST "http://127.0.0.1:8000/v1/video/generations" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token" \
  -d '{
    "provider": "sora2",
    "model": "sora2",
    "operation": "generate",
    "prompt": "cinematic drone shot of a snowy mountain at sunrise",
    "duration_sec": 4,
    "resolution": "1280x720",
    "provider_options": {
      "api_key": "YOUR_API_KEY"
    }
  }'
```

## Tuzi Veo/Sora 使用说明

- Tuzi 接口是异步任务模式：
  - 提交：`POST /v1/videos`
  - 查询：`GET /v1/videos/{task_id}`
  - Sora 下载兜底：`GET /v1/videos/{task_id}/content`
- `veo31` 与 `sora2` 默认都已切到 Tuzi（ID 不变，便于前端继续使用原选项）。
- 网关已支持下列 operation（前端会按模型动态展示）：
  - `tuzi_veo`: `generate`
  - `tuzi_sora`: `generate` / `storyboard` / `remix` / `create_character`
- 请求字段映射（网关 -> Tuzi multipart）：
  - `model` -> `model`
  - `prompt` -> `prompt`
  - `duration_sec` -> `seconds`
  - `resolution` -> `size`
- `input_references` 会映射为多条 `input_reference` 表单字段。
- Tuzi 的 `input_reference` 采用文件上传：前端会先调用网关 `POST /v1/files`，再在生成请求里传 `input_reference_file_ids`。
- `tuzi_veo` 额外支持首尾帧文件：
  - `start_frame_file_id`（可选，单文件）
  - `end_frame_file_id`（可选，单文件；要求已提供 `start_frame_file_id`）
  - 网关会按顺序把首帧/尾帧映射为 `input_reference` multipart 文件字段。
- 上传限制默认仅允许 `jpg/png/webp`，单文件最大 `10MB`（可通过环境变量调整）。
- `remix` 使用 `source_video_id` 调用 `/v1/videos/{video_id}/remix`。
- `create_character` 使用 `model=sora-2-character` + `character_from_task`（无视频输出）。
- Sora 返回结果时，网关优先使用查询接口中的 `video_url`；若缺失会自动尝试 `/content` 下载接口兜底。
- 请求级可覆盖字段（`provider_options`）：
  - `api_key`, `auth_header`
  - `base_url`, `api_path`, `query_path`, `download_path`
  - `submit_timeout_sec`, `timeout_sec`, `poll_interval_sec`, `download_timeout_sec`
  - `extra_body`（透传 Tuzi 特定字段，按 multipart 表单发送）

## ComfyUI 使用说明

- workflow 来源优先级：
  - `provider_options.workflow`（请求级，优先级最高）
  - `providers.json` 中 `default_workflow`
  - `providers.json` 中 `default_workflow_path`
- 若以上都未提供，系统会走模拟模式（仅用于联调）。
- 若要真实调用 ComfyUI，可在请求中传：
  - `provider_options.workflow`: ComfyUI workflow 对象
  - `provider_options.prompt_node_id`: prompt 节点 ID（默认 `6`）
  - `provider_options.prompt_input_key`: prompt 输入字段（默认 `text`）
  - `provider_options.timeout_sec`: 任务超时秒数（默认 `900`）
  - `provider_options.poll_interval_sec`: 轮询间隔秒数（默认 `2.0`）
  - `provider_options.auto_apply_video_params`: 是否自动把请求中的 `resolution` / `fps` / `duration_sec` 写入 workflow（默认 `true`）
  - `provider_options.latent_node_id`: 指定写入分辨率/帧数的节点 ID（可选）
  - `provider_options.fps_node_id`: 指定写入 FPS 的节点 ID（可选）
  - `provider_options.length_mode`: `duration_fps` 或 `duration_fps_plus_one`（可选）
- 也可在服务端配置默认 workflow（推荐同机部署时使用）：

```json
{
  "id": "local_comfy",
  "type": "comfyui",
  "base_url": "http://127.0.0.1:8188",
  "public_base_url": "http://192.168.1.20:8188",
  "default_timeout_sec": 900,
  "latent_node_id": "55",
  "fps_node_id": "57",
  "length_mode": "duration_fps_plus_one",
  "default_workflow_path": "config/workflows/wan2.2-5b.json"
}
```

- `default_workflow_path` 支持相对路径（相对 `config/providers.json` 所在目录）或绝对路径。

### 内网同机部署建议（网关与 ComfyUI 在同一台机器）

- ComfyUI 监听内网：`python main.py --listen 0.0.0.0 --port 8188`
- 网关监听内网：`uv run uvicorn app.main:app --host 0.0.0.0 --port 8000`
- `config/providers.json` 里建议将 ComfyUI 配置为：
  - `base_url`: 网关访问 ComfyUI 的地址（同机可用 `http://127.0.0.1:8188`）
  - `public_base_url`: 返回给客户端播放视频的地址（如 `http://192.168.1.20:8188`）
- 前端会按当前 `provider/model/operation` 动态显示可配置字段（包含 ComfyUI `workflow`）。

## 第三方 Veo (Gemini-Compatible) 使用说明

- 适用接口：`/models/{model}:predictLongRunning` + 轮询 operation。
- 前端参数由后端 capabilities 驱动，按 provider/model 自动显示支持字段与默认值。
- 推荐配置示例（已内置在 `config/providers.json`）：

```json
{
  "id": "veo31_rightcodes",
  "type": "gemini_veo_compatible",
  "base_url": "https://right.codes/gemini/v1beta",
  "api_path": "/models/{model}:predictLongRunning",
  "auth_env": "RIGHT_CODES_API_KEY",
  "api_key_header": "x-goog-api-key",
  "default_timeout_sec": 1200,
  "default_poll_interval_sec": 10
}
```

- 请求级可覆盖字段（`provider_options`）：
  - `api_key`, `api_key_header`
  - `base_url`, `api_path`, `model`
  - `timeout_sec`, `poll_interval_sec`
  - `operation_base_url`, `operation_path`
  - `extra_body`（用于透传第三方特定参数）
- API Key 读取优先级：`provider_options.api_key` > `providers.json` 中 `api_key` > `auth_env` 环境变量。

## 注意事项

- `4060 Ti 16GB` 建议先使用低分辨率、短时长任务，提升稳定性。
- `HunyuanVideo` 在高分辨率场景下显存需求很高，建议作为实验/兜底通道。
- 第三方视频 API 返回格式可能不同，若 `video_url` 为空，请查看任务 `raw_response` 调整映射。

## License

Apache-2.0
