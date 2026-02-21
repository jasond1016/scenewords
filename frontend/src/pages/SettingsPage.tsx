import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n";
import type { LanguagePreference, ProviderGenerationDefaults } from "../state";
import { useAppSettingsStore } from "../state";
import { FIELD_STORAGE_PREFIX, SESSION_STORAGE_KEY, supportedDurationOptions } from "../utils";
import type { ProviderInfo, RetryMode } from "../types";

interface Props {
  pricingVersion: string | null;
  providers: ProviderInfo[];
}

type SettingCategory =
  | "language_gateway"
  | "generation_defaults"
  | "notifications"
  | "privacy_storage";

const SETTINGS_STORE_KEY = "scenewords_gateway_settings_v1";
const SCENEWORDS_CACHE_PREFIX = "scenewords_";
const SETTINGS_MANUAL_SNAPSHOT_KEY = "scenewords_settings_manual_checkpoint_v1";

export function SettingsPage(props: Props) {
  const { locale, t } = useI18n();
  const isZh = locale === "zh-CN";
  const settings = useAppSettingsStore();
  const [hint, setHint] = useState("");
  const [showGatewayToken, setShowGatewayToken] = useState(false);
  const [activeCategory, setActiveCategory] = useState<SettingCategory>("language_gateway");
  const [cacheRevision, setCacheRevision] = useState(0);

  const durationOptions = useMemo(
    () => supportedDurationOptions(props.providers),
    [props.providers],
  );

  useEffect(() => {
    if (!props.pricingVersion || props.pricingVersion === settings.pricingVersion) {
      return;
    }
    settings.setSettings({ pricingVersion: props.pricingVersion });
  }, [props.pricingVersion, settings.pricingVersion, settings.setSettings]);

  useEffect(() => {
    if (!settings.defaultProvider) {
      return;
    }
    const exists = props.providers.some((provider) => provider.id === settings.defaultProvider);
    if (!exists) {
      settings.setSettings({ defaultProvider: "" });
    }
  }, [props.providers, settings.defaultProvider, settings.setSettings]);

  useEffect(() => {
    if (!durationOptions.length) {
      return;
    }
    if (durationOptions.includes(settings.defaultDurationSec)) {
      return;
    }
    settings.setSettings({ defaultDurationSec: durationOptions[0] });
  }, [durationOptions, settings.defaultDurationSec, settings.setSettings]);

  const sectionIds: Record<SettingCategory, string> = {
    language_gateway: "settings_language_gateway",
    generation_defaults: "settings_generation_defaults",
    notifications: "settings_notifications",
    privacy_storage: "settings_privacy_storage",
  };

  const cacheStats = useMemo(() => collectSceneWordsCacheStats(), [cacheRevision]);
  const historyStatusLabel = settings.savePromptHistory
    ? isZh
      ? "开启"
      : "On"
    : isZh
      ? "关闭"
      : "Off";

  const resolveProviderDefaults = (providerId: string): ProviderGenerationDefaults => {
    const scoped = settings.providerDefaults[providerId];
    return {
      defaultRatio: scoped?.defaultRatio ?? settings.defaultRatio,
      defaultDurationSec: scoped?.defaultDurationSec ?? settings.defaultDurationSec,
      defaultQuality: scoped?.defaultQuality ?? settings.defaultQuality,
      defaultNegativePrompt: scoped?.defaultNegativePrompt ?? settings.defaultNegativePrompt,
    };
  };

  const updateGenerationDefaults = (
    partial: Partial<Pick<ProviderGenerationDefaults, "defaultRatio" | "defaultDurationSec" | "defaultQuality" | "defaultNegativePrompt">>,
  ) => {
    const nextDefaults: ProviderGenerationDefaults = {
      defaultRatio: partial.defaultRatio ?? settings.defaultRatio,
      defaultDurationSec: partial.defaultDurationSec ?? settings.defaultDurationSec,
      defaultQuality: partial.defaultQuality ?? settings.defaultQuality,
      defaultNegativePrompt: partial.defaultNegativePrompt ?? settings.defaultNegativePrompt,
    };

    const updatePayload: Partial<typeof settings> = {
      ...partial,
    };
    if (settings.defaultProvider) {
      updatePayload.providerDefaults = {
        ...settings.providerDefaults,
        [settings.defaultProvider]: nextDefaults,
      };
    }
    settings.setSettings(updatePayload);
  };

  const applyProviderDefaults = (providerId: string) => {
    if (!providerId) {
      settings.setSettings({ defaultProvider: "" });
      return;
    }
    const scoped = resolveProviderDefaults(providerId);
    settings.setSettings({
      defaultProvider: providerId,
      defaultRatio: scoped.defaultRatio,
      defaultDurationSec: scoped.defaultDurationSec,
      defaultQuality: scoped.defaultQuality,
      defaultNegativePrompt: scoped.defaultNegativePrompt,
      providerDefaults: {
        ...settings.providerDefaults,
        [providerId]: scoped,
      },
    });
  };

  const jumpToCategory = (category: SettingCategory) => {
    setActiveCategory(category);
    const element = document.getElementById(sectionIds[category]);
    if (!element) {
      return;
    }
    element.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleRestoreDefaults = () => {
    const confirmed = window.confirm(
      isZh ? "恢复设置默认值（保留网关 Token）？" : "Restore default settings (keep gateway token)?",
    );
    if (!confirmed) {
      return;
    }

    settings.setSettings({
      language: "system",
      defaultProvider: "",
      defaultRatio: "16:9",
      defaultDurationSec: durationOptions[0] ?? 8,
      defaultQuality: "standard",
      defaultNegativePrompt: "",
      restoreLastSession: true,
      retryModeDefault: "same_seed",
      showBothRetryActions: true,
      notifyOnSuccess: true,
      notifyOnFailure: true,
      notifySound: true,
      notifyBadge: true,
      costMode: "local_config",
      currency: "USD",
      showEstimatedCostPreSubmit: true,
      showActualCostPostDone: true,
      pricingVersion: props.pricingVersion ?? settings.pricingVersion,
      savePromptHistory: true,
      historyRetentionDays: 90,
      providerDefaults: {},
      theme: "system",
    });
    setHint(isZh ? "已恢复默认设置（Token 保留）。" : "Defaults restored (token kept).");
  };

  const handleSaveSettings = () => {
    const snapshot = {
      savedAt: new Date().toISOString(),
      settings: {
        language: settings.language,
        gatewayToken: settings.gatewayToken,
        defaultProvider: settings.defaultProvider,
        defaultRatio: settings.defaultRatio,
        defaultDurationSec: settings.defaultDurationSec,
        defaultQuality: settings.defaultQuality,
        defaultNegativePrompt: settings.defaultNegativePrompt,
        notifyOnSuccess: settings.notifyOnSuccess,
        notifyOnFailure: settings.notifyOnFailure,
        notifySound: settings.notifySound,
        notifyBadge: settings.notifyBadge,
        savePromptHistory: settings.savePromptHistory,
        historyRetentionDays: settings.historyRetentionDays,
        providerDefaults: settings.providerDefaults,
      },
    };
    localStorage.setItem(SETTINGS_MANUAL_SNAPSHOT_KEY, JSON.stringify(snapshot));
    setHint(
      isZh
        ? "设置已保存（含手动快照）。"
        : "Settings saved (manual checkpoint created).",
    );
  };

  const requestNotificationPermission = async () => {
    if (!("Notification" in window)) {
      setHint(t("settings.notificationUnsupported"));
      return;
    }
    const permission = await Notification.requestPermission();
    setHint(t("settings.notificationPermission", { permission }));
  };

  const clearLocalCache = () => {
    clearSceneWordsCache();
    setCacheRevision((current) => current + 1);
    setHint(t("settings.clearedLocalCache"));
  };

  return (
    <div className="mx-auto flex w-full max-w-[1366px] flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
      <section className="rounded-2xl border border-[#DDD6C8] bg-[#FBF8F2] p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="m-0 text-2xl font-bold tracking-tight text-[#1C1917] sm:text-[28px]">
              Settings · Preferences
            </h1>
            <p className="mb-0 mt-2 text-xs font-medium text-[#78716C]">
              {isZh
                ? "语言、网关、生成默认值、通知策略与本地隐私统一管理。"
                : "Manage language, gateway, generation defaults, notifications, and local privacy."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRestoreDefaults}
              className="rounded-lg bg-[#ECE7DC] px-3 py-1.5 text-xs font-semibold text-[#57534E] transition-colors hover:bg-[#E0D8C8]"
            >
              {isZh ? "恢复默认" : "Restore Defaults"}
            </button>
            <button
              type="button"
              onClick={handleSaveSettings}
              className="rounded-lg bg-[#EA580C] px-3 py-1.5 text-xs font-semibold text-[#FFF7ED] transition-colors hover:bg-[#D94E08]"
            >
              {isZh ? "保存设置" : "Save Settings"}
            </button>
          </div>
        </div>
      </section>

      <section className="grid items-start gap-4 lg:grid-cols-[220px_minmax(0,1fr)_340px]">
        <aside className="rounded-xl border border-[#DDD6C8] bg-[#FBF8F2] p-3">
          <p className="mb-2 mt-0 text-xs font-semibold text-[#1C1917]">
            {isZh ? "设置分类" : "Categories"}
          </p>
          <div className="flex flex-col gap-2">
            <CategoryButton
              label={isZh ? "语言与网关" : "Language & Gateway"}
              active={activeCategory === "language_gateway"}
              onClick={() => jumpToCategory("language_gateway")}
            />
            <CategoryButton
              label={t("settings.generationDefaults")}
              active={activeCategory === "generation_defaults"}
              onClick={() => jumpToCategory("generation_defaults")}
            />
            <CategoryButton
              label={t("settings.notifications")}
              active={activeCategory === "notifications"}
              onClick={() => jumpToCategory("notifications")}
            />
            <CategoryButton
              label={t("settings.privacyStorage")}
              active={activeCategory === "privacy_storage"}
              onClick={() => jumpToCategory("privacy_storage")}
            />
          </div>
        </aside>

        <div className="flex min-w-0 flex-col gap-3">
          <section
            id={sectionIds.language_gateway}
            className="rounded-xl border border-[#DDD6C8] bg-[#FBF8F2] p-4"
          >
            <h3 className="m-0 text-sm font-semibold text-[#1C1917]">
              {isZh ? "语言与网关" : "Language & Gateway"}
            </h3>
            <div className="mt-3 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3 rounded-lg bg-[#F6F3EC] px-3 py-2">
                <span className="text-sm font-medium text-[#44403C]">{t("settings.language")}</span>
                <LanguageSwitcher
                  value={settings.language}
                  onChange={(value) => settings.setSettings({ language: value })}
                  t={t}
                />
              </div>

              <div className="rounded-lg bg-[#F6F3EC] p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#44403C]">
                    Gateway · Bearer Token
                  </span>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
                        settings.gatewayToken.trim()
                          ? "bg-[#E6F3EE] text-[#0F766E]"
                          : "bg-[#ECE7DC] text-[#57534E]"
                      }`}
                    >
                      {settings.gatewayToken.trim()
                        ? isZh
                          ? "已配置"
                          : "Configured"
                        : isZh
                          ? "未配置"
                          : "Not Set"}
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowGatewayToken((current) => !current)}
                      className="rounded-full bg-[#ECE7DC] px-2 py-1 text-[10px] font-semibold text-[#57534E] transition-colors hover:bg-[#E0D8C8]"
                    >
                      {showGatewayToken
                        ? isZh
                          ? "隐藏"
                          : "Hide"
                        : isZh
                          ? "显示"
                          : "Show"}
                    </button>
                  </div>
                </div>
                <input
                  type={showGatewayToken ? "text" : "password"}
                  value={settings.gatewayToken}
                  onChange={(event) => settings.setSettings({ gatewayToken: event.target.value })}
                  placeholder={t("settings.gatewayTokenPlaceholder")}
                  className="w-full rounded-lg border border-[#DDD6C8] bg-[#FBF8F2] px-3 py-2 text-sm text-[#1C1917] outline-none transition-colors placeholder:text-[#A8A29E] focus:border-[#CFC5B4]"
                />
              </div>
            </div>
          </section>

          <section
            id={sectionIds.generation_defaults}
            className="rounded-xl border border-[#DDD6C8] bg-[#FBF8F2] p-4"
          >
            <h3 className="m-0 text-sm font-semibold text-[#1C1917]">{t("settings.generationDefaults")}</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <SettingField label={t("settings.defaultProvider")}>
                <select
                  value={settings.defaultProvider}
                  onChange={(event) => applyProviderDefaults(event.target.value)}
                  className="w-full rounded-lg border border-[#DDD6C8] bg-[#F6F3EC] px-3 py-2 text-sm text-[#1C1917] outline-none focus:border-[#CFC5B4]"
                >
                  <option value="">{t("settings.defaultProviderAuto")}</option>
                  {props.providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.display_name}
                    </option>
                  ))}
                </select>
              </SettingField>

              <SettingField label={t("settings.defaultRatio")}>
                <div className="inline-flex w-full items-center gap-1 rounded-lg bg-[#ECE7DC] p-1">
                  <RatioButton
                    label="16:9"
                    active={settings.defaultRatio === "16:9"}
                    onClick={() => updateGenerationDefaults({ defaultRatio: "16:9" })}
                  />
                  <RatioButton
                    label="9:16"
                    active={settings.defaultRatio === "9:16"}
                    onClick={() => updateGenerationDefaults({ defaultRatio: "9:16" })}
                  />
                </div>
              </SettingField>

              <SettingField label={t("settings.defaultDuration")}>
                <select
                  value={String(settings.defaultDurationSec)}
                  onChange={(event) =>
                    updateGenerationDefaults({ defaultDurationSec: Number(event.target.value) || 8 })
                  }
                  className="w-full rounded-lg border border-[#DDD6C8] bg-[#F6F3EC] px-3 py-2 text-sm text-[#1C1917] outline-none focus:border-[#CFC5B4]"
                >
                  {durationOptions.map((seconds) => (
                    <option key={seconds} value={String(seconds)}>
                      {seconds}
                    </option>
                  ))}
                </select>
              </SettingField>

              <SettingField label={t("settings.defaultQuality")}>
                <input
                  value={settings.defaultQuality}
                  onChange={(event) => updateGenerationDefaults({ defaultQuality: event.target.value })}
                  className="w-full rounded-lg border border-[#DDD6C8] bg-[#F6F3EC] px-3 py-2 text-sm text-[#1C1917] outline-none focus:border-[#CFC5B4]"
                />
              </SettingField>
            </div>

            <p className="mb-0 mt-3 text-xs text-[#78716C]">
              {isZh
                ? "不同 Provider 可维护独立默认值（比例/时长/质量/负向提示词），切换时会自动回填。"
                : "Each provider can keep independent defaults (ratio/duration/quality/negative prompt), auto-applied on switch."}
            </p>

            <div className="mt-3 flex flex-col gap-2">
              {props.providers.map((provider) => {
                const isDefault = settings.defaultProvider === provider.id;
                const scoped = resolveProviderDefaults(provider.id);
                return (
                  <div
                    key={provider.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#F6F3EC] px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="m-0 text-sm font-semibold text-[#2A2520]">{provider.display_name}</p>
                      <p className="m-0 text-[11px] text-[#78716C]">
                        {scoped.defaultRatio} · {scoped.defaultDurationSec}s · {scoped.defaultQuality}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => applyProviderDefaults(provider.id)}
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                        isDefault
                          ? "bg-[#ECE7DC] text-[#57534E]"
                          : "bg-[#FBF8F2] text-[#57534E] hover:bg-[#EEE7DA]"
                      }`}
                    >
                      {isDefault ? (isZh ? "已设为默认" : "Default") : (isZh ? "设为默认" : "Set")}
                    </button>
                  </div>
                );
              })}
            </div>

            <SettingField className="mt-3" label={t("settings.defaultNegativePrompt")}>
              <textarea
                rows={3}
                value={settings.defaultNegativePrompt}
                onChange={(event) =>
                  updateGenerationDefaults({ defaultNegativePrompt: event.target.value })
                }
                className="w-full rounded-lg border border-[#DDD6C8] bg-[#F6F3EC] px-3 py-2 text-sm text-[#1C1917] outline-none transition-colors placeholder:text-[#A8A29E] focus:border-[#CFC5B4]"
              />
            </SettingField>

            <div className="mt-3">
              <ToggleRow
                label={t("settings.restoreLastSession")}
                checked={settings.restoreLastSession}
                onChange={(checked) => settings.setSettings({ restoreLastSession: checked })}
                isZh={isZh}
              />
            </div>
          </section>

          <details className="rounded-xl border border-[#DDD6C8] bg-[#FBF8F2] p-4">
            <summary className="cursor-pointer text-sm font-semibold text-[#57534E]">
              {isZh ? "高级偏好（重试与成本）" : "Advanced Preferences (Retry & Cost)"}
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <SettingField label={t("settings.retryDefault")}>
                <select
                  value={settings.retryModeDefault}
                  onChange={(event) =>
                    settings.setSettings({ retryModeDefault: event.target.value as RetryMode })
                  }
                  className="w-full rounded-lg border border-[#DDD6C8] bg-[#F6F3EC] px-3 py-2 text-sm text-[#1C1917] outline-none focus:border-[#CFC5B4]"
                >
                  <option value="same_seed">{t("settings.sameSeed")}</option>
                  <option value="new_seed">{t("settings.newSeed")}</option>
                </select>
              </SettingField>

              <SettingField label={t("settings.currency")}>
                <input
                  value={settings.currency}
                  onChange={(event) => settings.setSettings({ currency: event.target.value })}
                  className="w-full rounded-lg border border-[#DDD6C8] bg-[#F6F3EC] px-3 py-2 text-sm text-[#1C1917] outline-none focus:border-[#CFC5B4]"
                />
              </SettingField>

              <SettingField label={t("settings.costMode")}>
                <select
                  value={settings.costMode}
                  onChange={(event) =>
                    settings.setSettings({
                      costMode: event.target.value as "provider_api" | "local_config",
                    })
                  }
                  className="w-full rounded-lg border border-[#DDD6C8] bg-[#F6F3EC] px-3 py-2 text-sm text-[#1C1917] outline-none focus:border-[#CFC5B4]"
                >
                  <option value="provider_api">{t("settings.costModeProviderApi")}</option>
                  <option value="local_config">{t("settings.costModeLocalConfig")}</option>
                </select>
              </SettingField>

              <SettingField label={t("settings.pricingVersion")}>
                <input
                  value={settings.pricingVersion}
                  onChange={(event) => settings.setSettings({ pricingVersion: event.target.value })}
                  className="w-full rounded-lg border border-[#DDD6C8] bg-[#F6F3EC] px-3 py-2 text-sm text-[#1C1917] outline-none focus:border-[#CFC5B4]"
                />
              </SettingField>
            </div>
            <div className="mt-3">
              <ToggleRow
                label={t("settings.showBothRetryActions")}
                checked={settings.showBothRetryActions}
                onChange={(checked) => settings.setSettings({ showBothRetryActions: checked })}
                isZh={isZh}
              />
            </div>
          </details>
        </div>

        <div className="flex flex-col gap-3">
          <section
            id={sectionIds.notifications}
            className="rounded-xl border border-[#DDD6C8] bg-[#FBF8F2] p-4"
          >
            <h3 className="m-0 text-sm font-semibold text-[#1C1917]">{t("settings.notifications")}</h3>
            <div className="mt-3 flex flex-col gap-2">
              <ToggleRow
                label={t("settings.notifySuccess")}
                checked={settings.notifyOnSuccess}
                onChange={(checked) => settings.setSettings({ notifyOnSuccess: checked })}
                isZh={isZh}
              />
              <ToggleRow
                label={t("settings.notifyFailure")}
                checked={settings.notifyOnFailure}
                onChange={(checked) => settings.setSettings({ notifyOnFailure: checked })}
                isZh={isZh}
              />
              <ToggleRow
                label={t("settings.notifySound")}
                checked={settings.notifySound}
                onChange={(checked) => settings.setSettings({ notifySound: checked })}
                isZh={isZh}
              />
              <ToggleRow
                label={t("settings.notifyBadge")}
                checked={settings.notifyBadge}
                onChange={(checked) => settings.setSettings({ notifyBadge: checked })}
                isZh={isZh}
              />
              <div className="rounded-lg bg-[#F6F3EC] p-2.5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-[#44403C]">
                    {t("settings.requestNotificationPermission")}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      void requestNotificationPermission();
                    }}
                    className="rounded-lg bg-[#ECE7DC] px-2.5 py-1 text-[11px] font-semibold text-[#57534E] transition-colors hover:bg-[#E0D8C8]"
                  >
                    {isZh ? "请求" : "Request"}
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section
            id={sectionIds.privacy_storage}
            className="rounded-xl border border-[#DDD6C8] bg-[#FBF8F2] p-4"
          >
            <h3 className="m-0 text-sm font-semibold text-[#1C1917]">{t("settings.privacyStorage")}</h3>
            <div className="mt-3 flex flex-col gap-2">
              <ToggleRow
                label={t("settings.savePromptHistory")}
                checked={settings.savePromptHistory}
                onChange={(checked) => settings.setSettings({ savePromptHistory: checked })}
                isZh={isZh}
              />

              <div className="flex items-center justify-between gap-2 rounded-lg bg-[#F6F3EC] px-3 py-2">
                <span className="text-sm font-medium text-[#44403C]">{t("settings.historyRetentionDays")}</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={settings.historyRetentionDays}
                  onChange={(event) =>
                    settings.setSettings({ historyRetentionDays: Number(event.target.value) || 90 })
                  }
                  className="w-20 rounded-md border border-[#DDD6C8] bg-[#FBF8F2] px-2 py-1 text-right text-sm text-[#1C1917] outline-none focus:border-[#CFC5B4]"
                />
              </div>

              <div className="rounded-lg border border-[#FDBA74] bg-[#FFF7ED] p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-[#9A3412]">
                    {isZh ? "本地缓存摘要" : "Local Cache Summary"}
                  </span>
                  <span className="rounded-full bg-[#FEE8D6] px-2 py-1 text-[10px] font-semibold text-[#9A3412]">
                    {historyStatusLabel}
                  </span>
                </div>
                <p className="m-0 text-[11px] text-[#9A3412]">
                  {isZh ? "缓存键数量" : "Cache keys"}: {cacheStats.keyCount}
                </p>
                <p className="mb-0 mt-0.5 text-[11px] text-[#9A3412]">
                  {isZh ? "缓存占用" : "Cache size"}: {formatBytes(cacheStats.sizeBytes)}
                </p>
                <button
                  type="button"
                  onClick={clearLocalCache}
                  className="mt-2 rounded-lg bg-[#F97316] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#EA580C]"
                >
                  {t("settings.clearLocalCache")}
                </button>
              </div>
            </div>
          </section>
        </div>
      </section>

      {hint ? <p className="m-0 text-xs text-[#736B5E]">{hint}</p> : null}
    </div>
  );
}

function CategoryButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors ${
        active
          ? "bg-[#EA580C] text-[#FFF7ED]"
          : "border border-[#DDD6C8] bg-[#F6F3EC] text-[#57534E] hover:bg-[#EEE7DA]"
      }`}
    >
      {label}
    </button>
  );
}

function SettingField({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={className}>
      <span className="mb-1 block text-xs font-semibold text-[#57534E]">{label}</span>
      {children}
    </label>
  );
}

function LanguageSwitcher({
  value,
  onChange,
  t,
}: {
  value: LanguagePreference;
  onChange: (value: LanguagePreference) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const options: Array<{ value: LanguagePreference; label: string }> = [
    { value: "system", label: t("settings.languageSystem") },
    { value: "zh-CN", label: t("settings.languageZhCN") },
    { value: "en", label: t("settings.languageEn") },
  ];

  return (
    <div className="inline-flex items-center gap-1 rounded-lg bg-[#ECE7DC] p-1">
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            type="button"
            key={option.value}
            onClick={() => onChange(option.value)}
            className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
              active ? "bg-[#EA580C] text-[#FFF7ED]" : "text-[#57534E] hover:bg-[#E4DCCF]"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function RatioButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${
        active ? "bg-[#EA580C] text-[#FFF7ED]" : "text-[#57534E] hover:bg-[#E4DCCF]"
      }`}
    >
      {label}
    </button>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
  isZh,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  isZh: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-[#F6F3EC] px-3 py-2">
      <span className="text-sm font-medium text-[#44403C]">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
          checked
            ? "bg-[#E6F3EE] text-[#0F766E] hover:bg-[#D2EADF]"
            : "bg-[#ECE7DC] text-[#57534E] hover:bg-[#E0D8C8]"
        }`}
      >
        {checked ? (isZh ? "开启" : "On") : (isZh ? "关闭" : "Off")}
      </button>
    </div>
  );
}

function collectSceneWordsCacheStats(): { keyCount: number; sizeBytes: number } {
  let keyCount = 0;
  let sizeBytes = 0;
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key || !key.startsWith(SCENEWORDS_CACHE_PREFIX) || key === SETTINGS_STORE_KEY) {
      continue;
    }
    const value = localStorage.getItem(key) ?? "";
    keyCount += 1;
    sizeBytes += key.length + value.length;
  }
  return { keyCount, sizeBytes };
}

function clearSceneWordsCache(): void {
  const keysToRemove: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key) {
      continue;
    }
    if (key.startsWith(FIELD_STORAGE_PREFIX) || key === SESSION_STORAGE_KEY) {
      keysToRemove.push(key);
      continue;
    }
    if (key.startsWith(SCENEWORDS_CACHE_PREFIX) && key !== SETTINGS_STORE_KEY) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((key) => localStorage.removeItem(key));
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}
