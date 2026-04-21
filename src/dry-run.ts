import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { detectAvailabilityFromText, extractButtonsFromHtml, extractTextFromHtml } from "./detector.js";
import type { MonitorConfig } from "./types.js";

export async function runDryRun(config: MonitorConfig, fixtureDir = path.resolve("fixtures/pages")): Promise<void> {
  const files = (await readdir(fixtureDir)).filter((file) => file.endsWith(".html")).sort();
  if (files.length === 0) {
    throw new Error(`No HTML fixtures found in ${fixtureDir}`);
  }

  console.log(`Dry run: reading ${files.length} local fixture(s). No real page will be opened.`);
  for (const file of files) {
    const html = await readFile(path.join(fixtureDir, file), "utf8");
    const text = extractTextFromHtml(html);
    const buttons = extractButtonsFromHtml(html);
    const result = detectAvailabilityFromText(text, buttons);
    console.log(`${file}: ${result.state} - ${result.reason}${result.matchedText ? ` (${result.matchedText})` : ""}`);
  }

  console.log(`Loaded ${config.events.length} configured event(s).`);
}
