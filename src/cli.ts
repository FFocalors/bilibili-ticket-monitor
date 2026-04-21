#!/usr/bin/env node
import path from "node:path";
import { loadConfig } from "./config.js";
import { runDryRun } from "./dry-run.js";
import { runMonitor } from "./monitor.js";
import type { MonitorRunOptions } from "./types.js";

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const config = await loadConfig(options.configPath);

  if (options.headless !== undefined) {
    config.defaults.headless = options.headless;
  }

  if (options.dryRun) {
    await runDryRun(config);
    return;
  }

  await runMonitor(config, {
    once: options.once,
    headless: options.headless
  });
}

export function parseArgs(args: string[]): MonitorRunOptions {
  const options: MonitorRunOptions = {
    configPath: path.resolve("config/events.yaml"),
    dryRun: false,
    once: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--once") {
      options.once = true;
      continue;
    }
    if (arg === "--headless") {
      options.headless = true;
      continue;
    }
    if (arg === "--headed") {
      options.headless = false;
      continue;
    }
    if (arg === "--config" || arg === "-c") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("--config requires a path.");
      }
      options.configPath = path.resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp(): void {
  console.log(`Usage:
  pnpm monitor
  pnpm monitor -- --config config/events.yaml
  pnpm monitor -- --dry-run
  pnpm monitor -- --once

Options:
  -c, --config <path>  Path to YAML config. Default: config/events.yaml
  --dry-run           Read local fixtures without opening real pages
  --once              Check every target once, then exit
  --headless          Run browser headless
  --headed            Force headed browser
`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
