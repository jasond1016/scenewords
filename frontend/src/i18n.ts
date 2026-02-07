import { useMemo } from "react";
import { useAppSettingsStore, type LanguagePreference } from "./state";

export type SupportedLocale = "zh-CN" | "en";

type MessageVars = Record<string, string | number>;

const ZH_CN: Record<string, string> = {
  "app.documentTitle": "片语 / SceneWords",
  "app.brandTitle": "片语",
  "app.brandSubtitle": "SceneWords",
  "app.gateway": "视频网关",
  "nav.create": "创作",
  "nav.jobs": "任务",
  "nav.settings": "设置",
  "common.inProgress": "进行中",
  "common.history": "历史",
  "common.clear": "清空",
  "common.close": "关闭",
  "common.na": "N/A",
  "common.retrySameSeed": "同种子重试",
  "common.retryNewSeed": "新种子重试",

  "create.loadingCatalog": "正在加载模型配置...",
  "create.noAvailable": "没有可用的 Provider / Model / Operation。",
  "create.title": "创作",
  "create.subtitle": "输入提示词并生成视频，参数会按 Provider/Model/Operation 自动保存。",
  "create.gatewayToken": "网关令牌",
  "create.gatewayTokenPlaceholder": "仅开启鉴权时需要",
  "create.provider": "Provider",
  "create.model": "模型",
  "create.operation": "操作",
  "create.coreInputs": "核心参数",
  "create.promptPresets": "提示词预设",
  "create.saveCurrentPreset": "保存当前",
  "create.hintPromptEmpty": "当前提示词为空，无法加入预设。",
  "create.hintPresetExists": "该预设已存在。",
  "create.hintPresetSaved": "已加入提示词预设。",
  "create.hintPresetApplied": "已填入预设提示词。",
  "create.removePreset": "移除",
  "create.recentPrompts": "最近提示词",
  "create.hintRecentPromptApplied": "已填入历史提示词。",
  "create.noRecentPrompts": "暂无可用历史提示词。",
  "create.pin": "置顶",
  "create.unpin": "取消置顶",
  "create.advancedOptions": "高级选项 ({count})",
  "create.generateVideo": "生成视频",
  "create.submitting": "提交中...",
  "create.estimated": "预估: {cost} {currency}",
  "create.estimatedUnavailable": "预估成本: N/A",
  "create.errorNoOperation": "未找到可用 operation",
  "create.errorMissingRequiredFile": "缺少必填文件: {label}",
  "create.hintUploading": "上传文件中 ({index}/{total})...",
  "create.hintCreated": "任务已创建：{taskId}",
  "create.hintSubmitFailed": "提交失败：{message}",
  "create.hintReusedDraft": "已从历史记录继承参数，可直接修改提示词后重试。",

  "jobs.loading": "正在加载任务...",
  "jobs.title": "任务",
  "jobs.subtitle": "查看队列、历史、任务详情并执行重试。",
  "jobs.searchPlaceholder": "搜索 task id / prompt / provider",
  "jobs.allProviders": "全部 Provider",
  "jobs.allStatus": "全部状态",
  "jobs.clearFilters": "清空筛选",
  "jobs.emptyPrompt": "(空提示词)",
  "jobs.seed": "种子",
  "jobs.detail": "任务详情",
  "jobs.cost": "成本",
  "jobs.estimatedSuffix": "(预估)",
  "jobs.retryPrompt": "重试提示词",
  "jobs.reuseSettings": "复用参数",
  "jobs.refillInCreate": "回填到创作页",
  "jobs.copyRequestJson": "复制请求 JSON",
  "jobs.retry": "重试 ({mode})",
  "jobs.fullscreenPlay": "全屏播放",
  "jobs.rawResult": "原始结果",
  "jobs.selectHint": "请选择任务查看详情。",
  "jobs.copyJsonSuccess": "请求参数 JSON 已复制到剪贴板。",
  "jobs.copyJsonFailed": "复制失败，请手动复制。",
  "jobs.retryQueued": "重试任务已入队：{taskId}",
  "jobs.retryFailed": "重试失败：{message}",
  "jobs.statusQueuedWithPosition": "排队中 (#{position})",
  "status.queued": "排队中",
  "status.running": "执行中",
  "status.succeeded": "成功",
  "status.failed": "失败",
  "status.canceled": "已取消",

  "settings.title": "设置",
  "settings.subtitle": "默认值、通知与成本展示策略。",
  "settings.language": "语言",
  "settings.languageSystem": "跟随系统",
  "settings.languageZhCN": "简体中文",
  "settings.languageEn": "English",
  "settings.generationDefaults": "生成默认值",
  "settings.defaultProvider": "默认 Provider",
  "settings.defaultRatio": "默认比例",
  "settings.defaultDuration": "默认时长 (秒)",
  "settings.defaultQuality": "默认质量",
  "settings.defaultNegativePrompt": "默认负向提示词",
  "settings.restoreLastSession": "恢复上次会话",
  "settings.retryBehavior": "重试策略",
  "settings.retryDefault": "默认重试方式",
  "settings.sameSeed": "同种子",
  "settings.newSeed": "新种子",
  "settings.showBothRetryActions": "同时显示两种重试按钮",
  "settings.notifications": "通知",
  "settings.notifySuccess": "成功通知",
  "settings.notifyFailure": "失败通知",
  "settings.notifySound": "通知声音",
  "settings.notifyBadge": "通知角标",
  "settings.requestNotificationPermission": "请求通知权限",
  "settings.notificationUnsupported": "当前浏览器不支持通知。",
  "settings.notificationPermission": "通知权限：{permission}",
  "settings.costPricing": "成本与价格",
  "settings.costMode": "成本模式",
  "settings.costModeProviderApi": "Provider API",
  "settings.costModeLocalConfig": "本地配置",
  "settings.currency": "货币",
  "settings.pricingVersion": "价格版本",
  "settings.showEstimatedBeforeSubmit": "提交前展示预估成本",
  "settings.showActualAfterDone": "完成后展示实际成本",
  "settings.privacyStorage": "隐私与存储",
  "settings.savePromptHistory": "保存提示词历史",
  "settings.historyRetentionDays": "历史保留天数",
  "settings.clearLocalCache": "清理本地缓存",
  "settings.clearedLocalCache": "已清理本地会话缓存。",

  "notify.videoReadyTitle": "视频已就绪",
  "notify.videoReadyBody": "{provider} / {model} / {taskId}",
  "notify.generationFailedTitle": "生成失败",

  "error.numberRequired": "{label} 必须是数字",
  "error.invalidJson": "{label} 不是合法 JSON",
  "error.defaultFailure": "生成失败，请稍后重试。",
  "error.unknown_provider": "Provider 不存在或已被禁用",
  "error.provider_not_initialized": "Provider 未正确初始化",
  "error.timeout": "请求超时",
  "error.invalid_response": "上游返回格式异常",
  "error.unauthorized": "鉴权失败，请检查 API Key",
  "error.quota_exceeded": "额度不足或已超限",
  "error.rate_limited": "请求频率受限，请稍后再试",
  "error.internal_error": "网关内部错误",
  "error.upstream_error": "上游服务异常",
  "error.bad_request": "请求参数不合法",
};

const EN: Record<string, string> = {
  "app.documentTitle": "SceneWords / 片语",
  "app.brandTitle": "SceneWords",
  "app.brandSubtitle": "片语",
  "app.gateway": "Video Gateway",
  "nav.create": "Create",
  "nav.jobs": "Jobs",
  "nav.settings": "Settings",
  "common.inProgress": "In Progress",
  "common.history": "History",
  "common.clear": "Clear",
  "common.close": "Close",
  "common.na": "N/A",
  "common.retrySameSeed": "Retry (Same Seed)",
  "common.retryNewSeed": "Retry (New Seed)",

  "create.loadingCatalog": "Loading model catalog...",
  "create.noAvailable": "No available Provider / Model / Operation.",
  "create.title": "Create",
  "create.subtitle":
    "Enter prompts to generate videos. Parameters are auto-saved by Provider/Model/Operation.",
  "create.gatewayToken": "Gateway Token",
  "create.gatewayTokenPlaceholder": "Required only when auth is enabled",
  "create.provider": "Provider",
  "create.model": "Model",
  "create.operation": "Operation",
  "create.coreInputs": "Core Inputs",
  "create.promptPresets": "Prompt Presets",
  "create.saveCurrentPreset": "Save Current",
  "create.hintPromptEmpty": "Prompt is empty. Cannot save as preset.",
  "create.hintPresetExists": "This preset already exists.",
  "create.hintPresetSaved": "Prompt preset saved.",
  "create.hintPresetApplied": "Preset applied to prompt.",
  "create.removePreset": "Remove",
  "create.recentPrompts": "Recent Prompts",
  "create.hintRecentPromptApplied": "Recent prompt applied.",
  "create.noRecentPrompts": "No recent prompts available.",
  "create.pin": "Pin",
  "create.unpin": "Unpin",
  "create.advancedOptions": "Advanced Options ({count})",
  "create.generateVideo": "Generate Video",
  "create.submitting": "Submitting...",
  "create.estimated": "Estimated: {cost} {currency}",
  "create.estimatedUnavailable": "Estimated cost: N/A",
  "create.errorNoOperation": "No available operation found",
  "create.errorMissingRequiredFile": "Missing required file: {label}",
  "create.hintUploading": "Uploading files ({index}/{total})...",
  "create.hintCreated": "Task created: {taskId}",
  "create.hintSubmitFailed": "Submit failed: {message}",
  "create.hintReusedDraft":
    "Parameters were restored from history. Update prompt and retry if needed.",

  "jobs.loading": "Loading tasks...",
  "jobs.title": "Jobs",
  "jobs.subtitle": "View queue/history, inspect task details, and retry.",
  "jobs.searchPlaceholder": "Search task id / prompt / provider",
  "jobs.allProviders": "All Providers",
  "jobs.allStatus": "All Status",
  "jobs.clearFilters": "Clear Filters",
  "jobs.emptyPrompt": "(empty prompt)",
  "jobs.seed": "seed",
  "jobs.detail": "Task Detail",
  "jobs.cost": "cost",
  "jobs.estimatedSuffix": "(est.)",
  "jobs.retryPrompt": "Retry Prompt",
  "jobs.reuseSettings": "Reuse Settings",
  "jobs.refillInCreate": "Refill In Create",
  "jobs.copyRequestJson": "Copy Request JSON",
  "jobs.retry": "Retry ({mode})",
  "jobs.fullscreenPlay": "Fullscreen Play",
  "jobs.rawResult": "Raw Result",
  "jobs.selectHint": "Select a task to view details.",
  "jobs.copyJsonSuccess": "Request JSON copied to clipboard.",
  "jobs.copyJsonFailed": "Copy failed. Please copy manually.",
  "jobs.retryQueued": "Retry task queued: {taskId}",
  "jobs.retryFailed": "Retry failed: {message}",
  "jobs.statusQueuedWithPosition": "queued (#{position})",
  "status.queued": "queued",
  "status.running": "running",
  "status.succeeded": "succeeded",
  "status.failed": "failed",
  "status.canceled": "canceled",

  "settings.title": "Settings",
  "settings.subtitle": "Defaults, notifications, and cost display strategy.",
  "settings.language": "Language",
  "settings.languageSystem": "System Default",
  "settings.languageZhCN": "Simplified Chinese",
  "settings.languageEn": "English",
  "settings.generationDefaults": "Generation Defaults",
  "settings.defaultProvider": "Default Provider",
  "settings.defaultRatio": "Default Ratio",
  "settings.defaultDuration": "Default Duration (s)",
  "settings.defaultQuality": "Default Quality",
  "settings.defaultNegativePrompt": "Default Negative Prompt",
  "settings.restoreLastSession": "Restore Last Session",
  "settings.retryBehavior": "Retry Behavior",
  "settings.retryDefault": "Retry Default",
  "settings.sameSeed": "Same Seed",
  "settings.newSeed": "New Seed",
  "settings.showBothRetryActions": "Show Both Retry Actions",
  "settings.notifications": "Notifications",
  "settings.notifySuccess": "Notify Success",
  "settings.notifyFailure": "Notify Failure",
  "settings.notifySound": "Notify Sound",
  "settings.notifyBadge": "Notify Badge",
  "settings.requestNotificationPermission": "Request Notification Permission",
  "settings.notificationUnsupported": "Notifications are not supported in this browser.",
  "settings.notificationPermission": "Notification permission: {permission}",
  "settings.costPricing": "Cost & Pricing",
  "settings.costMode": "Cost Mode",
  "settings.costModeProviderApi": "Provider API",
  "settings.costModeLocalConfig": "Local Config",
  "settings.currency": "Currency",
  "settings.pricingVersion": "Pricing Version",
  "settings.showEstimatedBeforeSubmit": "Show Estimated Cost Before Submit",
  "settings.showActualAfterDone": "Show Actual Cost After Done",
  "settings.privacyStorage": "Privacy & Storage",
  "settings.savePromptHistory": "Save Prompt History",
  "settings.historyRetentionDays": "History Retention Days",
  "settings.clearLocalCache": "Clear Local Cache",
  "settings.clearedLocalCache": "Local session cache cleared.",

  "notify.videoReadyTitle": "Video Ready",
  "notify.videoReadyBody": "{provider} / {model} / {taskId}",
  "notify.generationFailedTitle": "Generation Failed",

  "error.numberRequired": "{label} must be a number",
  "error.invalidJson": "{label} is not valid JSON",
  "error.defaultFailure": "Generation failed. Please try again later.",
  "error.unknown_provider": "Provider not found or disabled",
  "error.provider_not_initialized": "Provider is not initialized",
  "error.timeout": "Request timeout",
  "error.invalid_response": "Invalid upstream response",
  "error.unauthorized": "Unauthorized. Check API key",
  "error.quota_exceeded": "Quota exceeded",
  "error.rate_limited": "Rate limited. Please retry later",
  "error.internal_error": "Gateway internal error",
  "error.upstream_error": "Upstream service error",
  "error.bad_request": "Invalid request parameters",
};

const MESSAGES: Record<SupportedLocale, Record<string, string>> = {
  "zh-CN": ZH_CN,
  en: EN,
};

export type TranslateFn = (key: string, vars?: MessageVars) => string;

function formatMessage(template: string, vars?: MessageVars): string {
  if (!vars) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = vars[key];
    return value == null ? "" : String(value);
  });
}

export function detectSystemLocale(): SupportedLocale {
  if (typeof navigator === "undefined") {
    return "en";
  }
  const candidates = [
    ...(Array.isArray(navigator.languages) ? navigator.languages : []),
    navigator.language,
  ]
    .filter((item): item is string => Boolean(item))
    .map((item) => item.toLowerCase());

  if (candidates.some((item) => item.startsWith("zh"))) {
    return "zh-CN";
  }
  return "en";
}

export function resolveLocale(language: LanguagePreference): SupportedLocale {
  if (language === "system") {
    return detectSystemLocale();
  }
  return language;
}

export function createTranslator(locale: SupportedLocale): TranslateFn {
  const dict = MESSAGES[locale];
  return (key: string, vars?: MessageVars) => {
    const value = dict[key] ?? EN[key] ?? key;
    return formatMessage(value, vars);
  };
}

export function useI18n(): {
  locale: SupportedLocale;
  language: LanguagePreference;
  t: TranslateFn;
} {
  const language = useAppSettingsStore((state) => state.language);
  const locale = useMemo(() => resolveLocale(language), [language]);
  const t = useMemo(() => createTranslator(locale), [locale]);

  return {
    locale,
    language,
    t,
  };
}
