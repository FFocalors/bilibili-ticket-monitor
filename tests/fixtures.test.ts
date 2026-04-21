import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { detectAvailabilityFromText, extractButtonsFromHtml, extractTextFromHtml } from "../src/detector.js";

const fixtureDir = path.resolve("fixtures/pages");

test("fixture pages classify expected states", async () => {
  const cases = new Map([
    ["available.html", "available"],
    ["sold-out.html", "sold_out"],
    ["blocked-login.html", "blocked"],
    ["blocked-captcha.html", "blocked"],
    ["blocked-region.html", "blocked"],
    ["order-submit.html", "blocked"],
    ["unknown.html", "unknown"]
  ]);

  for (const [file, expected] of cases) {
    const html = await readFile(path.join(fixtureDir, file), "utf8");
    const result = detectAvailabilityFromText(extractTextFromHtml(html), extractButtonsFromHtml(html));
    assert.equal(result.state, expected, file);
  }
});
