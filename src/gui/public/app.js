const state = {
  config: null,
  status: { running: false, recentLines: [] },
  alert: {
    active: false,
    audioContext: null,
    timers: [],
    originalTitle: document.title,
    lastLogAlertAt: 0
  }
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
  autoEnterInput: document.querySelector("#autoEnterInput"),
  localNotificationTestBtn: document.querySelector("#localNotificationTestBtn"),
  openClawTestBtn: document.querySelector("#openClawTestBtn"),
  addEventBtn: document.querySelector("#addEventBtn"),
  saveBtn: document.querySelector("#saveBtn"),
  dryRunBtn: document.querySelector("#dryRunBtn"),
  startBtn: document.querySelector("#startBtn"),
  stopBtn: document.querySelector("#stopBtn"),
  clearLogBtn: document.querySelector("#clearLogBtn"),
  logOutput: document.querySelector("#logOutput"),
  localAlertOverlay: document.querySelector("#localAlertOverlay"),
  localAlertTitle: document.querySelector("#localAlertTitle"),
  localAlertMessage: document.querySelector("#localAlertMessage"),
  closeLocalAlertBtn: document.querySelector("#closeLocalAlertBtn"),
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
elements.localNotificationTestBtn.addEventListener("click", () => runAction(testLocalNotification));
elements.openClawTestBtn.addEventListener("click", () => runAction(testOpenClaw));
elements.closeLocalAlertBtn.addEventListener("click", stopLocalAlert);
elements.clearLogBtn.addEventListener("click", () => {
  elements.logOutput.textContent = "";
});
window.addEventListener("keydown", (event) => {
  if (state.alert.active && (event.key === "Escape" || event.key === " ")) {
    stopLocalAlert();
  }
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
  elements.autoEnterInput.checked = defaults.autoEnterOrderPage !== false;
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

async function testOpenClaw() {
  elements.openClawTestBtn.disabled = true;
  appendLog("正在写入 OpenClaw 桥接测试事件...");
  try {
    const result = await fetchJson("/api/openclaw/test", { method: "POST" });
    appendLog(`OpenClaw 桥接测试事件已写入：${result.outbox}`);
    appendLog(`OpenClaw 最新事件 ID：${result.latestId}`);
  } finally {
    elements.openClawTestBtn.disabled = false;
  }
}

async function testLocalNotification() {
  elements.localNotificationTestBtn.disabled = true;
  appendLog("正在触发本地强提醒测试...");
  triggerLocalAlert(
    "本地强提醒测试",
    "如果看到这个全屏闪烁页面并听到声音，说明浏览器侧本地提醒正常。\n真正有票时会自动出现同样提醒。"
  );
  try {
    await fetchJson("/api/local-notification/test", { method: "POST" });
    appendLog("本地原生提醒测试已请求");
  } finally {
    elements.localNotificationTestBtn.disabled = false;
  }
}

function readConfigFromForm() {
  const defaults = {
    intervalSeconds: numberValue(elements.intervalInput.value, 30),
    jitterRatio: numberValue(elements.jitterInput.value, 0.25),
    maxParallelPages: numberValue(elements.parallelInput.value, 1),
    headless: elements.headlessInput.checked,
    browserChannel: elements.browserInput.value || "msedge",
    autoEnterOrderPage: elements.autoEnterInput.checked,
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
      enabled: false,
      url: state.config.notifications.openclaw.url ?? "http://127.0.0.1:18789/hooks/wake",
      tokenEnv: state.config.notifications.openclaw.tokenEnv ?? "OPENCLAW_HOOKS_TOKEN",
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
    const line = JSON.parse(event.data);
    appendLog(line);
    handleAlertLog(line);
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

function handleAlertLog(line) {
  if (typeof line !== "string") {
    return;
  }
  const availabilityDetected = line.includes("Target availability detected; attempting order handoff");
  const handoffReady = line.includes("Target available; manual handoff required");
  if (!availabilityDetected && !handoffReady && !line.includes("Target blocked; monitor paused")) {
    return;
  }

  const now = Date.now();
  if (now - state.alert.lastLogAlertAt < 10_000) {
    return;
  }
  state.alert.lastLogAlertAt = now;

  if (availabilityDetected) {
    triggerLocalAlert(
      "检测到有票",
      "已检测到目标有票，脚本正在尝试进入订单页。\n请立即查看 Edge。"
    );
    return;
  }

  if (handoffReady) {
    triggerLocalAlert(
      "检测到有票",
      "脚本已经检测到目标状态并完成浏览器交接。\n请立即查看 Edge 订单页。"
    );
    return;
  }

  triggerLocalAlert(
    "监控已暂停",
    "检测到登录、验证码、风控或页面阻断。\n请立即查看浏览器并手动处理。"
  );
}

function triggerLocalAlert(title, message) {
  if (state.alert.active) {
    stopLocalAlert();
  }
  state.alert.active = true;
  elements.localAlertTitle.textContent = title;
  elements.localAlertMessage.textContent = message;
  elements.localAlertOverlay.hidden = false;
  elements.closeLocalAlertBtn.focus();
  startTitleFlash(title);
  startAudioAlarm();
  showBrowserNotification(title, message);
}

function stopLocalAlert() {
  state.alert.active = false;
  elements.localAlertOverlay.hidden = true;
  document.title = state.alert.originalTitle;
  for (const timer of state.alert.timers) {
    clearInterval(timer);
    clearTimeout(timer);
  }
  state.alert.timers = [];
}

function startTitleFlash(title) {
  let visible = false;
  const timer = setInterval(() => {
    if (!state.alert.active) {
      return;
    }
    visible = !visible;
    document.title = visible ? `!!! ${title} !!!` : state.alert.originalTitle;
  }, 650);
  state.alert.timers.push(timer);
}

function startAudioAlarm() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) {
      return;
    }
    state.alert.audioContext = state.alert.audioContext || new AudioContext();
    void state.alert.audioContext.resume();
    const beep = () => {
      if (!state.alert.active) {
        return;
      }
      const oscillator = state.alert.audioContext.createOscillator();
      const gain = state.alert.audioContext.createGain();
      oscillator.type = "square";
      oscillator.frequency.value = 1200;
      gain.gain.value = 0.22;
      oscillator.connect(gain);
      gain.connect(state.alert.audioContext.destination);
      oscillator.start();
      oscillator.stop(state.alert.audioContext.currentTime + 0.22);
    };
    beep();
    const timer = setInterval(beep, 650);
    state.alert.timers.push(timer);
  } catch {
    appendLog("浏览器音频提醒启动失败");
  }
}

async function showBrowserNotification(title, message) {
  if (!("Notification" in window)) {
    return;
  }
  try {
    let permission = Notification.permission;
    if (permission === "default") {
      permission = await Notification.requestPermission();
    }
    if (permission === "granted") {
      new Notification(title, {
        body: message,
        requireInteraction: true
      });
    }
  } catch {
    appendLog("浏览器系统通知启动失败");
  }
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
      autoEnterOrderPage: true,
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
