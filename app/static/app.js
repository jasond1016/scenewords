const providerSelect = document.getElementById("provider");
const modelSelect = document.getElementById("model");
const form = document.getElementById("generate-form");
const taskList = document.getElementById("task-list");
const refreshButton = document.getElementById("refresh-button");
const formHint = document.getElementById("form-hint");
const submitButton = document.getElementById("submit-button");
const mainPlayer = document.getElementById("main-player");
const playLatestButton = document.getElementById("play-latest-button");
const playerSwitchButton = document.getElementById("player-switch-button");
const playerOpenLink = document.getElementById("player-open-link");
const playerMeta = document.getElementById("player-meta");
const playerHint = document.getElementById("player-hint");
const veoShortcuts = document.getElementById("veo-shortcuts");
const veoLandscapeButton = document.getElementById("veo-landscape-button");
const veoPortraitButton = document.getElementById("veo-portrait-button");
const veoShortcutMeta = document.getElementById("veo-shortcut-meta");

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
const VEO_ASPECT_STORAGE_KEY = "video_gateway_veo_aspect_ratio";
const POLL_INTERVAL_MS = 4000;

const state = {
  catalog: [],
  tasks: [],
  tasksById: new Map(),
  player: {
    taskId: null,
    videoUrl: null,
    pendingUrl: null,
    pendingTaskId: null,
  },
  veoAspectRatio: "16:9",
};

let taskPollTimer = null;

async function init() {
  hydrateToken();
  hydrateAdvancedOptions();
  hydrateVeoAspectRatio();
  await loadCatalog();
  bindEvents();
  await refreshTasks();
  taskPollTimer = setInterval(refreshTasks, POLL_INTERVAL_MS);
}

function bindEvents() {
  providerSelect.addEventListener("change", onProviderChanged);
  refreshButton.addEventListener("click", refreshTasks);
  form.addEventListener("submit", onSubmit);
  taskList.addEventListener("click", onTaskListClick);
  playLatestButton.addEventListener("click", onPlayLatest);
  playerSwitchButton.addEventListener("click", onSwitchPlayerVersion);
  if (veoLandscapeButton) {
    veoLandscapeButton.addEventListener("click", onVeoLandscapeClick);
  }
  if (veoPortraitButton) {
    veoPortraitButton.addEventListener("click", onVeoPortraitClick);
  }

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
  state.catalog = data.providers || [];
  providerSelect.innerHTML = "";
  for (const provider of state.catalog) {
    const option = document.createElement("option");
    option.value = provider.id;
    option.textContent = `${provider.display_name} (${provider.type})`;
    providerSelect.appendChild(option);
  }
  if (state.catalog.length > 0) {
    providerSelect.value = state.catalog[0].id;
    populateModels(state.catalog[0].id);
    applyProviderFormDefaults(getSelectedProvider(), { force: true });
  }
}

function populateModels(providerId) {
  const provider = state.catalog.find((item) => item.id === providerId);
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
    applyProviderPayloadDefaults(payload, getSelectedProvider());
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
    applyProviderFormDefaults(getSelectedProvider(), { force: true });
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
  const response = await fetch("/v1/video/tasks?limit=30", { headers: getGatewayHeaders() });
  if (!response.ok) {
    formHint.textContent = `拉取任务失败: HTTP ${response.status}`;
    return;
  }
  state.tasks = await response.json();
  state.tasksById = new Map(state.tasks.map((task) => [task.task_id, task]));
  syncPlayerWithTaskUpdates();
  renderTaskList();
  renderPlayerPanel();
}

function renderTaskList() {
  taskList.innerHTML = "";
  for (const task of state.tasks) {
    const item = document.createElement("li");
    item.className = `task-item${task.task_id === state.player.taskId ? " is-active" : ""}`;
    item.dataset.taskId = task.task_id;
    const statusClass = `status-${task.status}`;
    const statusText = `<span class="${statusClass}">${task.status}</span>`;
    const meta = `${task.provider} / ${task.model} / ${formatTime(task.updated_at)}`;
    const actions = renderTaskActions(task);
    item.innerHTML = `
      <div class="task-head">
        <span>${task.task_id.slice(0, 8)}</span>
        <span>${statusText}</span>
      </div>
      <div class="task-meta">${meta}</div>
      <div class="task-prompt">${escapeHtml(task.prompt)}</div>
      <div class="task-result">${actions}</div>
    `;
    taskList.appendChild(item);
  }
}

function renderTaskActions(task) {
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
  const selectedLabel = task.task_id === state.player.taskId ? "当前播放任务" : "";
  return `
    <div class="task-actions">
      <button class="task-play-button" type="button" data-action="play-task" data-task-id="${task.task_id}">
        ${task.task_id === state.player.taskId ? "重新播放" : "在播放器中播放"}
      </button>
      <a class="task-open-link" href="${videoUrl}" target="_blank" rel="noreferrer noopener">直接打开</a>
      ${selectedLabel ? `<span class="status-succeeded">${selectedLabel}</span>` : ""}
    </div>
  `;
}

function onTaskListClick(event) {
  const actionTarget = event.target.closest("[data-action]");
  if (!actionTarget) return;

  const action = actionTarget.dataset.action;
  const taskId = actionTarget.dataset.taskId;
  if (!taskId) return;
  const task = state.tasksById.get(taskId);
  if (!task) return;

  if (action === "play-task") {
    playTaskInPlayer(task, { autoplay: true });
  }
}

function onPlayLatest() {
  const latest = state.tasks.find(
    (task) => task.status === "succeeded" && typeof task.result?.video_url === "string"
  );
  if (!latest) {
    playerHint.textContent = "暂无可播放的已完成任务";
    return;
  }
  playTaskInPlayer(latest, { autoplay: true });
}

function onSwitchPlayerVersion() {
  if (!state.player.pendingTaskId || !state.player.pendingUrl) {
    return;
  }
  const task = state.tasksById.get(state.player.pendingTaskId);
  if (!task) {
    return;
  }
  playTaskInPlayer(task, { autoplay: false, forceUrl: state.player.pendingUrl });
}

function playTaskInPlayer(task, options = {}) {
  const autoplay = Boolean(options.autoplay);
  const forcedUrl = typeof options.forceUrl === "string" ? options.forceUrl : null;
  const videoUrl = forcedUrl || task?.result?.video_url;
  if (!videoUrl) {
    playerHint.textContent = "该任务没有可播放视频链接";
    return;
  }

  state.player.taskId = task.task_id;
  state.player.pendingTaskId = null;
  state.player.pendingUrl = null;

  if (state.player.videoUrl !== videoUrl) {
    state.player.videoUrl = videoUrl;
    mainPlayer.src = videoUrl;
    mainPlayer.load();
  }

  if (autoplay) {
    const playPromise = mainPlayer.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {
        playerHint.textContent = "浏览器限制自动播放，请手动点击播放";
      });
    }
  }
  renderTaskList();
  renderPlayerPanel();
}

function syncPlayerWithTaskUpdates() {
  if (!state.player.taskId) {
    return;
  }
  const task = state.tasksById.get(state.player.taskId);
  if (!task) {
    state.player.pendingTaskId = null;
    state.player.pendingUrl = null;
    return;
  }
  const latestUrl = task.result?.video_url;
  if (typeof latestUrl === "string" && latestUrl && latestUrl !== state.player.videoUrl) {
    state.player.pendingTaskId = task.task_id;
    state.player.pendingUrl = latestUrl;
    return;
  }
  state.player.pendingTaskId = null;
  state.player.pendingUrl = null;
}

function renderPlayerPanel() {
  const selectedTask = state.player.taskId ? state.tasksById.get(state.player.taskId) : null;
  const hasVideo = Boolean(state.player.videoUrl);

  if (hasVideo) {
    playerOpenLink.href = state.player.videoUrl;
    playerOpenLink.classList.remove("is-disabled");
    playerOpenLink.removeAttribute("aria-disabled");
  } else {
    playerOpenLink.href = "#";
    playerOpenLink.classList.add("is-disabled");
    playerOpenLink.setAttribute("aria-disabled", "true");
  }

  if (selectedTask) {
    playerMeta.textContent =
      `${selectedTask.provider} / ${selectedTask.model} / ${selectedTask.task_id.slice(0, 8)} / ` +
      `${selectedTask.status} / ${formatTime(selectedTask.updated_at)}`;
  } else if (hasVideo) {
    playerMeta.textContent = "已加载外部视频链接";
  } else {
    playerMeta.textContent = "请选择任务开始播放";
  }

  if (state.player.pendingTaskId && state.player.pendingUrl) {
    playerSwitchButton.hidden = false;
    playerHint.textContent = "当前任务有新结果，点击“切换到新结果”可更新播放器";
  } else {
    playerSwitchButton.hidden = true;
    playerHint.textContent = hasVideo ? "" : "未选择视频";
  }
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

function onProviderChanged() {
  populateModels(providerSelect.value);
  applyProviderFormDefaults(getSelectedProvider(), { force: true });
}

function getSelectedProvider() {
  return state.catalog.find((item) => item.id === providerSelect.value) || null;
}

function isComfyProvider(provider) {
  return provider?.type === "comfyui";
}

function isVeoProvider(provider) {
  return provider?.type === "gemini_veo_compatible" || provider?.type === "vertex_veo";
}

function isGeminiVeoProvider(provider) {
  return provider?.type === "gemini_veo_compatible";
}

function applyProviderFormDefaults(provider, options = {}) {
  const force = Boolean(options.force);
  const durationInput = document.getElementById("duration_sec");
  const fpsInput = document.getElementById("fps");
  const resolutionSelect = document.getElementById("resolution");

  if (isVeoProvider(provider)) {
    veoShortcuts.hidden = false;
    if (force) {
      durationInput.value = "4";
      fpsInput.value = "24";
      resolutionSelect.value = preferredResolutionForAspectRatio(state.veoAspectRatio);
    }
    renderVeoShortcutMeta();
    return;
  }

  veoShortcuts.hidden = true;
  if (isComfyProvider(provider) && force) {
    durationInput.value = "4";
    fpsInput.value = "24";
    resolutionSelect.value = "854x480";
  }
}

function renderVeoShortcutMeta() {
  const resolution = document.getElementById("resolution").value;
  veoShortcutMeta.textContent = `当前画幅：${state.veoAspectRatio}，当前分辨率：${resolution}`;
}

function onVeoLandscapeClick() {
  setVeoAspectRatio("16:9");
}

function onVeoPortraitClick() {
  setVeoAspectRatio("9:16");
}

function setVeoAspectRatio(aspectRatio) {
  state.veoAspectRatio = aspectRatio;
  localStorage.setItem(VEO_ASPECT_STORAGE_KEY, aspectRatio);
  if (isVeoProvider(getSelectedProvider())) {
    document.getElementById("resolution").value = preferredResolutionForAspectRatio(aspectRatio);
  }
  renderVeoShortcutMeta();
}

function preferredResolutionForAspectRatio(aspectRatio) {
  if (aspectRatio === "9:16") {
    return "720x1280";
  }
  return "1280x720";
}

function hydrateVeoAspectRatio() {
  const value = localStorage.getItem(VEO_ASPECT_STORAGE_KEY);
  if (value === "16:9" || value === "9:16") {
    state.veoAspectRatio = value;
  }
}

function applyProviderPayloadDefaults(payload, provider) {
  if (!isGeminiVeoProvider(provider)) {
    return;
  }

  const providerOptions = payload.provider_options || {};
  const existingExtraBody = isPlainObject(providerOptions.extra_body)
    ? { ...providerOptions.extra_body }
    : {};
  const parameters = isPlainObject(existingExtraBody.parameters)
    ? { ...existingExtraBody.parameters }
    : {};

  if (parameters.durationSeconds == null) {
    parameters.durationSeconds = payload.duration_sec;
  }
  if (!isNonEmptyString(parameters.aspectRatio)) {
    parameters.aspectRatio = inferAspectRatio(payload.resolution) || state.veoAspectRatio;
  }
  if (!isNonEmptyString(parameters.resolution)) {
    parameters.resolution = veoResolutionPreset(payload.resolution);
  }

  existingExtraBody.parameters = parameters;
  providerOptions.extra_body = existingExtraBody;
  payload.provider_options = providerOptions;
}

function inferAspectRatio(resolution) {
  if (typeof resolution !== "string") {
    return null;
  }
  const normalized = resolution.trim().toLowerCase();
  if (!normalized.includes("x")) {
    return null;
  }
  const [widthText, heightText] = normalized.split("x");
  const width = Number(widthText);
  const height = Number(heightText);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  if (width > height) return "16:9";
  if (height > width) return "9:16";
  return "1:1";
}

function veoResolutionPreset(resolution) {
  const normalized = String(resolution || "").toLowerCase();
  if (normalized === "1280x720" || normalized === "720x1280") {
    return "720p";
  }
  return "720p";
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
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
