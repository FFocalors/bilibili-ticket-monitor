import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContext, type Locator, type Page } from "playwright";
import { AVAILABLE_BUTTON_PATTERNS, FORBIDDEN_ORDER_ACTION_PATTERNS, detectAvailabilityFromText } from "./detector.js";
import { startPeriodicLogCleanup } from "./log-maintenance.js";
import { createLogger, type Logger } from "./logger.js";
import { notifyUser, type NotificationPayload } from "./notifier.js";
import { appendOpenClawBridgeEvent, openClawOutboxPathFromLogFile } from "./openclaw-bridge.js";
import type { DetectionResult, MonitorConfig, NormalizedTarget } from "./types.js";
import { flattenTargets } from "./config.js";

interface TargetRuntime {
  target: NormalizedTarget;
  nextAt: number;
  failures: number;
  halted: boolean;
  availableAlerted: boolean;
  page?: Page;
}

interface RunMonitorOptions {
  once?: boolean;
  headless?: boolean;
}

export async function runMonitor(config: MonitorConfig, options: RunMonitorOptions = {}): Promise<void> {
  const logger = createLogger(config.defaults.logFile);
  const targets = flattenTargets(config);
  const effectiveHeadless = options.headless ?? config.defaults.headless;
  if (targets.length === 0) {
    throw new Error("No targets found in config.");
  }

  await mkdir(config.defaults.screenshotDir, { recursive: true });
  const stopLogCleanup = startPeriodicLogCleanup({
    enabled: config.defaults.logCleanupEnabled,
    intervalMinutes: config.defaults.logCleanupIntervalMinutes,
    logFile: config.defaults.logFile,
    screenshotDir: config.defaults.screenshotDir,
    openClawOutboxFile: openClawOutboxPathFromLogFile(config.defaults.logFile),
    screenshotRetentionHours: config.defaults.screenshotRetentionHours,
    maxScreenshotFiles: config.defaults.maxScreenshotFiles,
    maxLogFileBytes: config.defaults.maxLogFileBytes,
    maxOpenClawEventBytes: config.defaults.maxOpenClawEventBytes
  }, logger);
  await logger.info("Starting monitor", {
    targets: targets.length,
    browserChannel: config.defaults.browserChannel,
    autoEnterOrderPage: config.defaults.autoEnterOrderPage,
    userDataDir: config.defaults.userDataDir,
    logCleanupEnabled: config.defaults.logCleanupEnabled,
    logCleanupIntervalMinutes: config.defaults.logCleanupIntervalMinutes
  });

  const context = await chromium.launchPersistentContext(config.defaults.userDataDir, {
    channel: config.defaults.browserChannel === "chromium" ? undefined : config.defaults.browserChannel,
    headless: effectiveHeadless,
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
      halted: false,
      availableAlerted: false
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

    if (!options.once && !effectiveHeadless && runtimes.some((runtime) => runtime.halted)) {
      await logger.warn("Manual handoff active; browser will stay open until you stop the monitor");
      await waitForever();
    }
  } finally {
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
    stopLogCleanup();
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
    if (!isManualHandoffUrl(page.url())) {
      await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => undefined);
    }

    const result = await detectPageState(page, target);
    await logger.info("Checked target", {
      target: target.id,
      eventName: target.eventName,
      state: result.state,
      reason: result.reason,
      matchedText: result.matchedText
    });

    if (result.state === "available") {
      await page.bringToFront();
      if (!runtime.availableAlerted) {
        runtime.availableAlerted = true;
        await logger.warn("Target availability detected; attempting order handoff", {
          target: target.id,
          matchedText: result.matchedText
        });
        await sendNotifications(config, logger, {
          title: "检测到有票",
          message: `${target.eventName} / ${target.name}: 已检测到目标有票，正在尝试进入订单页。`,
          details: {
            target: target.id,
            url: target.url,
            matchedText: result.matchedText,
            stage: "detected"
          }
        });
      }

      const handoff = await prepareAvailableHandoff(page, target, result, config.defaults.autoEnterOrderPage);

      if (handoff.enteredOrderPage || !config.defaults.autoEnterOrderPage) {
        runtime.halted = true;
        const handoffPage = handoff.handoffPage ?? page;
        const screenshot = await saveScreenshot(handoffPage, config.defaults.screenshotDir, target, handoff.enteredOrderPage ? "order-entry" : "available");
        const { handoffPage: _handoffPage, ...handoffLog } = handoff;
        await logger.warn("Target available; manual handoff required", {
          target: target.id,
          ...handoffLog,
          screenshot
        });
        return;
      }

      runtime.failures = 0;
      runtime.nextAt = Date.now() + 5_000;
      await logger.warn("Purchase entry click did not reach order page; retry scheduled", {
        target: target.id,
        retryInMs: runtime.nextAt - Date.now(),
        ...formatHandoffForLog(handoff)
      });
      return;
    }

    runtime.availableAlerted = false;

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
      await saveUnknownSnapshot(page, config.defaults.screenshotDir, target, logger);
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

function isManualHandoffUrl(url: string): boolean {
  return /\/confirmOrder\.html/i.test(url);
}

async function sendNotifications(config: MonitorConfig, logger: Logger, payload: NotificationPayload): Promise<void> {
  notifyUser(payload);

  try {
    await appendOpenClawBridgeEvent(openClawOutboxPathFromLogFile(config.defaults.logFile), payload);
    await logger.info("OpenClaw bridge event written", {
      outbox: openClawOutboxPathFromLogFile(config.defaults.logFile)
    });
  } catch (error) {
    await logger.warn("OpenClaw bridge event write failed", {
      error: error instanceof Error ? error.message : String(error)
    });
  }

  await logger.info("OpenClaw bridge mode active; WSL should poll /events");
}

async function prepareAvailableHandoff(
  page: Page,
  target: NormalizedTarget,
  result: DetectionResult,
  autoEnterOrderPage: boolean
): Promise<{
  clickedEntry: boolean;
  enteredOrderPage: boolean;
  hovered: boolean;
  message: string;
  postClickState?: string;
  postClickReason?: string;
  handoffPage?: Page;
}> {
  if (!autoEnterOrderPage) {
    return {
      clickedEntry: false,
      enteredOrderPage: false,
      hovered: await hoverManualHandoffButton(page, result, "available"),
      message: result.reason
    };
  }

  const entryButton = await findActionButton(page, undefined, AVAILABLE_BUTTON_PATTERNS);
  if (!entryButton) {
    return {
      clickedEntry: false,
      enteredOrderPage: false,
      hovered: await hoverManualHandoffButton(page, result, "available"),
      message: `${result.reason}; entry button not found.`
    };
  }

  try {
    const popupPromise = page.waitForEvent("popup", { timeout: 4000 }).catch(() => undefined);
    await entryButton.scrollIntoViewIfNeeded({ timeout: 3000 });
    await clickActionAtCenter(page, entryButton);
    const popup = await popupPromise;
    const handoffPage = popup ?? page;
    await handoffPage.bringToFront().catch(() => undefined);
    await handoffPage.waitForURL(/\/confirmOrder\.html/i, { timeout: 5000 }).catch(() => undefined);
    await handoffPage.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => undefined);
    await handoffPage.waitForTimeout(300);

    const postClickResult = await detectPageState(handoffPage, target);
    const enteredOrderPage = isManualHandoffUrl(handoffPage.url()) || isOrderHandoffResult(postClickResult);
    const hoveredOrder = enteredOrderPage ? await hoverManualHandoffButton(handoffPage, postClickResult, "order") : false;
    if (popup && !enteredOrderPage) {
      await popup.close().catch(() => undefined);
    }
    return {
      clickedEntry: true,
      enteredOrderPage,
      hovered: hoveredOrder,
      message: enteredOrderPage && hoveredOrder
        ? "Entered order information page; payment handoff button is ready."
        : enteredOrderPage
          ? "Entered order information page; please continue manually."
          : "Clicked purchase entry, but order information page was not reached.",
      postClickState: postClickResult.state,
      postClickReason: postClickResult.reason,
      handoffPage: enteredOrderPage ? handoffPage : undefined
    };
  } catch (error) {
    return {
      clickedEntry: false,
      enteredOrderPage: false,
      hovered: await hoverManualHandoffButton(page, result, "available"),
      message: `Failed to click ticket entry button: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

async function clickActionAtCenter(page: Page, locator: Locator): Promise<void> {
  const box = await locator.boundingBox({ timeout: 3000 }).catch(() => null);
  if (box && box.width > 0 && box.height > 0) {
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.click(x, y);
    return;
  }

  await locator.hover({ timeout: 3000 });
  await locator.click({ timeout: 5000 });
}

async function detectPageState(page: Page, target: NormalizedTarget): Promise<DetectionResult> {
  const visibleText = await page.locator("body").innerText({ timeout: 10000 }).catch(() => "");
  const buttons = await page.locator(detectionElementSelector()).evaluateAll((elements) =>
    elements
      .map((element) => {
        const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const className = element.className.toString().toLowerCase();
        const disabled =
          element.hasAttribute("disabled") ||
          element.getAttribute("aria-disabled") === "true" ||
          className.includes("disabled") ||
          className.includes("disable") ||
          className.includes("sold") ||
          /已售罄|售罄|不可售|暂未开售|即将开售/.test(text);
        const selected =
          element.getAttribute("aria-selected") === "true" ||
          className.includes("active") ||
          className.includes("selected") ||
          className.includes("checked") ||
          className.includes("current") ||
          className.includes("choose") ||
          className.includes("picked");
        const visible =
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          text.length <= 180 &&
          rect.width > 8 &&
          rect.height > 8 &&
          rect.width < 900 &&
          rect.height < 220;
        const relevantText =
          /\d{4}[./-]\d{1,2}[./-]\d{1,2}/.test(text) ||
          /[¥￥]\s*\d+/.test(text) ||
          /立即购|购买|购票|支付|订单|售罄|不可售|开售/.test(text);
        return visible && relevantText ? { text, disabled, selected } : undefined;
      })
      .filter((button): button is { text: string; disabled: boolean; selected: boolean } => Boolean(button && button.text.length > 0))
  );

  return detectAvailabilityFromText(visibleText, buttons, target);
}

async function hoverManualHandoffButton(
  page: Page,
  result: DetectionResult,
  kind: "available" | "order"
): Promise<boolean> {
  const patterns = kind === "available" ? AVAILABLE_BUTTON_PATTERNS : FORBIDDEN_ORDER_ACTION_PATTERNS;
  const button = await findActionButton(page, kind === "order" ? result.matchedText : undefined, patterns);
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

function formatHandoffForLog(handoff: Awaited<ReturnType<typeof prepareAvailableHandoff>>): Omit<Awaited<ReturnType<typeof prepareAvailableHandoff>>, "handoffPage"> {
  const { handoffPage: _handoffPage, ...handoffLog } = handoff;
  return handoffLog;
}

async function findActionButton(
  page: Page,
  matchedText: string | undefined,
  patterns: RegExp[]
): Promise<Locator | undefined> {
  const selector = actionElementSelector();
  if (matchedText) {
    const byVisibleText = await findBestTextLocator(page, matchedText);
    if (byVisibleText) {
      return byVisibleText;
    }

    const byMatchedText = await findBestActionLocator(page, selector, matchedText);
    if (byMatchedText) {
      return byMatchedText;
    }
  }

  for (const pattern of patterns) {
    const byVisibleText = await findBestTextLocator(page, pattern);
    if (byVisibleText) {
      return byVisibleText;
    }

    const byPattern = await findBestActionLocator(page, selector, pattern);
    if (byPattern) {
      return byPattern;
    }
  }

  return undefined;
}

async function findBestActionLocator(page: Page, selector: string, text: string | RegExp): Promise<Locator | undefined> {
  const candidates = page.locator(selector).filter({ hasText: text });
  return findSmallestVisibleLocator(candidates);
}

async function findBestTextLocator(page: Page, text: string | RegExp): Promise<Locator | undefined> {
  if (typeof text === "string") {
    const exact = await findSmallestVisibleLocator(page.getByText(text, { exact: true }));
    if (exact) {
      return exact;
    }
  }

  return findSmallestVisibleLocator(page.getByText(text));
}

async function findSmallestVisibleLocator(candidates: Locator): Promise<Locator | undefined> {
  const count = await candidates.count().catch(() => 0);
  let best: Locator | undefined;
  let bestArea = Number.POSITIVE_INFINITY;

  for (let index = 0; index < Math.min(count, 30); index += 1) {
    const candidate = candidates.nth(index);
    const box = await candidate.boundingBox({ timeout: 1000 }).catch(() => null);
    if (!box || box.width <= 0 || box.height <= 0 || !(await isVisibleActionButton(candidate))) {
      continue;
    }

    const area = box.width * box.height;
    if (area < bestArea) {
      best = candidate;
      bestArea = area;
    }
  }

  return best;
}

async function isVisibleActionButton(locator: Locator): Promise<boolean> {
  const count = await locator.count().catch(() => 0);
  if (count === 0) {
    return false;
  }

  return locator.evaluate((element) => {
    const tagName = element.tagName.toLowerCase();
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const disabled =
      element.hasAttribute("disabled") ||
      element.getAttribute("aria-disabled") === "true" ||
      element.className.toString().toLowerCase().includes("disabled");
    const isPageContainer = tagName === "html" || tagName === "body";

    return (
      !disabled &&
      !isPageContainer &&
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      rect.width > 8 &&
      rect.height > 8 &&
      rect.width < 1000 &&
      rect.height < 300
    );
  }).catch(() => false);
}

function actionElementSelector(): string {
  return [
    "button",
    "a",
    "[role='button']",
    "[onclick]",
    "[class*='btn' i]",
    "[class*='button' i]",
    "[class*='buy' i]",
    "[class*='pay' i]"
  ].join(", ");
}

function detectionElementSelector(): string {
  return "body *";
}

function isOrderHandoffResult(result: DetectionResult): boolean {
  return (
    result.state === "blocked" &&
    Boolean(result.matchedText && FORBIDDEN_ORDER_ACTION_PATTERNS.some((pattern) => pattern.test(result.matchedText ?? "")))
  );
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

async function saveUnknownSnapshot(page: Page, screenshotDir: string, target: NormalizedTarget, logger: Logger): Promise<void> {
  try {
    const screenshot = await saveScreenshot(page, screenshotDir, target, "unknown");
    const domPath = screenshot.replace(/\.png$/i, ".txt");
    const bodyText = await page.locator("body").innerText({ timeout: 5000 }).catch(() => "");
    await writeFile(domPath, bodyText.slice(0, 20_000), "utf8");
  } catch (error) {
    await logger.warn("Unknown snapshot save failed", {
      target: target.id,
      error: error instanceof Error ? error.message : String(error)
    });
  }
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

function waitForever(): Promise<never> {
  return new Promise(() => undefined);
}
