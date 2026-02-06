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
- 支持本地 `ComfyUI`（可注入 workflow）和第三方 API（OpenAI-compatible / Vertex Veo）
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
- `type`: `comfyui` / `openai_compatible` / `vertex_veo`
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
    "model": "sora-2",
    "prompt": "cinematic drone shot of a snowy mountain at sunrise",
    "duration_sec": 4,
    "resolution": "854x480",
    "fps": 24,
    "provider_options": {
      "base_url": "https://api.openai.com",
      "api_path": "/v1/video/generations"
    }
  }'
```

## ComfyUI 使用说明

- 若请求不传 `provider_options.workflow`，系统会走模拟模式（仅用于联调）。
- 若要真实调用 ComfyUI，需在请求里传 `workflow` JSON：
  - `provider_options.workflow`: ComfyUI workflow 对象
  - `provider_options.prompt_node_id`: prompt 节点 ID（默认 `6`）
  - `provider_options.prompt_input_key`: prompt 输入字段（默认 `text`）

## 注意事项

- `4060 Ti 16GB` 建议先使用低分辨率、短时长任务，提升稳定性。
- `HunyuanVideo` 在高分辨率场景下显存需求很高，建议作为实验/兜底通道。
- 第三方视频 API 返回格式可能不同，若 `video_url` 为空，请查看任务 `raw_response` 调整映射。

## License

Apache-2.0
