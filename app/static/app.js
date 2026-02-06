const providerSelect = document.getElementById("provider");
const modelSelect = document.getElementById("model");
const form = document.getElementById("generate-form");
const taskList = document.getElementById("task-list");
const refreshButton = document.getElementById("refresh-button");
const formHint = document.getElementById("form-hint");
const submitButton = document.getElementById("submit-button");
const ADVANCED_OPTION_IDS = [
  "base_url",
  "public_base_url",
  "api_path",
  "model_override",
  "api_key",
  "workflow",
  "prompt_node_id",
  "prompt_input_key",
  "timeout_sec",
  "poll_interval_sec",
  "extra_body",
];
const STORAGE_PREFIX = "video_gateway_opt_";

let catalog = [];
let taskPollTimer = null;

async function init() {
  hydrateToken();
  hydrateAdvancedOptions();
  await loadCatalog();
  bindEvents();
  await refreshTasks();
  taskPollTimer = setInterval(refreshTasks, 4000);
}

function bindEvents() {
  providerSelect.addEventListener("change", () => {
    populateModels(providerSelect.value);
  });
  refreshButton.addEventListener("click", refreshTasks);
  form.addEventListener("submit", onSubmit);
  for (const id of ADVANCED_OPTION_IDS) {
    const element = document.getElementById(id);
    if (!element) continue;
    element.addEventListener("input", persistAdvancedOptions);
    element.addEventListener("change", persistAdvancedOptions);
  }
}

async function loadCatalog() {
  const response = await fetch("/v1/models", { headers: getGatewayHeaders() });
  if (!response.ok) {
    throw new Error(`加载模型失败: HTTP ${response.status}`);
  }
  const data = await response.json();
  catalog = data.providers || [];
  providerSelect.innerHTML = "";
  for (const provider of catalog) {
    const option = document.createElement("option");
    option.value = provider.id;
    option.textContent = `${provider.display_name} (${provider.type})`;
    providerSelect.appendChild(option);
  }
  if (catalog.length > 0) {
    providerSelect.value = catalog[0].id;
    populateModels(catalog[0].id);
  }
}

function populateModels(providerId) {
  const provider = catalog.find((item) => item.id === providerId);
  modelSelect.innerHTML = "";
  if (!provider) {
    return;
  }
  for (const model of provider.models) {
    const option = document.createElement("option");
    option.value = model.name;
    option.textContent = model.display_name;
    modelSelect.appendChild(option);
    if (model.is_default) {
      modelSelect.value = model.name;
    }
  }
}

function buildProviderOptions() {
  const baseUrl = document.getElementById("base_url").value.trim();
  const publicBaseUrl = document.getElementById("public_base_url").value.trim();
  const apiPath = document.getElementById("api_path").value.trim();
  const modelOverride = document.getElementById("model_override").value.trim();
  const workflowRaw = document.getElementById("workflow").value.trim();
  const promptNodeId = document.getElementById("prompt_node_id").value.trim();
  const promptInputKey = document.getElementById("prompt_input_key").value.trim();
  const timeoutRaw = document.getElementById("timeout_sec").value.trim();
  const pollIntervalRaw = document.getElementById("poll_interval_sec").value.trim();
  const apiKey = document.getElementById("api_key").value.trim();
  const extraBody = document.getElementById("extra_body").value.trim();

  const providerOptions = {};
  if (baseUrl) providerOptions.base_url = baseUrl;
  if (publicBaseUrl) providerOptions.public_base_url = publicBaseUrl;
  if (apiPath) providerOptions.api_path = apiPath;
  if (modelOverride) providerOptions.model = modelOverride;
  if (promptNodeId) providerOptions.prompt_node_id = promptNodeId;
  if (promptInputKey) providerOptions.prompt_input_key = promptInputKey;
  if (timeoutRaw) providerOptions.timeout_sec = parsePositiveInteger(timeoutRaw, "Timeout");
  if (pollIntervalRaw) {
    providerOptions.poll_interval_sec = parsePositiveNumber(pollIntervalRaw, "Poll Interval");
  }
  if (apiKey) providerOptions.api_key = apiKey;

  if (workflowRaw) {
    try {
      providerOptions.workflow = JSON.parse(workflowRaw);
    } catch {
      throw new Error("Workflow JSON 不是合法 JSON");
    }
  }

  if (extraBody) {
    try {
      providerOptions.extra_body = JSON.parse(extraBody);
    } catch {
      throw new Error("Extra Body 不是合法 JSON");
    }
  }
  return providerOptions;
}

async function onSubmit(event) {
  event.preventDefault();
  formHint.textContent = "";
  submitButton.disabled = true;
  submitButton.textContent = "提交中...";
  try {
    const providerOptions = buildProviderOptions();
    persistToken();
    persistAdvancedOptions();
    const payload = {
      provider: providerSelect.value,
      model: modelSelect.value,
      prompt: document.getElementById("prompt").value.trim(),
      duration_sec: Number(document.getElementById("duration_sec").value),
      fps: Number(document.getElementById("fps").value),
      resolution: document.getElementById("resolution").value,
      provider_options: providerOptions,
    };
    const response = await fetch("/v1/video/generations", {
      method: "POST",
      headers: { ...getGatewayHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail));
    }
    formHint.textContent = `任务已创建: ${data.task_id}`;
    const selectedProvider = providerSelect.value;
    const selectedModel = modelSelect.value;
    const currentToken = document.getElementById("gateway_token").value;
    form.reset();
    document.getElementById("gateway_token").value = currentToken;
    hydrateAdvancedOptions();
    providerSelect.value = selectedProvider;
    populateModels(selectedProvider);
    modelSelect.value = selectedModel;
    await refreshTasks();
  } catch (error) {
    formHint.textContent = `提交失败: ${error.message}`;
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "提交生成";
  }
}

async function refreshTasks() {
  if (hasActivePlayback()) {
    return;
  }
  const playingTaskIds = collectPlayingTaskIds();
  const response = await fetch("/v1/video/tasks?limit=30", { headers: getGatewayHeaders() });
  if (!response.ok) {
    formHint.textContent = `拉取任务失败: HTTP ${response.status}`;
    return;
  }
  const tasks = await response.json();
  const existingItems = new Map();
  for (const child of taskList.children) {
    if (!(child instanceof HTMLElement)) continue;
    const taskId = child.dataset.taskId;
    if (taskId) existingItems.set(taskId, child);
  }

  const nextItems = [];
  for (const task of tasks) {
    const existingItem = existingItems.get(task.task_id);
    if (shouldKeepPlayingItem(existingItem, task, playingTaskIds)) {
      nextItems.push(existingItem);
      continue;
    }

    const item = existingItem || document.createElement("li");
    renderTaskItem(item, task);
    nextItems.push(item);
  }
  taskList.replaceChildren(...nextItems);
}

function renderResult(task) {
  if (task.status === "failed") {
    const message = task.error?.message || "unknown error";
    return `<span class="status-failed">${escapeHtml(message)}</span>`;
  }
  if (task.status !== "succeeded") {
    return `<span class="status-running">处理中...</span>`;
  }
  const videoUrl = task.result?.video_url;
  if (!videoUrl) {
    return `<span class="status-succeeded">任务完成（无可播放URL，查看raw_response）</span>`;
  }
  return `
    <a href="${videoUrl}" target="_blank" rel="noreferrer">打开视频链接</a>
    <video controls src="${videoUrl}"></video>
  `;
}

function escapeHtml(value) {
  if (!value) return "";
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatTime(value) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function getGatewayHeaders() {
  const token = document.getElementById("gateway_token").value.trim();
  if (!token) {
    return {};
  }
  return { Authorization: `Bearer ${token}` };
}

function persistToken() {
  const token = document.getElementById("gateway_token").value.trim();
  if (token) {
    localStorage.setItem("video_gateway_token", token);
    return;
  }
  localStorage.removeItem("video_gateway_token");
}

function hydrateToken() {
  const token = localStorage.getItem("video_gateway_token");
  if (token) {
    document.getElementById("gateway_token").value = token;
  }
}

function renderTaskItem(item, task) {
  item.className = "task-item";
  item.dataset.taskId = task.task_id;
  const statusClass = `status-${task.status}`;
  const statusText = `<span class="${statusClass}">${task.status}</span>`;
  const meta = `${task.provider} / ${task.model} / ${formatTime(task.updated_at)}`;
  item.innerHTML = `
    <div class="task-head">
      <span>${task.task_id.slice(0, 8)}</span>
      <span>${statusText}</span>
    </div>
    <div class="task-meta">${meta}</div>
    <div class="task-prompt">${escapeHtml(task.prompt)}</div>
    <div class="task-result">${renderResult(task)}</div>
  `;
}

function collectPlayingTaskIds() {
  const ids = new Set();
  const videos = taskList.querySelectorAll("li[data-task-id] video");
  for (const video of videos) {
    if (isVideoPlaying(video)) {
      const item = video.closest("li[data-task-id]");
      const taskId = item?.dataset?.taskId;
      if (taskId) ids.add(taskId);
    }
  }
  return ids;
}

function shouldKeepPlayingItem(existingItem, task, playingTaskIds) {
  if (!existingItem) return false;
  if (task.status !== "succeeded") return false;
  if (!playingTaskIds.has(task.task_id)) return false;
  const existingVideo = existingItem.querySelector("video");
  if (!existingVideo) return false;
  const currentUrl = existingVideo.getAttribute("src") || "";
  const nextUrl = task.result?.video_url || "";
  return currentUrl && currentUrl === nextUrl;
}

function isVideoPlaying(video) {
  return !video.paused && !video.ended;
}

function hasActivePlayback() {
  const videos = taskList.querySelectorAll("video");
  for (const video of videos) {
    if (isVideoPlaying(video)) {
      return true;
    }
  }
  return false;
}

function parsePositiveNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} 必须是正数`);
  }
  return parsed;
}

function parsePositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} 必须是正整数`);
  }
  return parsed;
}

function persistAdvancedOptions() {
  for (const id of ADVANCED_OPTION_IDS) {
    const element = document.getElementById(id);
    if (!element) continue;
    const value = element.value;
    if (value && value.trim()) {
      localStorage.setItem(`${STORAGE_PREFIX}${id}`, value);
      continue;
    }
    localStorage.removeItem(`${STORAGE_PREFIX}${id}`);
  }
}

function hydrateAdvancedOptions() {
  for (const id of ADVANCED_OPTION_IDS) {
    const element = document.getElementById(id);
    if (!element) continue;
    const value = localStorage.getItem(`${STORAGE_PREFIX}${id}`);
    if (value !== null) {
      element.value = value;
    }
  }
}

init().catch((error) => {
  formHint.textContent = `初始化失败: ${error.message}`;
});
