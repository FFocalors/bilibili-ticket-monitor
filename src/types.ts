export type TicketState = "sold_out" | "available" | "unknown" | "blocked";

export interface TargetConfig {
  name?: string;
  keywords?: string[];
  date?: string;
  session?: string;
  price?: string;
  quantity?: number;
  priority?: number;
  intervalSeconds?: number;
}

export interface EventConfig {
  name: string;
  url: string;
  intervalSeconds?: number;
  priority?: number;
  targets: TargetConfig[];
}

export interface MonitorDefaults {
  intervalSeconds: number;
  jitterRatio: number;
  maxParallelPages: number;
  headless: boolean;
  browserChannel: string;
  autoEnterOrderPage: boolean;
  userDataDir: string;
  logFile: string;
  screenshotDir: string;
  logCleanupEnabled: boolean;
  logCleanupIntervalMinutes: number;
  screenshotRetentionHours: number;
  maxScreenshotFiles: number;
  maxLogFileBytes: number;
  maxOpenClawEventBytes: number;
}

export interface OpenClawNotificationConfig {
  enabled: boolean;
  url: string;
  tokenEnv: string;
  mode: "now" | "next-heartbeat";
}

export interface NotificationConfig {
  openclaw: OpenClawNotificationConfig;
}

export interface MonitorConfig {
  defaults: MonitorDefaults;
  notifications: NotificationConfig;
  events: EventConfig[];
}

export interface NormalizedTarget {
  id: string;
  eventName: string;
  name: string;
  url: string;
  keywords: string[];
  quantity: number;
  priority: number;
  intervalSeconds: number;
}

export interface ButtonSnapshot {
  text: string;
  disabled: boolean;
  selected?: boolean;
  index?: number;
  actionable?: boolean;
  textLength?: number;
  area?: number;
}

export interface DetectionResult {
  state: TicketState;
  reason: string;
  matchedText?: string;
}

export interface MonitorRunOptions {
  configPath: string;
  dryRun: boolean;
  once: boolean;
  headless?: boolean;
}
