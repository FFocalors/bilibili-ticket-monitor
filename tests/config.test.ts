import assert from "node:assert/strict";
import test from "node:test";
import { flattenTargets, parseConfig } from "../src/config.js";

test("parseConfig validates and normalizes event targets", () => {
  const config = parseConfig(`
defaults:
  intervalSeconds: 5
events:
  - name: show-a
    url: https://show.bilibili.com/platform/detail.html?id=1
    targets:
      - name: vip
        keywords: ["2026-05-01", "VIP"]
        quantity: 2
        priority: 2
      - name: normal
        keywords: ["2026-05-02", "普通票"]
        priority: 1
`);

  assert.equal(config.defaults.intervalSeconds, 10);
  assert.equal(config.notifications.openclaw.enabled, false);
  assert.equal(config.notifications.openclaw.url, "http://127.0.0.1:18789/hooks/wake");
  const targets = flattenTargets(config);
  assert.equal(targets.length, 2);
  assert.equal(targets[0].name, "normal");
  assert.equal(targets[1].quantity, 2);
});

test("parseConfig normalizes OpenClaw notification settings", () => {
  const config = parseConfig(`
notifications:
  openclaw:
    enabled: true
    url: http://127.0.0.1:18789/hooks/wake
    tokenEnv: CUSTOM_OPENCLAW_TOKEN
    mode: next-heartbeat
events:
  - name: show-a
    url: https://show.bilibili.com/
    targets:
      - keywords: ["2026-05-08"]
`);

  assert.equal(config.notifications.openclaw.enabled, true);
  assert.equal(config.notifications.openclaw.url, "http://127.0.0.1:18789/hooks/wake");
  assert.equal(config.notifications.openclaw.tokenEnv, "CUSTOM_OPENCLAW_TOKEN");
  assert.equal(config.notifications.openclaw.mode, "next-heartbeat");
});

test("parseConfig rejects targets without identifying keywords", () => {
  assert.throws(
    () => parseConfig(`
events:
  - name: show-a
    url: https://show.bilibili.com/
    targets:
      - quantity: 1
`),
    /must include keywords/
  );
});
