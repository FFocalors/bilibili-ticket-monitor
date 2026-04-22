import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { notifyOpenClaw } from "../src/notifier.js";
import { appendOpenClawBridgeEvent, readOpenClawBridgeEvents } from "../src/openclaw-bridge.js";

test("notifyOpenClaw posts webhook payload with bearer token", async () => {
  const received = await new Promise<{ auth: string | undefined; body: any }>((resolve, reject) => {
    const server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
        server.close();
        resolve({
          auth: request.headers.authorization,
          body: JSON.parse(Buffer.concat(chunks).toString("utf8"))
        });
      });
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to bind mock server"));
        return;
      }

      process.env.OPENCLAW_TEST_TOKEN = "test-token";
      void notifyOpenClaw({
        enabled: true,
        url: `http://127.0.0.1:${address.port}/hooks/wake`,
        tokenEnv: "OPENCLAW_TEST_TOKEN",
        mode: "now"
      }, {
        title: "Bilibili ticket available",
        message: "example-event: Enabled purchase button detected."
      }).catch(reject);
    });
  });

  assert.equal(received.auth?.startsWith("Bearer "), true);
  assert.equal(received.auth?.slice("Bearer ".length), "test-token");
  assert.equal(received.body.mode, "now");
  assert.match(received.body.text, /Bilibili ticket available/);
  assert.match(received.body.text, /example-event/);
});

test("OpenClaw bridge outbox supports since-based polling", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "bilibili-openclaw-"));
  const outbox = path.join(dir, "openclaw-events.jsonl");

  await appendOpenClawBridgeEvent(outbox, {
    title: "Bilibili ticket available",
    message: "target entered order page",
    details: { target: "example" }
  });
  await appendOpenClawBridgeEvent(outbox, {
    title: "Bilibili monitor paused",
    message: "captcha detected"
  });

  const firstRead = await readOpenClawBridgeEvents(outbox, 0);
  assert.equal(firstRead.events.length, 2);
  assert.equal(firstRead.nextSince, 2);
  assert.equal(firstRead.events[0].id, 1);
  assert.equal(firstRead.events[0].details?.target, "example");

  const secondRead = await readOpenClawBridgeEvents(outbox, firstRead.nextSince);
  assert.equal(secondRead.events.length, 0);
  assert.equal(secondRead.latestId, 2);
});
