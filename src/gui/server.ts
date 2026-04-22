import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { access, readFile, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { parseConfig } from "../config.js";
import { notifyUser } from "../notifier.js";
import {
  appendOpenClawBridgeEvent,
  openClawOutboxPathFromLogFile,
  readOpenClawBridgeEvents
} from "../openclaw-bridge.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = process.cwd();
const configPath = path.resolve(projectRoot, "config/events.yaml");
const exampleConfigPath = path.resolve(projectRoot, "config/events.example.yaml");
const publicDir = path.resolve(projectRoot, "src/gui/public");
const cliPath = path.resolve(__dirname, "../cli.js");
const port = Number(process.env.GUI_PORT ?? 4173);
const host = process.env.GUI_HOST ?? "127.0.0.1";
const bridgePort = Number(process.env.OPENCLAW_BRIDGE_PORT ?? 4174);
const bridgeHost = process.env.OPENCLAW_BRIDGE_HOST ?? "0.0.0.0";

interface ActiveProcess {
  mode: "monitor" | "dry-run";
  child: ChildProcessWithoutNullStreams;
  startedAt: string;
}

interface StatusPayload {
  running: boolean;
  mode?: "monitor" | "dry-run";
  pid?: number;
  startedAt?: string;
  exitCode?: number | null;
  recentLines: string[];
}

let activeProcess: ActiveProcess | undefined;
let lastExitCode: number | null | undefined;
const recentLines: string[] = [];
const clients = new Set<ServerResponse>();

const server = createServer(async (request, response) => {
  try {
    if (!request.url) {
      sendJson(response, 400, { error: "Missing URL" });
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname === "/api/config" && request.method === "GET") {
      await handleGetConfig(response);
      return;
    }
    if (url.pathname === "/api/config" && request.method === "POST") {
      await handleSaveConfig(request, response);
      return;
    }
    if (url.pathname === "/api/status" && request.method === "GET") {
      sendJson(response, 200, getStatus());
      return;
    }
    if (url.pathname === "/api/process/start" && request.method === "POST") {
      await handleStartProcess(request, response, "monitor");
      return;
    }
    if (url.pathname === "/api/process/dry-run" && request.method === "POST") {
      await handleStartProcess(request, response, "dry-run");
      return;
    }
    if (url.pathname === "/api/process/stop" && request.method === "POST") {
      handleStopProcess(response);
      return;
    }
    if (url.pathname === "/api/openclaw/test" && request.method === "POST") {
      await handleTestOpenClaw(request, response);
      return;
    }
    if (url.pathname === "/api/local-notification/test" && request.method === "POST") {
      handleTestLocalNotification(response);
      return;
    }
    if (url.pathname === "/api/stream" && request.method === "GET") {
      handleStream(response);
      return;
    }

    await serveStatic(url.pathname, response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(response, 500, { error: message });
  }
});

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    appendLine(`GUI port ${host}:${port} is already in use; OpenClaw bridge will continue if available`);
    console.warn(`GUI port ${host}:${port} is already in use; OpenClaw bridge will continue if available`);
    return;
  }
  appendLine(`GUI server failed: ${error.message}`);
  console.error(error);
});

server.listen(port, host, () => {
  const url = `http://${host === "0.0.0.0" ? "127.0.0.1" : host}:${port}`;
  appendLine(`GUI ready: ${url}`);
  console.log(`GUI ready: ${url}`);
});

const bridgeServer = createServer(async (request, response) => {
  try {
    if (!request.url) {
      sendJson(response, 400, { error: "Missing URL" });
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
    if ((url.pathname === "/health" || url.pathname === "/api/openclaw/health") && request.method === "GET") {
      await handleOpenClawBridgeHealth(response);
      return;
    }
    if ((url.pathname === "/events" || url.pathname === "/api/openclaw/events") && request.method === "GET") {
      await handleOpenClawBridgeEvents(url, response);
      return;
    }
    if (url.pathname === "/hooks/wake") {
      sendJson(response, 410, {
        error: "This Windows bridge is pull-only. OpenClaw should GET /events?since=0 instead of POST /hooks/wake.",
        health: "/health",
        events: "/events?since=0"
      });
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(response, 500, { error: message });
  }
});

bridgeServer.on("error", (error: NodeJS.ErrnoException) => {
  appendLine(`OpenClaw bridge failed: ${error.message}`);
  console.error(error);
});

bridgeServer.listen(bridgePort, bridgeHost, () => {
  const displayHost = bridgeHost === "0.0.0.0" ? "127.0.0.1" : bridgeHost;
  appendLine(`OpenClaw bridge ready: http://${displayHost}:${bridgePort}/events`);
  console.log(`OpenClaw bridge ready: http://${displayHost}:${bridgePort}/events`);
});

async function handleGetConfig(response: ServerResponse): Promise<void> {
  const sourcePath = existsSync(configPath) ? configPath : exampleConfigPath;
  const raw = await readFile(sourcePath, "utf8");
  const parsed = parseYaml(raw) ?? {};
  sendJson(response, 200, {
    path: configPath,
    exists: sourcePath === configPath,
    config: parsed
  });
}

async function handleSaveConfig(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJson(request);
  const config = body?.config;
  if (!config || typeof config !== "object") {
    sendJson(response, 400, { error: "Missing config object" });
    return;
  }

  const yaml = stringifyYaml(config, { lineWidth: 0 });
  parseConfig(yaml, projectRoot);
  await writeFile(configPath, yaml, "utf8");
  appendLine(`Config saved: ${configPath}`);
  sendJson(response, 200, { ok: true });
}

async function handleStartProcess(
  request: IncomingMessage,
  response: ServerResponse,
  mode: "monitor" | "dry-run"
): Promise<void> {
  if (activeProcess) {
    sendJson(response, 409, { error: `${activeProcess.mode} is already running` });
    return;
  }

  const body = await readJson(request).catch(() => ({}));
  const args = [cliPath, "--config", configPath];
  if (mode === "dry-run") {
    args.push("--dry-run");
  }
  if (body?.headless === true) {
    args.push("--headless");
  }
  if (body?.once === true) {
    args.push("--once");
  }

  lastExitCode = undefined;
  appendLine(`Starting ${mode}...`);
  const child = spawn(process.execPath, args, {
    cwd: projectRoot,
    env: process.env
  });

  activeProcess = {
    mode,
    child,
    startedAt: new Date().toISOString()
  };

  child.stdout.on("data", (chunk: Buffer) => appendChunk(chunk));
  child.stderr.on("data", (chunk: Buffer) => appendChunk(chunk));
  child.on("exit", (code, signal) => {
    lastExitCode = code;
    appendLine(`${mode} stopped: ${signal ? `signal ${signal}` : `exit ${code ?? "unknown"}`}`);
    activeProcess = undefined;
    broadcastStatus();
  });
  child.on("error", (error) => {
    appendLine(`${mode} failed: ${error.message}`);
    activeProcess = undefined;
    broadcastStatus();
  });

  broadcastStatus();
  sendJson(response, 200, getStatus());
}

function handleStopProcess(response: ServerResponse): void {
  if (!activeProcess) {
    sendJson(response, 200, getStatus());
    return;
  }

  appendLine(`Stopping ${activeProcess.mode}...`);
  activeProcess.child.kill("SIGINT");
  sendJson(response, 200, getStatus());
}

async function handleTestOpenClaw(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJson(request);
  const enabledInConfig = Boolean(body?.openclaw?.enabled);
  const outbox = await resolveOpenClawOutboxPath();

  try {
    await appendOpenClawBridgeEvent(outbox, {
      title: "Bilibili 会员购监控测试",
      message: "这是一条本地 OpenClaw 桥接测试事件。",
      details: {
        source: "gui-bridge-test",
        time: new Date().toISOString(),
        enabledInConfig
      }
    });
    const result = await readOpenClawBridgeEvents(outbox, 0, 1_000);
    appendLine(`OpenClaw bridge test event written: ${outbox}; latestId=${result.latestId}`);
    sendJson(response, 200, {
      ok: true,
      enabledInConfig,
      outbox,
      latestId: result.latestId,
      nextSince: result.nextSince
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    appendLine(`OpenClaw bridge test failed: ${message}`);
    sendJson(response, 400, { error: message });
  }
}

function handleTestLocalNotification(response: ServerResponse): void {
  notifyUser({
    title: "Bilibili 本地强提醒测试",
    message: "这是本地强提醒测试。真正有票时会弹出同样的全屏闪烁提醒。"
  });
  appendLine("Local notification test triggered");
  sendJson(response, 200, { ok: true });
}

async function handleOpenClawBridgeHealth(response: ServerResponse): Promise<void> {
  const outbox = await resolveOpenClawOutboxPath();
  sendJson(response, 200, {
    ok: true,
    service: "bilibili-ticket-monitor-openclaw-bridge",
    time: new Date().toISOString(),
    outbox
  });
}

async function handleOpenClawBridgeEvents(url: URL, response: ServerResponse): Promise<void> {
  const since = Number(url.searchParams.get("since") ?? 0);
  const limit = Number(url.searchParams.get("limit") ?? 100);
  const outbox = await resolveOpenClawOutboxPath();
  const result = await readOpenClawBridgeEvents(
    outbox,
    Number.isFinite(since) && since > 0 ? Math.floor(since) : 0,
    Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 200) : 100
  );
  sendJson(response, 200, {
    ok: true,
    ...result
  });
}

async function resolveOpenClawOutboxPath(): Promise<string> {
  const sourcePath = existsSync(configPath) ? configPath : exampleConfigPath;
  try {
    const raw = await readFile(sourcePath, "utf8");
    const config = parseConfig(raw, projectRoot);
    return openClawOutboxPathFromLogFile(config.defaults.logFile);
  } catch {
    return path.resolve(projectRoot, "logs/openclaw-events.jsonl");
  }
}

function handleStream(response: ServerResponse): void {
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });
  clients.add(response);
  response.write(`event: status\ndata: ${JSON.stringify(getStatus())}\n\n`);
  response.on("close", () => {
    clients.delete(response);
  });
}

async function serveStatic(urlPath: string, response: ServerResponse): Promise<void> {
  const requestPath = urlPath === "/" ? "/index.html" : decodeURIComponent(urlPath);
  const filePath = path.resolve(publicDir, `.${requestPath}`);
  if (!filePath.startsWith(publicDir)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }

  try {
    await access(filePath);
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      sendJson(response, 404, { error: "Not found" });
      return;
    }
  } catch {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  response.writeHead(200, {
    "Content-Type": contentType(filePath)
  });
  createReadStream(filePath).pipe(response);
}

function getStatus(): StatusPayload {
  return {
    running: Boolean(activeProcess),
    mode: activeProcess?.mode,
    pid: activeProcess?.child.pid,
    startedAt: activeProcess?.startedAt,
    exitCode: lastExitCode,
    recentLines
  };
}

function appendChunk(chunk: Buffer): void {
  chunk.toString("utf8")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .forEach(appendLine);
}

function appendLine(line: string): void {
  const stamped = `[${new Date().toLocaleTimeString()}] ${line}`;
  recentLines.push(stamped);
  while (recentLines.length > 300) {
    recentLines.shift();
  }
  broadcast("log", stamped);
  broadcastStatus();
}

function broadcastStatus(): void {
  broadcast("status", getStatus());
}

function broadcast(event: string, payload: unknown): void {
  const data = JSON.stringify(payload);
  for (const client of clients) {
    client.write(`event: ${event}\ndata: ${data}\n\n`);
  }
}

async function readJson(request: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    if (Buffer.concat(chunks).length > 1_000_000) {
      throw new Error("Request body too large");
    }
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? JSON.parse(raw) : {};
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(payload));
}

function contentType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".html") {
    return "text/html; charset=utf-8";
  }
  if (extension === ".css") {
    return "text/css; charset=utf-8";
  }
  if (extension === ".js") {
    return "text/javascript; charset=utf-8";
  }
  if (extension === ".svg") {
    return "image/svg+xml";
  }
  return "application/octet-stream";
}
