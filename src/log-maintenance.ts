import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Logger } from "./logger.js";

export interface LogCleanupOptions {
  enabled: boolean;
  intervalMinutes: number;
  logFile: string;
  screenshotDir: string;
  openClawOutboxFile: string;
  screenshotRetentionHours: number;
  maxScreenshotFiles: number;
  maxLogFileBytes: number;
  maxOpenClawEventBytes: number;
}

interface CleanupStats {
  deletedScreenshotFiles: number;
  trimmedLogFiles: string[];
}

export function startPeriodicLogCleanup(options: LogCleanupOptions, logger: Logger): () => void {
  if (!options.enabled) {
    return () => undefined;
  }

  const runCleanup = async (reason: "startup" | "interval") => {
    try {
      const stats = await cleanupLogs(options);
      if (stats.deletedScreenshotFiles > 0 || stats.trimmedLogFiles.length > 0) {
        await logger.info("Log cleanup completed", {
          reason,
          deletedScreenshotFiles: stats.deletedScreenshotFiles,
          trimmedLogFiles: stats.trimmedLogFiles
        });
      }
    } catch (error) {
      await logger.warn("Log cleanup failed", {
        reason,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  };

  void runCleanup("startup");
  const timer = setInterval(() => {
    void runCleanup("interval");
  }, Math.max(1, options.intervalMinutes) * 60_000);
  timer.unref?.();

  return () => clearInterval(timer);
}

export async function cleanupLogs(options: Omit<LogCleanupOptions, "enabled" | "intervalMinutes">): Promise<CleanupStats> {
  const deletedScreenshotFiles = await cleanupScreenshots(options.screenshotDir, options.screenshotRetentionHours, options.maxScreenshotFiles);
  const logDir = path.dirname(options.logFile);
  const trimmedLogFiles = await cleanupRootLogFiles(logDir, options.maxLogFileBytes, options.maxOpenClawEventBytes, options.openClawOutboxFile);

  return {
    deletedScreenshotFiles,
    trimmedLogFiles
  };
}

async function cleanupScreenshots(screenshotDir: string, retentionHours: number, maxScreenshotFiles: number): Promise<number> {
  const files = await collectFilesRecursively(screenshotDir);
  if (files.length === 0) {
    return 0;
  }

  const now = Date.now();
  const retentionCutoff = now - retentionHours * 60 * 60 * 1000;
  const toDelete = new Set<string>();

  for (const file of files) {
    if (file.mtimeMs < retentionCutoff) {
      toDelete.add(file.path);
    }
  }

  const remaining = files
    .filter((file) => !toDelete.has(file.path))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  for (const overflow of remaining.slice(maxScreenshotFiles)) {
    toDelete.add(overflow.path);
  }

  for (const filePath of toDelete) {
    await rm(filePath, { force: true }).catch(() => undefined);
  }

  return toDelete.size;
}

async function cleanupRootLogFiles(
  logDir: string,
  maxLogFileBytes: number,
  maxOpenClawEventBytes: number,
  openClawOutboxFile: string
): Promise<string[]> {
  const entries = await readdir(logDir, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  });

  const trimmed: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const filePath = path.join(logDir, entry.name);
    if (filePath === openClawOutboxFile || entry.name.endsWith(".jsonl")) {
      if (await trimTextFile(filePath, maxOpenClawEventBytes)) {
        trimmed.push(entry.name);
      }
      continue;
    }

    if (entry.name.endsWith(".log")) {
      if (await trimTextFile(filePath, maxLogFileBytes)) {
        trimmed.push(entry.name);
      }
    }
  }

  return trimmed;
}

async function trimTextFile(filePath: string, maxBytes: number): Promise<boolean> {
  const info = await stat(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  });
  if (!info || info.size <= maxBytes) {
    return false;
  }

  const raw = await readFile(filePath, "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) {
    return false;
  }

  const kept: string[] = [];
  let totalBytes = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const lineWithNewline = `${line}\n`;
    const lineBytes = Buffer.byteLength(lineWithNewline, "utf8");
    if (totalBytes + lineBytes > maxBytes && kept.length > 0) {
      break;
    }
    kept.unshift(line);
    totalBytes += lineBytes;
    if (totalBytes >= maxBytes) {
      break;
    }
  }

  await writeFile(filePath, `${kept.join("\n")}\n`, "utf8");
  return true;
}

async function collectFilesRecursively(root: string): Promise<Array<{ path: string; mtimeMs: number }>> {
  const entries = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  });

  const files: Array<{ path: string; mtimeMs: number }> = [];
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFilesRecursively(entryPath));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const info = await stat(entryPath).catch(() => undefined);
    if (info) {
      files.push({ path: entryPath, mtimeMs: info.mtimeMs });
    }
  }

  return files;
}
