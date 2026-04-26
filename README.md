# 哔哩哔哩会员购监控助手

一个本机运行的哔哩哔哩会员购低频监控助手。支持多场次/票档监控、Microsoft Edge 持久化登录态、桌面通知、OpenClaw 桥接通知和人工接管。

## 安全边界

本项目是本机运行的低频监控和人工接管工具，不是自动下单或支付工具。它只基于页面可见文本和按钮状态判断票务状态，不调用非公开下单接口。

本项目不会自动锁单、不会自动提交订单、不会点击“下一步支付”、不会生成支付二维码、不会绕过验证码/排队/风控/地区限制。

检测到有票后，脚本可以自动点击 `立即购票/立即购买` 入口进入订单信息页；进入订单页后只会聚焦浏览器、把鼠标悬停到 `下一步支付` 这类人工接管按钮上、截图、通知并停止，最后支付/提交动作必须由用户手动完成。

请勿将本项目用于违反平台规则、批量抢购、商业倒卖、绕过风控或自动支付等场景。

## 提醒与人工接管

脚本检测到目标票档可用时，会先立即触发本地提醒和 OpenClaw 桥接事件，然后再继续尝试点击 `立即购票/立即购买` 入口进入订单信息页。这样不会等订单页加载、截图或日志写入完成后才提醒。

如果成功进入订单信息页，脚本会停止该目标刷新、聚焦浏览器页面，并把鼠标悬停到 `下一步支付` 等人工接管按钮上。脚本不会点击这个按钮，也不会提交订单、生成支付二维码或完成支付。

如果点击购票入口后没有进入订单信息页，脚本会记录重试并继续按保守间隔尝试；第一次检测到可用时已经发出的提醒不会在短时间内重复刷屏。

## 免责声明

本项目仅用于学习、研究和个人本机提醒。使用者应自行确认当地法律法规、平台服务条款和活动购票规则，并自行承担使用本项目产生的全部风险。

作者不保证监控结果一定准确，也不保证能成功购买任何票品。页面结构变化、登录失效、网络波动、验证码、排队、风控、地区限制、票务库存变化等情况都可能导致检测失败、误报或漏报。

请不要提交、公开或分享你的登录态、Cookie、浏览器 profile、OpenClaw token、运行日志、截图、身份证、手机号、购票人信息或真实活动配置。

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

本地配置文件是 `config/events.yaml`，它不会提交到 GitHub。首次运行 `.\start.ps1` 时会自动交互式生成，也可以单独运行：

```powershell
.\scripts\configure.ps1
```

公开示例见 `config/events.example.yaml`。你也可以手动创建 `config/events.yaml`：

```yaml
defaults:
  # 全局刷新间隔，最低会被限制为 10 秒。建议保持低频，避免给平台造成压力。
  intervalSeconds: 30
  # 随机抖动比例，0.25 表示在基础间隔上下浮动 25%。
  jitterRatio: 0.25
  # 同时打开的监控页面数量。一般保持 1。
  maxParallelPages: 1
  # false 会显示浏览器，方便登录和人工接管。
  headless: false
  # Windows 推荐使用 Edge。可选：msedge、chrome、chromium。
  browserChannel: msedge
  # 检测到可购买入口后，自动进入订单信息页，但不会点击下一步支付。
  autoEnterOrderPage: true
  # 持久化浏览器登录态。不要提交这个目录。
  userDataDir: .browser-profile
  logFile: logs/monitor.log
  screenshotDir: logs/screenshots
  # 启用定期日志清理，避免 screenshots 和 outbox 无限膨胀。
  logCleanupEnabled: true
  # 清理任务执行间隔，单位分钟。
  logCleanupIntervalMinutes: 30
  # screenshots 中文件的保留时长，超时会删除。
  screenshotRetentionHours: 12
  # screenshots 最大保留文件数，超出后按最旧优先删除。
  maxScreenshotFiles: 300
  # monitor.log 最大体积，超出后只保留最新内容。
  maxLogFileBytes: 5242880
  # openclaw-events.jsonl 最大体积，超出后只保留最新内容。
  maxOpenClawEventBytes: 2097152

notifications:
  openclaw:
    # 当前推荐使用 GUI 自带的 4174 只读桥接服务，通常这里保持 false。
    enabled: false
    url: http://127.0.0.1:18789/hooks/wake
    tokenEnv: OPENCLAW_HOOKS_TOKEN
    mode: now

events:
  - name: example-event
    # 替换为你的会员购活动页地址。
    url: https://show.bilibili.com/platform/detail.html?id=example
    # 可覆盖全局刷新间隔。
    intervalSeconds: 30
    targets:
      - name: example-target
        # 建议至少包含日期、价格、票档/区域。每一行都必须能在页面可见文本中匹配到。
        keywords:
          - "2026-05-08"
          - "￥488"
          - "内场"
        quantity: 1
        # 数字越小优先级越高。
        priority: 1
```

### 配置字段说明

- `defaults.intervalSeconds`：默认刷新间隔，最低 10 秒。
- `defaults.jitterRatio`：随机抖动比例，降低固定频率轮询特征。
- `defaults.maxParallelPages`：并发页面数，多活动监控时也建议从 1 开始。
- `defaults.headless`：是否无头运行；首次登录和日常人工接管建议设为 `false`。
- `defaults.browserChannel`：浏览器通道，Windows 推荐 `msedge`。
- `defaults.autoEnterOrderPage`：检测到可购买入口后是否进入订单信息页；即使设为 `true`，脚本也不会点击支付/提交类按钮。
- `defaults.userDataDir`：Playwright 持久化 profile 目录，用于保存登录态。不要提交或分享。
- `defaults.logCleanupEnabled`：是否启用定期日志清理。
- `defaults.logCleanupIntervalMinutes`：清理任务执行间隔，单位分钟。
- `defaults.screenshotRetentionHours`：截图保留时长，超时文件会删除。
- `defaults.maxScreenshotFiles`：截图目录最大保留文件数，超出后删除最旧文件。
- `defaults.maxLogFileBytes`：`monitor.log` 最大体积，超出后只保留最新日志行。
- `defaults.maxOpenClawEventBytes`：`logs/openclaw-events.jsonl` 最大体积，超出后只保留最新事件行。
- `events[].url`：会员购活动详情页 URL。
- `events[].targets[]`：要监控的目标票档。每个 target 可以配置 `keywords`，也可以使用 `date`、`session`、`price`，最终都会合并为关键词。
- `targets[].name`：只用于日志、通知和界面显示，不参与页面匹配。如果“内场”“看台 A 区”等票档名称需要参与判断，请也写进 `keywords`。
- `targets[].quantity`：期望数量，用于记录和页面数量操作。
- `targets[].priority`：优先级，数字越小越早检查。
- `targets[].intervalSeconds`：单个票档的刷新间隔，可覆盖活动和全局间隔。

### 关键词写法

关键字匹配基于页面可见文本，建议至少包含日期、价格和票档/区域，例如：

```text
2026-05-08
￥488
内场
```

关键字按行处理，空行会被忽略，所有非空行都是必选条件。也就是说，上面三行等价于 `2026-05-08 AND ￥488 AND 内场`，所有关键字都必须在页面可见文本或按钮文本中存在，才会触发选座逻辑。

会员购页面通常是先选日期/场次，再在下方选价格/座位。检测逻辑会允许日期按钮和座位按钮分开确认：日期行必须匹配到可用日期/场次，非日期行必须匹配到同一个价格/座位选项。如果你只关心任意内场，可以写 `2026-05-08` + `内场`；如果只要特定价格或区域，建议继续加上 `￥488`、`A1区` 等更具体的行。

如果页面上存在多个按钮匹配相同的价格关键字（例如两个 `￥148`），脚本会优先选择文本最短（最具体）的匹配项，或者已经选中的选项。为避免选错，建议在关键字里加上额外的词来精准区分，例如 `solo电竞酒店` 或区域名称。

日期支持一定程度的格式归一化，例如 `2026-5-8` 和 `2026-05-08` 可以互相匹配。价格中的 `￥` 和 `¥` 也会归一化。页面文字仍然可能因为活动改版而变化，如果日志里出现 `Target keyword lines not all visible`，请根据页面实际文案调整关键词。

不建议只写价格或只写“内场”，否则页面上其他日期或其他票档可购买时可能造成误报。越具体越好，例如同时写日期、价格、区域、场次。

检测逻辑现在会优先尝试确认目标票档片段本身是否可售；如果只看到页面级的“立即购票”“有票”等文案，但无法确认这些文案属于目标票档，会记录为 `unknown`，不会触发有票报警。

默认使用 Microsoft Edge：

```yaml
browserChannel: msedge
autoEnterOrderPage: true
```

首次启动监控时会打开一个独立浏览器 profile，请在里面手动登录 B 站；后续运行会复用登录态。

## OpenClaw 通知

推荐让 OpenClaw 从 WSL 主动连接 Windows 本地桥接服务，而不是让 Windows 去猜 OpenClaw 的 webhook 地址。

GUI 启动后会同时启动一个只读桥接服务：

```text
http://127.0.0.1:4174/health
http://127.0.0.1:4174/events?since=0
```

Windows 侧检查：

```powershell
pnpm bridge:check
```

如果 WSL 无法访问 `4174`，请用管理员 PowerShell 添加防火墙规则：

```powershell
netsh advfirewall firewall add rule name="Bilibili Bridge" dir=in action=allow protocol=TCP localport=4174
```

监控检测到有票、阻断或人工接管事件后，会写入：

```text
logs/openclaw-events.jsonl
```

把 [OPENCLAW_PROMPT.md](OPENCLAW_PROMPT.md) 当作模板发给 OpenClaw，让它在 WSL 里轮询 `/events`。模板里的 `<WINDOWS_HOST>` 需要替换成你自己的 Windows 主机地址；如果 WSL 访问 `127.0.0.1:4174` 不通，通常可以在 WSL 中动态获取 Windows 网关 IP：

```bash
ip route | awk '/default/ {print $3; exit}'
```

例如：

```bash
WINDOWS_HOST="$(ip route | awk '/default/ {print $3; exit}')"
curl -sS "http://${WINDOWS_HOST}:4174/health"
curl -sS "http://${WINDOWS_HOST}:4174/events?since=0"
```

如果仍然不通，通常需要确认 GUI/桥接服务已启动、`4174` 正在监听 `0.0.0.0`，以及 Windows 防火墙已放行 TCP 4174。

## 日志清理

如果你长时间开着监控，真正占空间的通常不是 `monitor.log`，而是 `logs/screenshots/` 里的截图。现在脚本会按配置定期清理：

- 删除超过 `screenshotRetentionHours` 的旧截图
- 当截图数量超过 `maxScreenshotFiles` 时，继续删除最旧截图
- 当 `monitor.log` 超过 `maxLogFileBytes` 时，只保留最新日志行
- 当 `logs/openclaw-events.jsonl` 超过 `maxOpenClawEventBytes` 时，只保留最新事件行

默认是开启的。如果你需要保留更长的排查材料，可以把保留时长或文件数调大；如果你需要完全停用自动清理，可以把 `logCleanupEnabled` 设为 `false`。

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
