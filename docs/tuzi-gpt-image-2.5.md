# Tuzi GPT Image 2.5 / VIP

核对日期：2026-09-12。

来源：

- https://api.tu-zi.com/pricing?model=gpt-image-2.5
- https://api.tu-zi.com/pricing?model=gpt-image-2.5-vip
- 网页公开目录：https://api.tu-zi.com/api/pricing
- 网页折算设置：https://api.tu-zi.com/api/status/static

两者加入现有 `nano_banana2` Provider，默认模型仍为 `gpt-image-2.5-1k`。
模型名称原样提交到 `/v1/images/generations`，沿用现有比例和参考图参数。
清晰度通过 `quality` 传递，可选 `1k`、`2k`、`4k`，默认 `1k`。
1K 专用模型的固定像素尺寸限制不扩展到这两个模型。

当前目录未列出 `/v1/images/edits`，因此仅暴露同步生图操作。
两个名称都是兔子路由别名，上游模型由平台决定。

价格读取 `group_model_pricing.default.billing_expr`，不能使用顶层
`model_price=0`（顶层同时标记 `pricing_unavailable=true`）。
default 分组的 1K/2K/4K 档位分别为普通版 0.04/0.1714285714/0.3，
VIP 0.1/0.2571428571/0.4；按网页 `usd_exchange_rate=0.7` 折算：

| 模型 | 清晰度 | RMB 基础价/次 | 本地 7 折预估/次 |
|---|---|---:|---:|
| GPT Image 2.5 | 1K | 0.028 | 0.0196 |
| GPT Image 2.5 | 2K | 0.12 | 0.084 |
| GPT Image 2.5 | 4K | 0.21 | 0.147 |
| GPT Image 2.5 VIP | 1K | 0.07 | 0.049 |
| GPT Image 2.5 VIP | 2K | 0.18 | 0.126 |
| GPT Image 2.5 VIP | 4K | 0.28 | 0.196 |

沿用原配置的 `discount_rate=0.7` 是本地预估假设，并非核实后的账户折扣。
其他令牌分组价格可能不同。未提交付费生成请求。
