# 给 OpenClaw 的提示词

你运行在 WSL 里。请为 Windows 本地的 Bilibili 会员购监控脚本配置 OpenClaw webhook 通知入口。

目标：
- Windows 本地脚本会在检测到有票、进入人工接管点或遇到阻断状态时，向 OpenClaw 发送 webhook。
- Windows 脚本默认请求地址是 `http://127.0.0.1:18789/hooks/wake`。
- 请求方式是 `POST`，请求头 `Authorization: Bearer <token>`，JSON body 是 `{ "text": "...", "mode": "now" }`。

请完成：
1. 确认 OpenClaw 版本已升级到 `2026.4.8` 或更高版本。
2. 找到 OpenClaw Gateway 的配置文件。
3. 启用 webhooks：
   ```js
   {
     hooks: {
       enabled: true,
       token: process.env.OPENCLAW_HOOKS_TOKEN,
       path: "/hooks",
       allowedAgentIds: ["main", "hooks"]
     }
   }
   ```
4. 确认 Gateway 监听端口是 `18789`，并且 Windows 能访问到它。
   - 优先使用 `http://127.0.0.1:18789/hooks/wake`。
   - 如果 Windows 访问 WSL localhost 不通，请让 Gateway 绑定 `0.0.0.0`，再用 `wsl hostname -I` 查 WSL IP，并告诉我把 Windows 配置里的 webhook URL 改成 `http://<WSL-IP>:18789/hooks/wake`。
5. 设置 WSL 里的 token 环境变量，例如：
   ```bash
   export OPENCLAW_HOOKS_TOKEN="换成一段足够长的随机密钥"
   ```
6. 把同一个 token 告诉我需要在 Windows PowerShell 里设置成：
   ```powershell
   $env:OPENCLAW_HOOKS_TOKEN="同一段密钥"
   ```
7. 提供一个 Windows PowerShell 测试命令，用来验证 Windows 能触发 OpenClaw：
   ```powershell
   Invoke-RestMethod `
     -Uri "http://127.0.0.1:18789/hooks/wake" `
     -Method Post `
     -Headers @{ Authorization = "Bearer $env:OPENCLAW_HOOKS_TOKEN" } `
     -ContentType "application/json" `
     -Body '{"text":"Bilibili monitor webhook test from Windows","mode":"now"}'
   ```

验收标准：
- Windows PowerShell 测试命令返回成功。
- OpenClaw 主会话能收到一条 “Bilibili monitor webhook test from Windows” 事件。
- 如果 127.0.0.1 不通，请给出 WSL IP 版 URL 和原因。
