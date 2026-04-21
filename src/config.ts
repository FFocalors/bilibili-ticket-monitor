import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type {
  EventConfig,
  MonitorConfig,
  MonitorDefaults,
  NotificationConfig,
  NormalizedTarget,
  OpenClawNotificationConfig,
  TargetConfig
} from "./types.js";

const DEFAULTS: MonitorDefaults = {
  intervalSeconds: 30,
  jitterRatio: 0.25,
  maxParallelPages: 1,
  headless: false,
  browserChannel: "msedge",
  userDataDir: ".browser-profile",
  logFile: "logs/monitor.log",
  screenshotDir: "logs/screenshots"
};

const DEFAULT_NOTIFICATIONS: NotificationConfig = {
  openclaw: {
    enabled: false,
    url: "http://127.0.0.1:18789/hooks/wake",
    tokenEnv: "OPENCLAW_HOOKS_TOKEN",
    mode: "now"
  }
};

const MIN_INTERVAL_SECONDS = 10;

interface RawConfig {
  defaults?: Partial<MonitorDefaults>;
  notifications?: Partial<NotificationConfig>;
  events?: EventConfig[];
}

export async function loadConfig(configPath: string): Promise<MonitorConfig> {
  const absolutePath = path.resolve(configPath);
  let raw: string;
  try {
    raw = await readFile(absolutePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(`Config file not found: ${absolutePath}. Run scripts/configure.ps1 or start.ps1 to create config/events.yaml.`);
    }
    throw error;
  }
  return parseConfig(raw, process.cwd());
}

export function parseConfig(raw: string, baseDir = process.cwd()): MonitorConfig {
  const parsed = parseYaml(raw) as RawConfig | null;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Config must be a YAML object.");
  }

  const defaults = normalizeDefaults(parsed.defaults ?? {}, baseDir);
  const notifications = normalizeNotifications(parsed.notifications ?? {});
  const events = normalizeEvents(parsed.events);
  return { defaults, notifications, events };
}

export function flattenTargets(config: MonitorConfig): NormalizedTarget[] {
  const targets: NormalizedTarget[] = [];

  config.events.forEach((event, eventIndex) => {
    event.targets.forEach((target, targetIndex) => {
      const keywords = normalizeKeywords(target);
      const priority = target.priority ?? event.priority ?? 100;
      const intervalSeconds = clampInterval(target.intervalSeconds ?? event.intervalSeconds ?? config.defaults.intervalSeconds);
      const targetName = target.name ?? (keywords.join(" / ") || `target-${targetIndex + 1}`);

      targets.push({
        id: `${eventIndex + 1}-${targetIndex + 1}-${slugify(event.name)}-${slugify(targetName)}`,
        eventName: event.name,
        name: targetName,
        url: event.url,
        keywords,
        quantity: positiveInteger(target.quantity ?? 1, `events[${eventIndex}].targets[${targetIndex}].quantity`),
        priority,
        intervalSeconds
      });
    });
  });

  return targets.sort((a, b) => a.priority - b.priority || a.eventName.localeCompare(b.eventName) || a.name.localeCompare(b.name));
}

function normalizeDefaults(raw: Partial<MonitorDefaults>, baseDir: string): MonitorDefaults {
  const intervalSeconds = clampInterval(raw.intervalSeconds ?? DEFAULTS.intervalSeconds);
  const jitterRatio = typeof raw.jitterRatio === "number" && Number.isFinite(raw.jitterRatio)
    ? Math.max(0, Math.min(raw.jitterRatio, 1))
    : DEFAULTS.jitterRatio;

  return {
    intervalSeconds,
    jitterRatio,
    maxParallelPages: positiveInteger(raw.maxParallelPages ?? DEFAULTS.maxParallelPages, "defaults.maxParallelPages"),
    headless: Boolean(raw.headless ?? DEFAULTS.headless),
    browserChannel: normalizeBrowserChannel(raw.browserChannel ?? DEFAULTS.browserChannel),
    userDataDir: resolveConfigPath(raw.userDataDir ?? DEFAULTS.userDataDir, baseDir),
    logFile: resolveConfigPath(raw.logFile ?? DEFAULTS.logFile, baseDir),
    screenshotDir: resolveConfigPath(raw.screenshotDir ?? DEFAULTS.screenshotDir, baseDir)
  };
}

function normalizeBrowserChannel(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "chromium" || trimmed === "msedge" || trimmed === "chrome") {
    return trimmed;
  }
  return DEFAULTS.browserChannel;
}

function normalizeNotifications(raw: Partial<NotificationConfig>): NotificationConfig {
  return {
    openclaw: normalizeOpenClaw(raw.openclaw ?? {})
  };
}

function normalizeOpenClaw(raw: Partial<OpenClawNotificationConfig>): OpenClawNotificationConfig {
  const enabled = Boolean(raw.enabled ?? DEFAULT_NOTIFICATIONS.openclaw.enabled);
  const url = typeof raw.url === "string" && raw.url.trim()
    ? raw.url.trim()
    : DEFAULT_NOTIFICATIONS.openclaw.url;
  const tokenEnv = typeof raw.tokenEnv === "string" && raw.tokenEnv.trim()
    ? raw.tokenEnv.trim()
    : DEFAULT_NOTIFICATIONS.openclaw.tokenEnv;
  const mode = raw.mode === "next-heartbeat" ? "next-heartbeat" : "now";

  if (enabled) {
    try {
      new URL(url);
    } catch {
      throw new Error("notifications.openclaw.url must be a valid URL when enabled.");
    }
  }

  return { enabled, url, tokenEnv, mode };
}

function normalizeEvents(events: EventConfig[] | undefined): EventConfig[] {
  if (!Array.isArray(events) || events.length === 0) {
    throw new Error("Config must include at least one event.");
  }

  return events.map((event, eventIndex) => {
    if (!event || typeof event !== "object") {
      throw new Error(`events[${eventIndex}] must be an object.`);
    }
    if (!event.name || typeof event.name !== "string") {
      throw new Error(`events[${eventIndex}].name is required.`);
    }
    if (!event.url || typeof event.url !== "string") {
      throw new Error(`events[${eventIndex}].url is required.`);
    }
    try {
      new URL(event.url);
    } catch {
      throw new Error(`events[${eventIndex}].url must be a valid URL.`);
    }
    if (!Array.isArray(event.targets) || event.targets.length === 0) {
      throw new Error(`events[${eventIndex}].targets must include at least one target.`);
    }
    event.targets.forEach((target, targetIndex) => validateTarget(target, eventIndex, targetIndex));
    return event;
  });
}

function validateTarget(target: TargetConfig, eventIndex: number, targetIndex: number): void {
  if (!target || typeof target !== "object") {
    throw new Error(`events[${eventIndex}].targets[${targetIndex}] must be an object.`);
  }
  if (normalizeKeywords(target).length === 0) {
    throw new Error(`events[${eventIndex}].targets[${targetIndex}] must include keywords, date, session, or price.`);
  }
  if (target.quantity !== undefined) {
    positiveInteger(target.quantity, `events[${eventIndex}].targets[${targetIndex}].quantity`);
  }
}

function normalizeKeywords(target: TargetConfig): string[] {
  return [
    ...(Array.isArray(target.keywords) ? target.keywords : []),
    target.date,
    target.session,
    target.price
  ]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive integer.`);
  }
  return value;
}

function clampInterval(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULTS.intervalSeconds;
  }
  return Math.max(MIN_INTERVAL_SECONDS, Math.floor(value));
}

function resolveConfigPath(value: string, baseDir: string): string {
  return path.isAbsolute(value) ? value : path.resolve(baseDir, value);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "target";
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
