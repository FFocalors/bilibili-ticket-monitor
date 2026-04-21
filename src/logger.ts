import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";

export interface Logger {
  info(message: string, fields?: Record<string, unknown>): Promise<void>;
  warn(message: string, fields?: Record<string, unknown>): Promise<void>;
  error(message: string, fields?: Record<string, unknown>): Promise<void>;
}

export function createLogger(logFile: string): Logger {
  return {
    info: (message, fields) => writeLog(logFile, "info", message, fields),
    warn: (message, fields) => writeLog(logFile, "warn", message, fields),
    error: (message, fields) => writeLog(logFile, "error", message, fields)
  };
}

async function writeLog(logFile: string, level: string, message: string, fields: Record<string, unknown> = {}): Promise<void> {
  await mkdir(path.dirname(logFile), { recursive: true });
  const entry = JSON.stringify({
    time: new Date().toISOString(),
    level,
    message,
    ...fields
  });
  await appendFile(logFile, `${entry}\n`, "utf8");
  const printable = fields && Object.keys(fields).length > 0 ? `${message} ${JSON.stringify(fields)}` : message;
  if (level === "error") {
    console.error(printable);
  } else if (level === "warn") {
    console.warn(printable);
  } else {
    console.log(printable);
  }
}
