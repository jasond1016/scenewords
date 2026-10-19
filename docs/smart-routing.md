# 智能模型路由 · 第一阶段

## 用户与 API 契约

Composer 只选择图片/视频、比例、清晰度、参考图、格式、数量、时长和方向，不再选择供应商、模型或同步/异步模式。高级参数仍来自后端能力目录。`GET /v1/models` 保留原来的真实 `providers`，另加目标式 `routing_providers`，其中的 `routing_goal` 是清晰度目标，**不是上游模型**。详情默认折叠实际模型与路由诊断，费用仍标明本地估算/上游实报来源。

省略 `provider` 和 `model`（或两者都为空）启用路由，例如：

```json
{"prompt":"窗边的蓝色花瓶", "resolution":"4:5", "resolution_tier":"2k",
 "provider_options":{"image_file_ids":["已上传文件ID"]}}
```

`operation` 不省略/改写用户指定值；缺省为 `generate`。编辑使用 `edit` 与 `image_file_ids`；异步图片参考使用 `generate` 与 `input_reference_file_ids`。`quality`（auto/low/medium/high/xhigh/max）与 `resolution_tier`（1k/2k/4k/720p）是不同概念，不互相替换。格式/数量等字段不填表示使用可匹配模型的默认行为；显式填写即为硬约束。

旧显式请求仍按原模型执行，不加入自动降级；历史记录照常读取。重试 API 新增 `routing_mode: auto|exact`，**为兼容旧 API 默认 exact**；普通界面明确发送 auto。auto 从保存的原始意图重新筛选，不把上一轮路由注入的默认值误当成用户新要求。旧单清晰度模型的重试从配置恢复清晰度，避免历史 4K 任务降为默认 720P/1K。新版本沿用 scene/generation/parent/version 关系。

`same_seed` 且历史存在 seed 时锁定原模型；跨模型随机过程不等价。图片智能请求暂不支持 seed，明确拒绝而非删除。精确重试保留历史 seed（旧适配器是否支持该字段仍受其原协议限制）；`new_seed` 只允许当前支持 seed 的 Provider。历史模型被删除时 exact 返回 503；auto 只有全部保留原请求语义且有报价才可重新匹配，否则返回 400，不改历史记录。

## 已审查的 15 模型与价格

以下为当前 `providers.json`、能力目录、适配器和 `pricing.json` 的**本地配置事实**，不是上游实时计费承诺。RMB 价格已乘 0.7 折扣；图片数量再乘 n。

| 模型 | 协议/能力 | 单份估价 |
|---|---|---|
| gpt-image-2.5-1k | 同步 generate/edit；固定 1K 比例映射；无官方格式、背景、n、seed 参数 | 0.014 |
| gpt-image-2.5 | 同步官方 generate/edit；像素尺寸、quality、背景、格式、n、编辑保真度 | generate 1K/2K/4K：0.0196 / 0.084 / 0.147 |
| gpt-image-2.5-vip | 同上 | generate：0.049 / 0.126 / 0.196 |
| gpt-image-2.5-flare | 同上 | generate：0.084 / 0.112 / 0.147 |
| gpt-image-2.5-sunburst | 同上 | generate：0.084 / 0.112 / 0.147 |
| gemini-3-pro-image-preview / -2k / -4k | 3 个同步模型；generate/edit；比例、文件/URL参考，档位由模型决定 | 各 0.2996 |
| gemini-3-pro-image-preview-async / -2k-async / -4k-async | 3 个异步模型；仅 generate；input_reference；job ID + 轮询恢复 | 各 0.2996 |
| veo3.1 / veo3.1-4k | 2 个异步首/尾帧模型；8 秒，横/竖方向，seed | 各 0.7 |
| veo3.1-components / veo3.1-components-4k | 2 个异步参考素材模型；8 秒，横/竖方向，seed | 各 0.7 |

重要缺口：官方 GPT 的价格条目限定 `operation=generate`，**没有 edit 报价**。智能编辑不借用生成价格；需要官方 quality/透明背景/格式/n/input_fidelity 的编辑目前可能无候选，明确拒绝。普通高清候选改为 `edit + 4k + 所选结果图`，不再强制 Sunburst/xhigh；已有显式目标参数仍保留，因此部分组合也会被安全拒绝。Gemini 4K edit 在已有通用报价下可选。实验性 4K 是请求目标，不能保证上游实际返回尺寸；既有结果尺寸校验仍报告不一致，不因此重生计费。

## 算法与配置

`config/routing.json` 是路由配置；可通过 `VIDEO_GATEWAY_ROUTING_CONFIG` 指定其他文件，重启服务生效。

1. 按图片/视频、目标档位、模型启用状态、operation、全部请求字段、参考图模式、时长、枚举/数值约束硬过滤。未知或无法证明适配器会消费的选项一律排除，禁止 model/endpoint/extra_body/凭据覆写绕过匹配。
2. 官方尺寸用配置 `ratio_sizes` 映射；显式像素尺寸只接受已核验集合，并检查与档位一致。其余模型保留原始比例，不静默近似。无法确定价格的 auto 像素尺寸/旧参数组合可被拒绝，仍可选择精确 API 重试。
3. 按相同币种的折后**总价**升序，再按配置 priority、provider/model 稳定排序；未知/非有限价格不参与。默认无参数图片选 gpt-image-2.5-1k（0.014），默认视频选 veo3.1（0.7）。参数可能改变此选择。
4. 仅同 group、同协议、同最终尺寸的已匹配候选进入降级计划；保留 operation、quality、参考图及全部选项。不在降级过程中将同步编辑改异步生成、将 Components 改首尾帧，或将像素目标降为比例。固定模型 seed 禁用跨模型降级。
5. 配置默认最多 **2 次总尝试（含首选）**；配置校验硬上限 3。图片总预算 1 RMB、视频 1.4 RMB；请求 `routing_budget` 只能降低上限。计划与执行均累计保守预留每次完整估价，包含被限流拒绝的尝试，不以“也许不收费”放宽预算。

规则配置新增模型并不代表任意协议受支持：适配器/能力目录必须先声明并实际消费其参数；新协议须一起实现验证。group 不代表不同模型能产生相同像素，只表示输入能力可等价保留。

## 执行、恢复与避免重复计费

所有上游同步/异步调用仍在 20 并发 TaskWorker 中运行，API 只创建本地任务。每次 POST 前，选择、尝试状态、预算预留及实际 provider/model 在同一次 SQLite 更新中持久化。自动降级只接受**提交阶段 HTTP 429 且响应无 job ID**的拒绝；限流代表未受理是本阶段的协议假设，不是上游 exactly-once 保证。

超时、断连、5xx、未知异常、已取得 job ID、轮询错误或完成后结果异常均不自动再 POST。路由任务关闭旧 Veo “上传失败后 aggressive 再提交”路径。重启时：queued 首次提交；running 有完整 checkpoint 仅 GET 原 job；无 checkpoint 标记 worker_interrupted，不猜测是否扣费、不切下一个模型。取消不会触发降级。用户手动普通重试是新的、可能计费的任务版本，预算按新任务重新计算；没有声称跨手动重试的幂等/总账硬限额。

诊断存于既有 `request_json.provider_options.__routing`，响应通过 `routing` 暴露，内部选项本身不返回。包含配置版本、原始意图、候选/排除原因、计划、预算、实际尝试与终止原因；路由错误只记录安全错误码，不保存上游错误体、请求头或密钥。客户端不得提交 `__*` 内部选项。

无需破坏性 DB 迁移/回填：旧 request_json 没有 routing，详情显示 null；顶层 provider/model 始终是实际执行选择。前端 localStorage 持久化 key 不变；旧复用草稿迁移到目标式 Composer，旧记录不改写。

## 验证（不访问付费上游）

`uv run --group dev pytest -q`、`pnpm --dir frontend test`、`pnpm --dir frontend build`。路由回归通过 TestClient + 临时 SQLite + httpx.MockTransport 执行真实适配器，覆盖 15 模型审计、图片生成/编辑/参考图/4K/格式/n、同价优先级、预算、429 降级、503不重发、异步图片、Veo 两种参考模式、same_seed、版本链和服务生命周期重启恢复。浏览器验证也必须指定隔离 DB/输出目录并拦截所有出站调用；不能把真实服务作为测试目标。
