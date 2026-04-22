import { spawn } from "node:child_process";
import { platform } from "node:os";
import type { OpenClawNotificationConfig } from "./types.js";

export interface NotificationPayload {
  title: string;
  message: string;
  sound?: boolean;
  details?: Record<string, unknown>;
}

export function notifyUser(payload: NotificationPayload): void {
  if (payload.sound ?? true) {
    process.stdout.write("\u0007");
  }

  if (platform() === "win32") {
    notifyWindows(payload);
    return;
  }
  if (platform() === "darwin") {
    spawn("osascript", ["-e", `display notification ${quoteAppleScript(payload.message)} with title ${quoteAppleScript(payload.title)}`], {
      detached: true,
      stdio: "ignore"
    }).unref();
    return;
  }

  spawn("notify-send", [payload.title, payload.message], {
    detached: true,
    stdio: "ignore"
  }).unref();
}

export async function notifyOpenClaw(
  config: OpenClawNotificationConfig,
  payload: NotificationPayload
): Promise<boolean> {
  if (!config.enabled) {
    return false;
  }

  const token = process.env[config.tokenEnv];
  if (!token) {
    throw new Error(`OpenClaw token env ${config.tokenEnv} is not set.`);
  }

  const text = [
    payload.title,
    payload.message,
    payload.details ? JSON.stringify(payload.details) : undefined
  ].filter(Boolean).join("\n");

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      text,
      mode: config.mode
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenClaw webhook failed: HTTP ${response.status}${body ? ` ${body.slice(0, 200)}` : ""}`);
  }

  return true;
}

function notifyWindows(payload: NotificationPayload): void {
  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$title = ${quotePowerShell(payload.title)}
$message = ${quotePowerShell(payload.message)}
try {
  $notify = New-Object System.Windows.Forms.NotifyIcon
  $notify.Icon = [System.Drawing.SystemIcons]::Warning
  $notify.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Warning
  $notify.BalloonTipTitle = $title
  $notify.BalloonTipText = $message
  $notify.Visible = $true
  $notify.ShowBalloonTip(10000)

  $speech = $null
  try {
    Add-Type -AssemblyName System.Speech
    $speech = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $speech.Rate = 1
    $speech.Volume = 100
    $speech.SpeakAsync("有票了，请立即处理") | Out-Null
  } catch {}

  $lineBreak = [Environment]::NewLine
  $screen = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
  $form = New-Object System.Windows.Forms.Form
  $form.Text = $title
  $form.TopMost = $true
  $form.ShowInTaskbar = $true
  $form.StartPosition = "Manual"
  $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
  $form.WindowState = [System.Windows.Forms.FormWindowState]::Maximized
  $form.Bounds = $screen
  $form.BackColor = [System.Drawing.ColorTranslator]::FromHtml("#b00020")
  $form.KeyPreview = $true

  $headline = New-Object System.Windows.Forms.Label
  $headline.Text = "有票了"
  $headline.Dock = [System.Windows.Forms.DockStyle]::Top
  $headline.Height = 190
  $headline.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
  $headline.Font = New-Object System.Drawing.Font -ArgumentList @("Microsoft YaHei UI", 64, [System.Drawing.FontStyle]::Bold)
  $headline.ForeColor = [System.Drawing.Color]::White

  $detail = New-Object System.Windows.Forms.Label
  $detail.Text = $message + $lineBreak + $lineBreak + "OpenClaw 已通知。请立即查看浏览器订单页，处理完点下方按钮关闭。"
  $detail.Dock = [System.Windows.Forms.DockStyle]::Fill
  $detail.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
  $detail.Font = New-Object System.Drawing.Font -ArgumentList @("Microsoft YaHei UI", 26, [System.Drawing.FontStyle]::Bold)
  $detail.ForeColor = [System.Drawing.Color]::White
  $detail.Padding = New-Object System.Windows.Forms.Padding -ArgumentList @(40, 10, 40, 10)

  $bottom = New-Object System.Windows.Forms.Panel
  $bottom.Dock = [System.Windows.Forms.DockStyle]::Bottom
  $bottom.Height = 150
  $bottom.BackColor = [System.Drawing.Color]::Transparent

  $button = New-Object System.Windows.Forms.Button
  $button.Text = "我知道了，关闭提醒"
  $button.Width = 360
  $button.Height = 72
  $button.Font = New-Object System.Drawing.Font -ArgumentList @("Microsoft YaHei UI", 22, [System.Drawing.FontStyle]::Bold)
  $button.BackColor = [System.Drawing.Color]::White
  $button.ForeColor = [System.Drawing.ColorTranslator]::FromHtml("#b00020")
  $button.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
  $button.FlatAppearance.BorderSize = 0
  $button.Add_Click({ $form.Close() })
  $bottom.Controls.Add($button)
  $bottom.Add_Resize({
    $button.Left = [int](($bottom.ClientSize.Width - $button.Width) / 2)
    $button.Top = [int](($bottom.ClientSize.Height - $button.Height) / 2)
  })

  $form.Controls.Add($detail)
  $form.Controls.Add($headline)
  $form.Controls.Add($bottom)
  $form.AcceptButton = $button
  $form.CancelButton = $button
  $form.Add_KeyDown({
    if ($_.KeyCode -eq [System.Windows.Forms.Keys]::Escape -or $_.KeyCode -eq [System.Windows.Forms.Keys]::Space) {
      $form.Close()
    }
  })

  $script:flashOn = $false
  $script:tickCount = 0
  $timer = New-Object System.Windows.Forms.Timer
  $timer.Interval = 500
  $timer.Add_Tick({
    $script:flashOn = -not $script:flashOn
    $script:tickCount += 1
    if ($script:flashOn) {
      $form.BackColor = [System.Drawing.ColorTranslator]::FromHtml("#ffeb3b")
      $headline.ForeColor = [System.Drawing.ColorTranslator]::FromHtml("#b00020")
      $detail.ForeColor = [System.Drawing.ColorTranslator]::FromHtml("#111111")
    } else {
      $form.BackColor = [System.Drawing.ColorTranslator]::FromHtml("#b00020")
      $headline.ForeColor = [System.Drawing.Color]::White
      $detail.ForeColor = [System.Drawing.Color]::White
    }
    try { [System.Media.SystemSounds]::Hand.Play() } catch {}
    try { [Console]::Beep(1300, 180) } catch {}
    if ($script:tickCount % 10 -eq 0 -and $speech -ne $null) {
      try {
        $speech.SpeakAsyncCancelAll()
        $speech.SpeakAsync("有票了，请立即处理") | Out-Null
      } catch {}
    }
    $form.TopMost = $true
    $form.Activate()
    $form.BringToFront()
  })
  $form.Add_Shown({
    $button.Left = [int](($bottom.ClientSize.Width - $button.Width) / 2)
    $button.Top = [int](($bottom.ClientSize.Height - $button.Height) / 2)
    $form.TopMost = $true
    $form.Activate()
    $form.BringToFront()
    $timer.Start()
  })
  $form.Add_FormClosed({
    $timer.Stop()
    $timer.Dispose()
    if ($speech -ne $null) {
      $speech.SpeakAsyncCancelAll()
      $speech.Dispose()
    }
    $notify.Dispose()
  })

  [System.Windows.Forms.Application]::EnableVisualStyles()
  [System.Windows.Forms.Application]::Run($form)
} catch {
  $errorPath = Join-Path $env:TEMP "bilibili-ticket-local-notifier-error.log"
  $_ | Out-String | Out-File -FilePath $errorPath -Append -Encoding utf8
  [System.Windows.Forms.MessageBox]::Show(
    $message,
    $title,
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Warning
  ) | Out-Null
}
`;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  spawn("powershell.exe", ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
    detached: true,
    stdio: "ignore",
    windowsHide: false
  }).unref();
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function quoteAppleScript(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}
