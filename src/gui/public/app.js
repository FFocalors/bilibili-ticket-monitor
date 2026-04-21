const state = {
  config: null,
  status: { running: false, recentLines: [] }
};

const elements = {
  configPath: document.querySelector("#configPath"),
  statusPill: document.querySelector("#statusPill"),
  events: document.querySelector("#events"),
  intervalInput: document.querySelector("#intervalInput"),
  jitterInput: document.querySelector("#jitterInput"),
  parallelInput: document.querySelector("#parallelInput"),
  browserInput: document.querySelector("#browserInput"),
  headlessInput: document.querySelector("#headlessInput"),
  openClawEnabledInput: document.querySelector("#openClawEnabledInput"),
  openClawUrlInput: document.querySelector("#openClawUrlInput"),
  openClawTokenEnvInput: document.querySelector("#openClawTokenEnvInput"),
  addEventBtn: document.querySelector("#addEventBtn"),
  saveBtn: document.querySelector("#saveBtn"),
  dryRunBtn: document.querySelector("#dryRunBtn"),
  startBtn: document.querySelector("#startBtn"),
  stopBtn: document.querySelector("#stopBtn"),
  clearLogBtn: document.querySelector("#clearLogBtn"),
  logOutput: document.querySelector("#logOutput"),
  eventTemplate: document.querySelector("#eventTemplate"),
  targetTemplate: document.querySelector("#targetTemplate")
};

await loadConfig();
await refreshStatus();
connectStream();

elements.addEventBtn.addEventListener("click", () => addEvent());
elements.saveBtn.addEventListener("click", () => runAction(saveConfig));
elements.dryRunBtn.addEventListener("click", () => runAction(() => runProcess("dry-run")));
elements.startBtn.addEventListener("click", () => runAction(() => runProcess("start")));
elements.stopBtn.addEventListener("click", () => runAction(stopProcess));
elements.clearLogBtn.addEventListener("click", () => {
  elements.logOutput.textContent = "";
});

async function loadConfig() {
  const response = await fetchJson("/api/config");
  state.config = normalizeConfig(response.config);
  elements.configPath.textContent = response.exists
    ? response.path
    : `${response.path}（未生成，当前显示示例配置）`;
  renderConfig();
}

async function runAction(action) {
  try {
    await action();
  } catch (error) {
    appendLog(`错误：${error instanceof Error ? error.message : String(error)}`);
  }
}

function renderConfig() {
  const defaults = state.config.defaults;
  elements.intervalInput.value = defaults.intervalSeconds ?? 30;
  elements.jitterInput.value = defaults.jitterRatio ?? 0.25;
  elements.parallelInput.value = defaults.maxParallelPages ?? 1;
  elements.browserInput.value = defaults.browserChannel ?? "msedge";
  elements.headlessInput.checked = Boolean(defaults.headless);
  elements.openClawEnabledInput.checked = Boolean(state.config.notifications.openclaw.enabled);
  elements.openClawUrlInput.value = state.config.notifications.openclaw.url ?? "http://127.0.0.1:18789/hooks/wake";
  elements.openClawTokenEnvInput.value = state.config.notifications.openclaw.tokenEnv ?? "OPENCLAW_HOOKS_TOKEN";
  elements.events.replaceChildren();
  state.config.events.forEach((event) => renderEvent(event));
}

function renderEvent(event) {
  const fragment = elements.eventTemplate.content.cloneNode(true);
  const panel = fragment.querySelector(".event-panel");
  panel.querySelector(".event-name").value = event.name ?? "";
  panel.querySelector(".event-url").value = event.url ?? "";
  panel.querySelector(".event-interval").value = event.intervalSeconds ?? "";
  const targetList = panel.querySelector(".target-list");
  event.targets.forEach((target) => renderTarget(targetList, target));

  panel.querySelector(".remove-event").addEventListener("click", () => panel.remove());
  panel.querySelector(".add-target").addEventListener("click", () => {
    renderTarget(targetList, createTarget());
  });

  elements.events.append(panel);
}

function renderTarget(targetList, target) {
  const fragment = elements.targetTemplate.content.cloneNode(true);
  const row = fragment.querySelector(".target-row");
  row.querySelector(".target-name").value = target.name ?? "";
  row.querySelector(".target-keywords").value = (target.keywords ?? []).join("\n");
  row.querySelector(".target-quantity").value = target.quantity ?? 1;
  row.querySelector(".target-priority").value = target.priority ?? 1;
  row.querySelector(".remove-target").addEventListener("click", () => row.remove());
  targetList.append(row);
}

function addEvent() {
  renderEvent({
    name: "新活动",
    url: "",
    intervalSeconds: numberValue(elements.intervalInput.value, 30),
    targets: [createTarget()]
  });
}

function createTarget() {
  return {
    name: "目标票档",
    keywords: [],
    quantity: 1,
    priority: 1
  };
}

async function saveConfig() {
  const config = readConfigFromForm();
  await fetchJson("/api/config", {
    method: "POST",
    body: JSON.stringify({ config })
  });
  state.config = config;
  appendLog("配置已保存");
}

async function runProcess(mode) {
  await saveConfig();
  const endpoint = mode === "dry-run" ? "/api/process/dry-run" : "/api/process/start";
  const payload = {
    headless: elements.headlessInput.checked
  };
  const status = await fetchJson(endpoint, {
    method: "POST",
    body: JSON.stringify(payload)
  });
  applyStatus(status);
}

async function stopProcess() {
  const status = await fetchJson("/api/process/stop", { method: "POST" });
  applyStatus(status);
}

function readConfigFromForm() {
  const defaults = {
    intervalSeconds: numberValue(elements.intervalInput.value, 30),
    jitterRatio: numberValue(elements.jitterInput.value, 0.25),
    maxParallelPages: numberValue(elements.parallelInput.value, 1),
    headless: elements.headlessInput.checked,
    browserChannel: elements.browserInput.value || "msedge",
    userDataDir: state.config.defaults.userDataDir ?? ".browser-profile",
    logFile: state.config.defaults.logFile ?? "logs/monitor.log",
    screenshotDir: state.config.defaults.screenshotDir ?? "logs/screenshots"
  };

  const events = [...elements.events.querySelectorAll(".event-panel")].map((panel) => ({
    name: textValue(panel.querySelector(".event-name").value, "未命名活动"),
    url: textValue(panel.querySelector(".event-url").value, ""),
    intervalSeconds: optionalNumber(panel.querySelector(".event-interval").value),
    targets: [...panel.querySelectorAll(".target-row")].map((row) => ({
      name: textValue(row.querySelector(".target-name").value, "目标票档"),
      keywords: row.querySelector(".target-keywords").value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
      quantity: numberValue(row.querySelector(".target-quantity").value, 1),
      priority: numberValue(row.querySelector(".target-priority").value, 1)
    }))
  }));

  const notifications = {
    openclaw: {
      enabled: elements.openClawEnabledInput.checked,
      url: textValue(elements.openClawUrlInput.value, "http://127.0.0.1:18789/hooks/wake"),
      tokenEnv: textValue(elements.openClawTokenEnvInput.value, "OPENCLAW_HOOKS_TOKEN"),
      mode: "now"
    }
  };

  return { defaults, notifications, events };
}

async function refreshStatus() {
  const status = await fetchJson("/api/status");
  applyStatus(status);
}

function connectStream() {
  const source = new EventSource("/api/stream");
  source.addEventListener("status", (event) => {
    applyStatus(JSON.parse(event.data));
  });
  source.addEventListener("log", (event) => {
    appendLog(JSON.parse(event.data));
  });
}

function applyStatus(status) {
  state.status = status;
  elements.statusPill.textContent = status.running
    ? `${status.mode === "dry-run" ? "Dry run" : "监控中"}`
    : "未运行";
  elements.statusPill.classList.toggle("running", status.running);
  elements.startBtn.disabled = status.running;
  elements.dryRunBtn.disabled = status.running;
  elements.stopBtn.disabled = !status.running;

  if (Array.isArray(status.recentLines) && elements.logOutput.textContent.trim() === "") {
    elements.logOutput.textContent = status.recentLines.join("\n");
    scrollLog();
  }
}

function appendLog(line) {
  elements.logOutput.textContent += `${elements.logOutput.textContent ? "\n" : ""}${line}`;
  scrollLog();
}

function scrollLog() {
  elements.logOutput.scrollTop = elements.logOutput.scrollHeight;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? `HTTP ${response.status}`);
  }
  return payload;
}

function normalizeConfig(config) {
  return {
    defaults: {
      intervalSeconds: 30,
      jitterRatio: 0.25,
      maxParallelPages: 1,
      headless: false,
      browserChannel: "msedge",
      userDataDir: ".browser-profile",
      logFile: "logs/monitor.log",
      screenshotDir: "logs/screenshots",
      ...(config.defaults ?? {})
    },
    notifications: {
      openclaw: {
        enabled: false,
        url: "http://127.0.0.1:18789/hooks/wake",
        tokenEnv: "OPENCLAW_HOOKS_TOKEN",
        mode: "now",
        ...(config.notifications?.openclaw ?? {})
      }
    },
    events: Array.isArray(config.events) && config.events.length > 0
      ? config.events.map((event) => ({
          ...event,
          targets: Array.isArray(event.targets) && event.targets.length > 0 ? event.targets : [createTarget()]
        }))
      : [{
          name: "新活动",
          url: "",
          targets: [createTarget()]
        }]
  };
}

function textValue(value, fallback) {
  const trimmed = value.trim();
  return trimmed || fallback;
}

function numberValue(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function optionalNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
