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
$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Information
$notify.BalloonTipTitle = ${quotePowerShell(payload.title)}
$notify.BalloonTipText = ${quotePowerShell(payload.message)}
$notify.Visible = $true
$notify.ShowBalloonTip(7000)
Start-Sleep -Seconds 8
$notify.Dispose()
`;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], {
    detached: true,
    stdio: "ignore",
    windowsHide: true
  }).unref();
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function quoteAppleScript(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}
