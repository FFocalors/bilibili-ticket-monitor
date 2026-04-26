import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { cleanupLogs } from "../src/log-maintenance.js";

test("cleanupLogs removes stale and overflow screenshots, and trims text logs", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bilibili-log-cleanup-"));
  const screenshotDir = path.join(dir, "screenshots");
  const nestedDir = path.join(screenshotDir, "nested");
  await mkdir(nestedDir, { recursive: true });

  const staleScreenshot = path.join(screenshotDir, "stale.png");
  const recentScreenshotA = path.join(screenshotDir, "recent-a.png");
  const recentScreenshotB = path.join(nestedDir, "recent-b.png");
  await writeFile(staleScreenshot, "old");
  await writeFile(recentScreenshotA, "recent-a");
  await writeFile(recentScreenshotB, "recent-b");

  const staleTime = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const recentTimeA = new Date(Date.now() - 10 * 60 * 1000);
  const recentTimeB = new Date(Date.now() - 5 * 60 * 1000);
  await utimes(staleScreenshot, staleTime, staleTime);
  await utimes(recentScreenshotA, recentTimeA, recentTimeA);
  await utimes(recentScreenshotB, recentTimeB, recentTimeB);

  const logFile = path.join(dir, "monitor.log");
  const openClawOutboxFile = path.join(dir, "openclaw-events.jsonl");
  await writeFile(logFile, Array.from({ length: 30 }, (_, index) => `log-${index}`).join("\n") + "\n", "utf8");
  await writeFile(openClawOutboxFile, Array.from({ length: 30 }, (_, index) => JSON.stringify({ id: index + 1 })).join("\n") + "\n", "utf8");

  const result = await cleanupLogs({
    logFile,
    screenshotDir,
    openClawOutboxFile,
    screenshotRetentionHours: 24,
    maxScreenshotFiles: 1,
    maxLogFileBytes: 60,
    maxOpenClawEventBytes: 80
  });

  assert.equal(result.deletedScreenshotFiles, 2);
  assert.ok(result.trimmedLogFiles.includes("monitor.log"));
  assert.ok(result.trimmedLogFiles.includes("openclaw-events.jsonl"));

  const remainingA = await stat(recentScreenshotA).then(() => true).catch(() => false);
  const remainingB = await stat(recentScreenshotB).then(() => true).catch(() => false);
  assert.equal(remainingA || remainingB, true);
  assert.equal(remainingA && remainingB, false);
  assert.equal(await stat(staleScreenshot).then(() => true).catch(() => false), false);

  const trimmedLog = await readFile(logFile, "utf8");
  const trimmedOutbox = await readFile(openClawOutboxFile, "utf8");
  assert.ok(Buffer.byteLength(trimmedLog, "utf8") <= 60);
  assert.ok(Buffer.byteLength(trimmedOutbox, "utf8") <= 80);
  assert.match(trimmedLog, /log-2\d/);
});
