# 给 OpenClaw 的提示词模板

你运行在 WSL 里。Windows 本地正在运行一个 Bilibili 会员购监控 GUI，它不会向 OpenClaw 推送 webhook，而是暴露一个只读本地桥接服务。请你主动连接这个桥接服务，轮询有票通知事件。

背景：
- Windows 项目路径：`<WINDOWS_PROJECT_DIR>`
- GUI 地址：`http://127.0.0.1:4173`
- OpenClaw 只读桥接服务默认监听：`0.0.0.0:4174`
- 桥接服务健康检查：`GET /health`
- 事件拉取接口：`GET /events?since=<last_event_id>`
- 这不是 OpenClaw 的 `/hooks/wake` webhook。不要请求 `18789/hooks/wake`，那个路径在当前方案里不用。
- 如果 WSL 不能通过 `127.0.0.1` 访问 Windows，请使用 `<WINDOWS_HOST>`，或者按下方命令动态获取 Windows 网关 IP。

Windows 侧前置条件：
- Windows 用户需要先启动 GUI：`.\start.ps1` 或 `pnpm gui`
- Windows 侧 `4174` 应该监听在 `0.0.0.0:4174`
- 如果 Windows 防火墙未放行，需要用户用管理员 PowerShell 执行：
  ```powershell
  netsh advfirewall firewall add rule name="Bilibili Bridge" dir=in action=allow protocol=TCP localport=4174
  ```
- 响应格式：
  ```json
  {
    "ok": true,
    "events": [
      {
        "id": 1,
        "time": "2026-04-21T14:00:00.000Z",
        "title": "Bilibili ticket available",
        "message": "...",
        "details": {}
      }
    ],
    "latestId": 1,
    "nextSince": 1
  }
  ```

请完成：

1. 在 WSL 里先尝试访问 Windows localhost：
   ```bash
   curl -sS http://127.0.0.1:4174/health
   ```
2. 如果不通，动态获取 Windows 主机网关 IP：
   ```bash
   WINDOWS_HOST="$(ip route | awk '/default/ {print $3; exit}')"
   curl -sS "http://${WINDOWS_HOST}:4174/health"
   ```
3. 如果用户已经提供了 Windows 主机地址，则直接使用：
   ```bash
   WINDOWS_HOST="<WINDOWS_HOST>"
   curl -sS "http://${WINDOWS_HOST}:4174/health"
   ```
4. 如果仍不通，直接反馈以下三项，不要再尝试 `/hooks/wake`，不要使用 `18789`：
   - Windows GUI/桥接服务可能未启动。
   - Windows 防火墙可能未放行 TCP 4174。
   - Windows 侧应运行 `pnpm bridge:check` 查看监听和防火墙状态。
5. 连接成功后，使用下面逻辑轮询：
   - 维护一个 `since`，初始为 `0`。
   - 每 5 秒请求：`GET http://<windows-host>:4174/events?since=<since>`。
   - 如果 `events` 非空，逐条把 `title`、`message`、`details` 作为 OpenClaw 通知/提醒输出给我。
   - 每次请求后把 `since` 更新为响应里的 `nextSince`。
   - 如果连接失败，指数退避重试，最长 60 秒。
6. 请先用以下命令验证能拉到测试事件：
   ```bash
   HOST="${WINDOWS_HOST:-127.0.0.1}"
   curl -sS "http://${HOST}:4174/events?since=0"
   ```
7. 验收标准：
   - `/health` 返回 `ok: true`。
   - 我在 Windows GUI 点击“测试 OpenClaw”后，你能在 `/events?since=0` 看到一条 `Bilibili 会员购监控测试`。
   - 监控脚本检测到有票后，你能把 `Bilibili ticket available` 事件通知给我。

请直接执行检查并汇报你最终使用的桥接 URL，例如：

```text
OpenClaw 已连接 Windows 监控桥接服务：
http://<windows-host>:4174/events
当前 since=<number>
```
