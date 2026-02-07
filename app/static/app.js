const providerSelect = document.getElementById("provider");
const modelSelect = document.getElementById("model");
const operationRow = document.getElementById("operation-row");
const operationSelect = document.getElementById("operation");
const dynamicFields = document.getElementById("dynamic-fields");
const gatewayTokenInput = document.getElementById("gateway_token");
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

const TOKEN_STORAGE_KEY = "video_gateway_token";
const FIELD_STORAGE_PREFIX = "video_gateway_field_";
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
};

let taskPollTimer = null;

async function init() {
  hydrateToken();
  await loadCatalog();
  bindEvents();
  await refreshTasks();
  taskPollTimer = setInterval(refreshTasks, POLL_INTERVAL_MS);
}

function bindEvents() {
  providerSelect.addEventListener("change", onProviderChanged);
  modelSelect.addEventListener("change", onModelChanged);
  operationSelect.addEventListener("change", onOperationChanged);
  refreshButton.addEventListener("click", refreshTasks);
  form.addEventListener("submit", onSubmit);
  taskList.addEventListener("click", onTaskListClick);
  playLatestButton.addEventListener("click", onPlayLatest);
  playerSwitchButton.addEventListener("click", onSwitchPlayerVersion);
  gatewayTokenInput.addEventListener("input", persistToken);
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
    populateModels(providerSelect.value);
  }
}

function onProviderChanged() {
  populateModels(providerSelect.value);
}

function onModelChanged() {
  populateOperations(getSelectedModel());
}

function onOperationChanged() {
  renderDynamicFields();
}

function populateModels(providerId) {
  const provider = getProviderById(providerId);
  modelSelect.innerHTML = "";
  if (!provider) {
    populateOperations(null);
    return;
  }

  for (const model of provider.models || []) {
    const option = document.createElement("option");
    option.value = model.name;
    option.textContent = model.display_name;
    modelSelect.appendChild(option);
    if (model.is_default) {
      modelSelect.value = model.name;
    }
  }
  if (!modelSelect.value && modelSelect.options.length > 0) {
    modelSelect.value = modelSelect.options[0].value;
  }
  populateOperations(getSelectedModel());
}

function populateOperations(model) {
  operationSelect.innerHTML = "";
  const operations = model?.operations || [];
  for (const operation of operations) {
    const option = document.createElement("option");
    option.value = operation.id;
    option.textContent = operation.display_name;
    operationSelect.appendChild(option);
    if (operation.is_default) {
      operationSelect.value = operation.id;
    }
  }
  if (!operationSelect.value && operationSelect.options.length > 0) {
    operationSelect.value = operationSelect.options[0].value;
  }
  operationRow.hidden = operations.length <= 1;
  renderDynamicFields();
}

function renderDynamicFields() {
  dynamicFields.innerHTML = "";
  const operation = getSelectedOperation();
  if (!operation) {
    return;
  }

  for (const field of operation.fields || []) {
    const wrapper = document.createElement("div");
    wrapper.className = field.input_type === "boolean" ? "field field-boolean" : "field";

    const fieldId = buildFieldElementId(field);
    const label = document.createElement("label");
    label.setAttribute("for", fieldId);
    label.textContent = field.label;

    const input = createFieldInput(field, fieldId);
    input.dataset.fieldKey = field.key;
    input.dataset.fieldTarget = field.target;
    input.dataset.fieldType = field.input_type;

    const hydratedValue = hydrateFieldValue(field);
    const defaultValue = hydratedValue !== null ? hydratedValue : field.default;
    applyFieldValue(input, field, defaultValue);

    if (field.input_type === "boolean") {
      wrapper.appendChild(input);
      wrapper.appendChild(label);
    } else {
      wrapper.appendChild(label);
      wrapper.appendChild(input);
    }

    if (field.help_text) {
      const help = document.createElement("p");
      help.className = "field-help";
      help.textContent = field.help_text;
      wrapper.appendChild(help);
    }

    dynamicFields.appendChild(wrapper);
    input.addEventListener("input", () => persistFieldValue(field, input));
    input.addEventListener("change", () => persistFieldValue(field, input));
  }
}

function createFieldInput(field, fieldId) {
  let input;
  switch (field.input_type) {
    case "textarea":
    case "json":
    case "string_list": {
      input = document.createElement("textarea");
      input.rows = field.input_type === "json" ? 6 : 4;
      break;
    }
    case "select": {
      input = document.createElement("select");
      for (const optionItem of field.options || []) {
        const option = document.createElement("option");
        option.value = optionItem.value;
        option.textContent = optionItem.label;
        input.appendChild(option);
      }
      break;
    }
    case "number": {
      input = document.createElement("input");
      input.type = "number";
      if (field.min != null) input.min = String(field.min);
      if (field.max != null) input.max = String(field.max);
      if (field.step != null) input.step = String(field.step);
      break;
    }
    case "boolean": {
      input = document.createElement("input");
      input.type = "checkbox";
      break;
    }
    case "password": {
      input = document.createElement("input");
      input.type = "password";
      break;
    }
    case "file":
    case "file_list": {
      input = document.createElement("input");
      input.type = "file";
      input.accept = "image/jpeg,image/png,image/webp";
      if (field.input_type === "file_list") {
        input.multiple = true;
      }
      break;
    }
    default: {
      input = document.createElement("input");
      input.type = "text";
      break;
    }
  }

  input.id = fieldId;
  if (field.required) {
    input.required = true;
  }
  if (field.placeholder && input.type !== "checkbox") {
    input.placeholder = field.placeholder;
  }
  return input;
}

function applyFieldValue(input, field, value) {
  if (value == null) {
    return;
  }
  if (field.input_type === "file" || field.input_type === "file_list") {
    return;
  }
  if (field.input_type === "boolean") {
    input.checked = toBoolean(value);
    return;
  }
  if (field.input_type === "json" && typeof value !== "string") {
    input.value = JSON.stringify(value, null, 2);
    return;
  }
  if (field.input_type === "string_list" && Array.isArray(value)) {
    input.value = value.join("\n");
    return;
  }
  input.value = String(value);
}

async function onSubmit(event) {
  event.preventDefault();
  formHint.textContent = "";
  submitButton.disabled = true;
  submitButton.textContent = "提交中...";

  try {
    persistToken();
    const payload = await buildPayloadFromForm();
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
    await refreshTasks();
  } catch (error) {
    formHint.textContent = `提交失败: ${error.message}`;
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "提交生成";
  }
}

async function buildPayloadFromForm() {
  const operation = getSelectedOperation();
  if (!operation) {
    throw new Error("当前模型未配置可用操作");
  }

  const payload = {
    provider: providerSelect.value,
    model: modelSelect.value,
    operation: operation.id,
    provider_options: {},
  };

  for (const field of operation.fields || []) {
    const input = document.getElementById(buildFieldElementId(field));
    if (!input) continue;

    let parsedValue;
    if (field.input_type === "file" || field.input_type === "file_list") {
      const fileIds = await uploadFilesForField(field, input);
      parsedValue = field.input_type === "file" ? fileIds[0] || null : fileIds;
    } else {
      parsedValue = parseFieldValue(field, input);
    }
    const isBoolean = field.input_type === "boolean";
    const shouldSkip = !isBoolean && isEmptyFieldValue(parsedValue);
    if (shouldSkip) {
      continue;
    }

    if (field.target === "provider_options") {
      payload.provider_options[field.key] = parsedValue;
    } else {
      payload[field.key] = parsedValue;
    }
  }

  return payload;
}

function parseFieldValue(field, input) {
  switch (field.input_type) {
    case "boolean":
      return Boolean(input.checked);
    case "number": {
      const raw = String(input.value || "").trim();
      if (!raw) return null;
      const numeric = Number(raw);
      if (!Number.isFinite(numeric)) {
        throw new Error(`${field.label} 必须是数字`);
      }
      if (isIntegerNumberField(field)) {
        if (!Number.isInteger(numeric)) {
          throw new Error(`${field.label} 必须是整数`);
        }
        return numeric;
      }
      return numeric;
    }
    case "json": {
      const raw = String(input.value || "").trim();
      if (!raw) return null;
      try {
        return JSON.parse(raw);
      } catch {
        throw new Error(`${field.label} 不是合法 JSON`);
      }
    }
    case "string_list": {
      const raw = String(input.value || "").trim();
      if (!raw) return [];
      return raw
        .replaceAll("\r", "")
        .split(/\n|,/)
        .map((item) => item.trim())
        .filter(Boolean);
    }
    default: {
      const raw = String(input.value || "").trim();
      return raw || null;
    }
  }
}

async function uploadFilesForField(field, input) {
  const files = Array.from(input.files || []);
  if (files.length === 0) {
    return [];
  }

  const uploadedIds = [];
  for (let index = 0; index < files.length; index += 1) {
    const current = files[index];
    formHint.textContent = `上传文件中 (${index + 1}/${files.length}): ${current.name}`;
    const uploaded = await uploadFileToGateway(current);
    uploadedIds.push(uploaded.file_id);
  }
  return uploadedIds;
}

async function uploadFileToGateway(file) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch("/v1/files", {
    method: "POST",
    headers: getGatewayHeaders(),
    body: formData,
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail));
  }
  return data;
}

function isIntegerNumberField(field) {
  return field.target === "request" && ["duration_sec", "fps", "seed"].includes(field.key);
}

function isEmptyFieldValue(value) {
  if (value == null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function buildFieldElementId(field) {
  return `field_${field.target}_${field.key}`;
}

function fieldStorageKey(field) {
  const operation = getSelectedOperation();
  const operationId = operation?.id || "";
  return `${FIELD_STORAGE_PREFIX}${providerSelect.value}__${modelSelect.value}__${operationId}__${field.target}__${field.key}`;
}

function persistFieldValue(field, input) {
  if (["password", "file", "file_list"].includes(field.input_type)) {
    return;
  }
  const key = fieldStorageKey(field);
  if (field.input_type === "boolean") {
    localStorage.setItem(key, input.checked ? "true" : "false");
    return;
  }
  const raw = String(input.value || "");
  if (raw.trim()) {
    localStorage.setItem(key, raw);
  } else {
    localStorage.removeItem(key);
  }
}

function hydrateFieldValue(field) {
  if (field.input_type === "file" || field.input_type === "file_list") {
    return null;
  }
  const key = fieldStorageKey(field);
  const value = localStorage.getItem(key);
  if (value == null) {
    return null;
  }
  if (field.input_type === "boolean") {
    return value === "true";
  }
  if (field.input_type === "number") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (field.input_type === "json") {
    return value;
  }
  if (field.input_type === "string_list") {
    return value
      .replaceAll("\r", "")
      .split(/\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return value;
}

function toBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["1", "true", "yes", "on"].includes(normalized);
  }
  return Boolean(value);
}

function getProviderById(providerId) {
  return state.catalog.find((item) => item.id === providerId) || null;
}

function getSelectedProvider() {
  return getProviderById(providerSelect.value);
}

function getSelectedModel() {
  const provider = getSelectedProvider();
  if (!provider) return null;
  return (provider.models || []).find((item) => item.name === modelSelect.value) || null;
}

function getSelectedOperation() {
  const model = getSelectedModel();
  if (!model) return null;
  const operations = model.operations || [];
  return operations.find((item) => item.id === operationSelect.value) || operations[0] || null;
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

function getGatewayHeaders() {
  const token = gatewayTokenInput.value.trim();
  if (!token) {
    return {};
  }
  return { Authorization: `Bearer ${token}` };
}

function persistToken() {
  const token = gatewayTokenInput.value.trim();
  if (token) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    return;
  }
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

function hydrateToken() {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (token) {
    gatewayTokenInput.value = token;
  }
}

init().catch((error) => {
  formHint.textContent = `初始化失败: ${error.message}`;
});
