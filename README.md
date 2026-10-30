# keypad-relay

手表输入法有长度上限，长密钥（例如 68 字符的 API Key）打不进去。这个小工具用手机网页中转一次，把手表填不了的内容传过去。

配一个手机端填表页 + 两个接口，存取全自动：手表生成 6 位配对码 → 手机打开网页、填码、粘贴密钥、提交 → 手表自动收下并保存。

## 默认实例

作者自己部署了一份，地址：`https://pad.765528.xyz`

> ⚠️ 仅用于体验。长期使用请自己部署一份（见下），密钥只经你自己的服务器。

> ⚠️ `*.workers.dev` 在中国大陆被 DNS 污染，无法直接访问，所以要绑自定义域（见「部署」第 4 步）。

## 部署（四步，约三分钟）

```bash
cd keypad-relay
npm install -g wrangler          # 已装过可跳过
wrangler login                   # 已登录可跳过

npx wrangler kv namespace create KEYPAD
# 输出形如：id = "abc123def456..."
# 把这段 id 填进 wrangler.toml 里 REPLACE_WITH_YOUR_KV_NAMESPACE_ID 的位置

# （重要）在 wrangler.toml 里加自定义域，workers.dev 在国内连不上
routes = [
  { pattern = "pad.你的域名.com", custom_domain = true }
]
# 注意 routes 要写在 [[kv_namespaces]] 之前，否则 TOML 会把它归错表

npx wrangler deploy
```

打开部署出的地址（如 `https://pad.你的域名.com/health`），看到：

```json
{"ok":true,"service":"keypad-relay","hasKV":true}
```

就算成功。`hasKV` 如果是 `false`，说明 `wrangler.toml` 里的 KV id 没填对。

## 在手表上用

1. 手表打开「落笔」→ 设置
2. 把上面那个地址填到**中转**一栏（只需填一次）
3. 点「密钥」右侧的「手机」
4. 手表显示 6 位配对码
5. 手机打开 `<你的地址>/keypad`，填配对码、粘贴密钥、提交
6. 手表自动收下并保存

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查 |
| GET | `/keypad?code=XXXXXX` | 手机端页面 |
| POST | `/keypad/set` | `{code, key}` 写入，10 分钟过期 |
| GET | `/keypad/get?code=XXXXXX` | 手表取走，读到即删 |

## 说明

- 存储用 KV，键 `k:<配对码>`，`expirationTtl` 600 秒
- 配对码 6 位，字符集为 `ABCDEFGHJKMNPQRSTUVWXYZ23456789`（去掉了易混的 I/O/L/0/1），组合约 3.6 亿种，10 分钟内无法爆破
- 密钥长度上限 512 字节
- 手表取走后立即删除；未被取走则 10 分钟后由 KV 自动过期

## 自定义域名（必须）

`workers.dev` 在国内被 DNS 污染，`custom_domain` 只能走你自己的域名。域名的 DNS 需托管在 Cloudflare（`custom_domain` 会自动建解析和证书）。

绑好后把手表里的中转地址换成你自己的域名。

## License

MIT
