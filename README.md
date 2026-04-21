# 哔哩哔哩会员购监控助手

一个本机运行的哔哩哔哩会员购低频监控助手。支持多场次/票档监控、Microsoft Edge 持久化登录态、桌面通知、OpenClaw Webhook 通知和人工接管。

## 安全边界

本项目不会自动锁单、不会自动提交订单、不会点击“下一步支付”、不会生成支付二维码、不会绕过验证码/排队/风控/地区限制，也不会调用非公开下单接口。

检测到有票或进入订单页后，脚本只会聚焦浏览器、把鼠标悬停到人工接管按钮上、截图、通知并停止，最后操作必须由用户手动完成。

## 快速开始（Windows）

第一次使用推荐直接运行：

```powershell
.\start.ps1
```

脚本会自动完成：

- 检查 Node.js 20+ 和 pnpm
- 安装依赖
- 如果没有 `config/events.yaml`，交互式生成配置
- 启动图形界面

启动后打开：

```text
http://127.0.0.1:4173
```

如果 PowerShell 阻止脚本运行，可在当前窗口临时允许：

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\start.ps1
```

## 手动命令

```powershell
pnpm install
pnpm gui
```

不访问真实页面的本地验证：

```powershell
pnpm monitor:dry-run
```

命令行监控：

```powershell
pnpm monitor
```

## 配置

本地配置文件是 `config/events.yaml`，它不会提交到 GitHub。首次运行 `.\start.ps1` 时会自动生成，也可以单独运行：

```powershell
.\scripts\configure.ps1
```

公开示例见：

```text
config/events.example.yaml
```

关键字匹配基于页面可见文本，建议至少包含日期、价格和票档区域，例如：

```text
2026-05-08
￥488
内场
```

默认使用 Microsoft Edge：

```yaml
browserChannel: msedge
```

首次启动监控时会打开一个独立浏览器 profile，请在里面手动登录 B 站；后续运行会复用登录态。

## OpenClaw 通知

OpenClaw 是可选通知通道。Windows 本地脚本默认向 WSL OpenClaw Gateway 发送：

```text
http://127.0.0.1:18789/hooks/wake
```

把 [OPENCLAW_PROMPT.md](OPENCLAW_PROMPT.md) 的内容交给 OpenClaw，让它启用 hooks。token 只通过环境变量传入，不写入配置文件：

```powershell
$env:OPENCLAW_HOOKS_TOKEN="换成 OpenClaw 中配置的 token"
.\start.ps1
```

如果 Windows 访问 WSL 的 `127.0.0.1:18789` 不通，请在 WSL 里用 `hostname -I` 查询 IP，再把 GUI 里的 OpenClaw URL 改成 `http://<WSL-IP>:18789/hooks/wake`。

## 开源隐私说明

仓库不会包含以下本地数据：

- `config/events.yaml` 和 `config/*.local.yaml`
- `.browser-profile/` 登录态
- `logs/` 运行日志和截图
- `.env` 和任何 token
- `node_modules/`、`dist/`

## 开发

```powershell
pnpm typecheck
pnpm test
```

## License

MIT
