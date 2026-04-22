import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { NotificationPayload } from "./notifier.js";

export interface OpenClawBridgeEvent {
  id: number;
  time: string;
  title: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface OpenClawBridgeReadResult {
  events: OpenClawBridgeEvent[];
  latestId: number;
  nextSince: number;
}

export function openClawOutboxPathFromLogFile(logFile: string): string {
  return path.join(path.dirname(logFile), "openclaw-events.jsonl");
}

export async function appendOpenClawBridgeEvent(
  outboxFile: string,
  payload: NotificationPayload
): Promise<void> {
  await mkdir(path.dirname(outboxFile), { recursive: true });
  const event = {
    time: new Date().toISOString(),
    title: payload.title,
    message: payload.message,
    details: payload.details
  };
  await appendFile(outboxFile, `${JSON.stringify(event)}\n`, "utf8");
}

export async function readOpenClawBridgeEvents(
  outboxFile: string,
  since = 0,
  limit = 100
): Promise<OpenClawBridgeReadResult> {
  const raw = await readFile(outboxFile, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return "";
    }
    throw error;
  });
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const latestId = lines.length;
  const events = lines
    .map((line, index): OpenClawBridgeEvent | undefined => {
      try {
        const parsed = JSON.parse(line) as Omit<OpenClawBridgeEvent, "id">;
        return {
          id: index + 1,
          time: parsed.time,
          title: parsed.title,
          message: parsed.message,
          details: parsed.details
        };
      } catch {
        return undefined;
      }
    })
    .filter((event): event is OpenClawBridgeEvent => Boolean(event))
    .filter((event) => event.id > since)
    .slice(0, limit);

  return {
    events,
    latestId,
    nextSince: events.length > 0 ? events[events.length - 1].id : since
  };
}
