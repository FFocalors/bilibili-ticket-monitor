import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContext, type Locator, type Page } from "playwright";
import { AVAILABLE_BUTTON_PATTERNS, FORBIDDEN_ORDER_ACTION_PATTERNS, detectAvailabilityFromText } from "./detector.js";
import { createLogger, type Logger } from "./logger.js";
import { notifyOpenClaw, notifyUser, type NotificationPayload } from "./notifier.js";
import type { DetectionResult, MonitorConfig, NormalizedTarget } from "./types.js";
import { flattenTargets } from "./config.js";

interface TargetRuntime {
  target: NormalizedTarget;
  nextAt: number;
  failures: number;
  halted: boolean;
  page?: Page;
}

interface RunMonitorOptions {
  once?: boolean;
  headless?: boolean;
}

export async function runMonitor(config: MonitorConfig, options: RunMonitorOptions = {}): Promise<void> {
  const logger = createLogger(config.defaults.logFile);
  const targets = flattenTargets(config);
  if (targets.length === 0) {
    throw new Error("No targets found in config.");
  }

  await mkdir(config.defaults.screenshotDir, { recursive: true });
  await logger.info("Starting monitor", {
    targets: targets.length,
    browserChannel: config.defaults.browserChannel,
    userDataDir: config.defaults.userDataDir
  });

  const context = await chromium.launchPersistentContext(config.defaults.userDataDir, {
    channel: config.defaults.browserChannel === "chromium" ? undefined : config.defaults.browserChannel,
    headless: options.headless ?? config.defaults.headless,
    viewport: { width: 1366, height: 900 }
  });

  const shutdown = createShutdown(context, logger);
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  try {
    const runtimes = targets.map<TargetRuntime>((target, index) => ({
      target,
      nextAt: Date.now() + index * 750,
      failures: 0,
      halted: false
    }));

    while (runtimes.some((runtime) => !runtime.halted)) {
      const due = selectDueTargets(runtimes, config.defaults.maxParallelPages);
      if (due.length === 0) {
        await sleep(nextDelay(runtimes));
        continue;
      }

      await Promise.all(due.map((runtime) => inspectTarget(context, runtime, config, logger)));
      if (options.once) {
        break;
      }
    }
  } finally {
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
    await context.close();
    await logger.info("Monitor stopped");
  }
}

async function inspectTarget(
  context: BrowserContext,
  runtime: TargetRuntime,
  config: MonitorConfig,
  logger: Logger
): Promise<void> {
  const { target } = runtime;

  try {
    const page = await getTargetPage(context, runtime);
    await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => undefined);

    const result = await detectPageState(page, target);
    await logger.info("Checked target", {
      target: target.id,
      eventName: target.eventName,
      state: result.state,
      reason: result.reason,
      matchedText: result.matchedText
    });

    if (result.state === "available") {
      runtime.halted = true;
      await page.bringToFront();
      const hovered = await hoverManualHandoffButton(page, result, "available");
      const screenshot = await saveScreenshot(page, config.defaults.screenshotDir, target, "available");
      await sendNotifications(config, logger, {
        title: "Bilibili ticket available",
        message: `${target.eventName} / ${target.name}: ${result.reason}`,
        details: {
          target: target.id,
          url: target.url,
          matchedText: result.matchedText,
          screenshot
        }
      });
      await logger.warn("Target available; manual handoff required", {
        target: target.id,
        hovered,
        screenshot
      });
      return;
    }

    if (result.state === "blocked") {
      runtime.halted = true;
      await page.bringToFront();
      const hovered = await hoverManualHandoffButton(page, result, "order");
      const screenshot = await saveScreenshot(page, config.defaults.screenshotDir, target, "blocked");
      await sendNotifications(config, logger, {
        title: "Bilibili monitor paused",
        message: `${target.eventName} / ${target.name}: ${result.reason}`,
        details: {
          target: target.id,
          url: target.url,
          matchedText: result.matchedText,
          screenshot
        }
      });
      await logger.warn("Target blocked; monitor paused for manual handling", {
        target: target.id,
        hovered,
        screenshot
      });
      return;
    }

    if (result.state === "unknown") {
      await saveUnknownSnapshot(page, config.defaults.screenshotDir, target);
    }

    runtime.failures = 0;
    runtime.nextAt = Date.now() + jitteredDelayMs(target.intervalSeconds, config.defaults.jitterRatio);
  } catch (error) {
    runtime.failures += 1;
    const message = error instanceof Error ? error.message : String(error);
    const backoffMs = Math.min(5 * 60_000, runtime.failures * 30_000);
    runtime.nextAt = Date.now() + jitteredDelayMs(target.intervalSeconds, config.defaults.jitterRatio) + backoffMs;
    await logger.error("Target check failed", {
      target: target.id,
      failures: runtime.failures,
      retryInMs: runtime.nextAt - Date.now(),
      error: message
    });
  }
}

async function sendNotifications(config: MonitorConfig, logger: Logger, payload: NotificationPayload): Promise<void> {
  notifyUser(payload);

  try {
    const sent = await notifyOpenClaw(config.notifications.openclaw, payload);
    if (sent) {
      await logger.info("OpenClaw notification sent", {
        url: config.notifications.openclaw.url
      });
    }
  } catch (error) {
    await logger.warn("OpenClaw notification failed", {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

async function detectPageState(page: Page, target: NormalizedTarget): Promise<DetectionResult> {
  const visibleText = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
  const buttons = await page.locator("button, a, [role='button']").evaluateAll((elements) =>
    elements
      .map((element) => {
        const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
        const disabled =
          element.hasAttribute("disabled") ||
          element.getAttribute("aria-disabled") === "true" ||
          element.className.toString().toLowerCase().includes("disabled");
        return { text, disabled };
      })
      .filter((button) => button.text.length > 0)
  );

  return detectAvailabilityFromText(visibleText, buttons, target);
}

async function hoverManualHandoffButton(
  page: Page,
  result: DetectionResult,
  kind: "available" | "order"
): Promise<boolean> {
  const patterns = kind === "available" ? AVAILABLE_BUTTON_PATTERNS : FORBIDDEN_ORDER_ACTION_PATTERNS;
  const button = await findActionButton(page, result.matchedText, patterns);
  if (!button) {
    return false;
  }

  try {
    await button.scrollIntoViewIfNeeded({ timeout: 3000 });
    await button.hover({ timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

async function findActionButton(
  page: Page,
  matchedText: string | undefined,
  patterns: RegExp[]
): Promise<Locator | undefined> {
  const selector = "button, a, [role='button']";
  if (matchedText) {
    const byMatchedText = page.locator(selector).filter({ hasText: matchedText }).first();
    if (await isVisibleActionButton(byMatchedText)) {
      return byMatchedText;
    }
  }

  for (const pattern of patterns) {
    const byPattern = page.locator(selector).filter({ hasText: pattern }).first();
    if (await isVisibleActionButton(byPattern)) {
      return byPattern;
    }
  }

  return undefined;
}

async function isVisibleActionButton(locator: Locator): Promise<boolean> {
  const count = await locator.count().catch(() => 0);
  if (count === 0) {
    return false;
  }

  return locator.evaluate((element) => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const disabled =
      element.hasAttribute("disabled") ||
      element.getAttribute("aria-disabled") === "true" ||
      element.className.toString().toLowerCase().includes("disabled");

    return !disabled && style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
  }).catch(() => false);
}

async function getTargetPage(context: BrowserContext, runtime: TargetRuntime): Promise<Page> {
  if (runtime.page && !runtime.page.isClosed()) {
    return runtime.page;
  }
  runtime.page = await context.newPage();
  return runtime.page;
}

function selectDueTargets(runtimes: TargetRuntime[], maxParallelPages: number): TargetRuntime[] {
  const now = Date.now();
  return runtimes
    .filter((runtime) => !runtime.halted && runtime.nextAt <= now)
    .sort((a, b) => a.target.priority - b.target.priority || a.nextAt - b.nextAt)
    .slice(0, maxParallelPages);
}

function nextDelay(runtimes: TargetRuntime[]): number {
  const active = runtimes.filter((runtime) => !runtime.halted);
  if (active.length === 0) {
    return 0;
  }
  const nextAt = Math.min(...active.map((runtime) => runtime.nextAt));
  return Math.max(250, nextAt - Date.now());
}

function jitteredDelayMs(intervalSeconds: number, jitterRatio: number): number {
  const base = intervalSeconds * 1000;
  const range = base * jitterRatio;
  const jitter = Math.random() * range * 2 - range;
  return Math.max(10_000, Math.round(base + jitter));
}

async function saveScreenshot(page: Page, screenshotDir: string, target: NormalizedTarget, state: string): Promise<string> {
  await mkdir(screenshotDir, { recursive: true });
  const filename = `${Date.now()}-${state}-${safeFilePart(target.id)}.png`;
  const filePath = path.join(screenshotDir, filename);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function saveUnknownSnapshot(page: Page, screenshotDir: string, target: NormalizedTarget): Promise<void> {
  const screenshot = await saveScreenshot(page, screenshotDir, target, "unknown");
  const domPath = screenshot.replace(/\.png$/i, ".txt");
  const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
  await writeFile(domPath, bodyText.slice(0, 20_000), "utf8");
}

function createShutdown(context: BrowserContext, logger: Logger): () => void {
  let shuttingDown = false;
  return () => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    void logger.warn("Shutdown requested").finally(() => {
      void context.close().finally(() => process.exit(0));
    });
  };
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-z0-9\u4e00-\u9fa5_-]+/gi, "-").slice(0, 80);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
