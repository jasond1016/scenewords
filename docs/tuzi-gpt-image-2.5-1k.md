# Tuzi GPT Image 2.5 1K

核对日期：2026-09-12。

- 模型与尺寸来源：https://api.tu-zi.com/pricing?model=gpt-image-2.5-1k
- 网页数据源：https://api.tu-zi.com/api/pricing
- 网页折算设置：https://api.tu-zi.com/api/status/static
- 生图接口：https://tuzi-api.apifox.cn/343647071e0
- 编辑接口：https://tuzi-api.apifox.cn/343647072e0

`gpt-image-2.5-1k` 是兔子平台的路由别名。它替换原默认模型
`gpt-image-2-vip`；旧 `gpt-image-2` 和 VIP 的本地价格条目同时移除。
Provider ID 仍为 `nano_banana2`。

继续使用 `/v1/images/generations` JSON 生图和 `/v1/images/edits`
multipart 编辑接口。画面比例按照网页公布的 11 种固定尺寸转换，包含
9:21；不会从模型名的 `1k` 后缀自动添加 `quality` 参数。
尺寸表位于 `app/providers/tuzi_image_models.py`。

公开目录的 `model_price` 为 0.028571428571，default 分组倍率为 1，
网页 `usd_exchange_rate` 为 0.7，折算为 RMB 0.02/次。
本地 `fixed_cost` 据此设置为 0.02，沿用原配置 `discount_rate=0.7`，
所以本地预估为 RMB 0.014/次；该 7 折是已有本地假设，并非此次核实的账户折扣。
平台提到的批量专享优惠需要管理员确认，未自动应用。

验证使用本地测试和前端构建，未提交付费生成请求。
