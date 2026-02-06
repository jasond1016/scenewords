# 片语 / SceneWords

SceneWords 是一个面向 iPad 的视频生成网关：通过统一 API 在本地模型与第三方模型之间切换并提交任务。

## 功能

- 统一 API：
  - `POST /v1/video/generations`
  - `GET /v1/video/tasks`
  - `GET /v1/video/tasks/{task_id}`
  - `GET /v1/video/tasks/{task_id}/result`
  - `GET /v1/models`
- 前端支持切换 `Provider` 和 `Model`
- 支持按请求覆盖 `base_url`、`api_path`、`model`
- 支持本地 `ComfyUI`（可注入 workflow）和第三方 API（OpenAI-compatible / Vertex Veo / Tuzi）
- ComfyUI 支持 `public_base_url`（对外播放地址）、后端默认 workflow 与前端缓存 workflow JSON
- 前端支持按 Provider 自动套用初始参数，并提供 Veo 竖屏/横屏快捷切换
- 可选网关 `Bearer Token` 鉴权

## 目录

```text
app/
  main.py                 # FastAPI 入口
  worker.py               # 后台任务队列
  db.py                   # SQLite 任务存储
  config.py               # 配置加载
  providers/              # Provider 适配器
  static/                 # iPad 前端页面
config/providers.json     # Provider 与模型配置
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
```

3. 启动服务

```bash
uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

4. 在 iPad Safari 访问

```text
http://<Windows-PC-IP>:8000
```

## Provider 配置

默认读取 `config/providers.json`，可通过 `VIDEO_GATEWAY_CONFIG` 指向其他文件。

依赖管理改为 `uv`：

- 新增依赖：`uv add <package>`
- 锁定并同步：`uv lock && uv sync`

关键字段：

- `id`: provider 唯一标识（前端选择值）
- `type`: `comfyui` / `openai_compatible` / `vertex_veo` / `gemini_veo_compatible` / `tuzi_veo` / `tuzi_sora`
- `base_url`, `api_path`: 默认上游地址
- `auth_env`: 默认 API Key 的环境变量名
- `models`: 可选模型列表（前端可切换）

## 请求示例

```bash
curl -X POST "http://127.0.0.1:8000/v1/video/generations" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-token" \
  -d '{
    "provider": "sora2",
    "model": "sora2",
    "prompt": "cinematic drone shot of a snowy mountain at sunrise",
    "duration_sec": 4,
    "resolution": "854x480",
    "fps": 24,
    "provider_options": {
      "base_url": "https://api.tu-zi.com",
      "api_path": "/v1/videos"
    }
  }'
```

## Tuzi Veo/Sora 使用说明

- Tuzi 接口是异步任务模式：
  - 提交：`POST /v1/videos`
  - 查询：`GET /v1/videos/{task_id}`
  - Sora 下载兜底：`GET /v1/videos/{task_id}/content`
- `veo31` 与 `sora2` 默认都已切到 Tuzi（ID 不变，便于前端继续使用原选项）。
- 请求字段映射（网关 -> Tuzi multipart）：
  - `model` -> `model`
  - `prompt` -> `prompt`
  - `duration_sec` -> `seconds`
  - `resolution` -> `size`
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
- 前端“高级设置”新增 `Workflow JSON`，可直接粘贴 ComfyUI workflow，浏览器会本地缓存，后续提交无需重复粘贴。

## 第三方 Veo (Gemini-Compatible) 使用说明

- 适用接口：`/models/{model}:predictLongRunning` + 轮询 operation。
- 前端切换到 `gemini_veo_compatible` / `vertex_veo` 时，会自动设置推荐初始值：
  - `duration_sec = 4`
  - `fps = 24`
  - `resolution = 1280x720`（横屏）或 `720x1280`（竖屏）
- 可用“Veo 画幅快捷”按钮在 `16:9` 与 `9:16` 间快速切换（会记住上次选择）。
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
