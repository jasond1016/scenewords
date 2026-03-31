import { useEffect, useMemo, useState } from "react";
import { ArrowCounterClockwise, Trash } from "@phosphor-icons/react";
import { useI18n } from "../i18n";
import type { LanguagePreference } from "../state";
import { useAppSettingsStore } from "../state";
import { FIELD_STORAGE_PREFIX, SESSION_STORAGE_KEY } from "../utils";
import type { ProviderInfo, RetryMode } from "../types";

interface Props {
  pricingVersion: string | null;
  providers: ProviderInfo[];
}

type SettingCategory =
  | "language_gateway"
  | "privacy_storage";

const SETTINGS_STORE_KEY = "scenewords_gateway_settings_v1";
const SCENEWORDS_CACHE_PREFIX = "scenewords_";
const HIDDEN_VIDEO_PROVIDER_IDS = new Set(["veo31_rightcodes"]);

export function SettingsPage(props: Props) {
  const { locale, t } = useI18n();
  const isZh = locale === "zh-CN";
  const settings = useAppSettingsStore();
  const [hint, setHint] = useState("");
  const [showGatewayToken, setShowGatewayToken] = useState(false);
  const [activeCategory, setActiveCategory] = useState<SettingCategory>("language_gateway");
  const [cacheRevision, setCacheRevision] = useState(0);
  const [confirmRestore, setConfirmRestore] = useState(false);

  const imageProviders = useMemo(
    () => props.providers.filter((provider) => isImageProviderType(provider.type)),
    [props.providers],
  );
  const videoProviders = useMemo(
    () =>
      props.providers.filter(
        (provider) =>
          !isImageProviderType(provider.type) && !HIDDEN_VIDEO_PROVIDER_IDS.has(provider.id),
      ),
    [props.providers],
  );

  useEffect(() => {
    if (!props.pricingVersion || props.pricingVersion === settings.pricingVersion) {
      return;
    }
    settings.setSettings({ pricingVersion: props.pricingVersion });
  }, [props.pricingVersion, settings.pricingVersion, settings.setSettings]);

  useEffect(() => {
    if (!settings.defaultImageProvider) {
      return;
    }
    if (!imageProviders.some((provider) => provider.id === settings.defaultImageProvider)) {
      settings.setSettings({ defaultImageProvider: "" });
    }
  }, [imageProviders, settings.defaultImageProvider, settings.setSettings]);

  useEffect(() => {
    if (!settings.defaultVideoProvider) {
      return;
    }
    if (!videoProviders.some((provider) => provider.id === settings.defaultVideoProvider)) {
      settings.setSettings({ defaultVideoProvider: "" });
    }
  }, [settings.defaultVideoProvider, settings.setSettings, videoProviders]);

  const sectionIds: Record<SettingCategory, string> = {
    language_gateway: "settings_language_gateway",
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

  const jumpToCategory = (category: SettingCategory) => {
    setActiveCategory(category);
    const element = document.getElementById(sectionIds[category]);
    if (!element) {
      return;
    }
    element.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const handleRestoreDefaults = () => {
    if (!confirmRestore) {
      setConfirmRestore(true);
      return;
    }
    setConfirmRestore(false);

    settings.setSettings({
      language: "system",
      defaultImageProvider: "",
      defaultVideoProvider: "",
      defaultRatio: "16:9",
      defaultDurationSec: 8,
      defaultQuality: "standard",
      defaultNegativePrompt: "",
      restoreLastSession: true,
      retryModeDefault: "same_seed",
      showBothRetryActions: true,
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

  const clearLocalCache = () => {
    clearSceneWordsCache();
    setCacheRevision((current) => current + 1);
    setHint(t("settings.clearedLocalCache"));
  };

  return (
    <div className="flex w-full flex-col gap-6">
      {/* Category pills + restore defaults */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="segment-group flex-wrap">
          <CategoryButton
            label={isZh ? "语言与网关" : "Language & Gateway"}
            active={activeCategory === "language_gateway"}
            onClick={() => jumpToCategory("language_gateway")}
          />
          <CategoryButton
            label={t("settings.privacyStorage")}
            active={activeCategory === "privacy_storage"}
            onClick={() => jumpToCategory("privacy_storage")}
          />
        </div>
        <div className="flex items-center gap-2">
          {confirmRestore ? (
            <>
              <button type="button" onClick={handleRestoreDefaults} className="btn-danger text-xs">
                {isZh ? "确认恢复" : "Confirm"}
              </button>
              <button type="button" onClick={() => setConfirmRestore(false)} className="btn-ghost text-xs">
                {t("common.close")}
              </button>
            </>
          ) : (
            <button type="button" onClick={handleRestoreDefaults} className="btn-ghost text-xs">
              <ArrowCounterClockwise size={13} />
              {isZh ? "恢复默认" : "Restore"}
            </button>
          )}
        </div>
      </div>

      <section className="flex flex-col gap-4">
        <div className="flex min-w-0 flex-col gap-4">
          <section
            id={sectionIds.language_gateway}
            className="card"
          >
            <h3 className="m-0 text-heading">
              {isZh ? "语言与网关" : "Language & Gateway"}
            </h3>
            <div className="mt-3 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-raised px-3 py-2">
                <span className="text-sm font-medium text-[var(--c-text)]">{t("settings.language")}</span>
                <LanguageSwitcher
                  value={settings.language}
                  onChange={(value) => settings.setSettings({ language: value })}
                  t={t}
                />
              </div>

              <div className="rounded-xl bg-surface-raised p-4">
                <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-label">
                    Gateway · Bearer Token
                  </span>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                        settings.gatewayToken.trim()
                          ? "bg-success-bg text-success-text"
                          : "bg-[var(--c-surface-inset)] text-[var(--c-text-secondary)]"
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
                      className="rounded-full bg-[var(--c-surface-inset)] px-2.5 py-1 text-[10px] font-semibold text-[var(--c-text-secondary)] transition-colors hover:bg-[var(--c-border)]"
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
                  className="input-base"
                />
              </div>
            </div>
          </section>

          <details className="card">
            <summary className="cursor-pointer text-sm font-semibold text-[var(--c-text-secondary)]">
              {isZh ? "高级偏好（重试与成本）" : "Advanced Preferences (Retry & Cost)"}
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <SettingField label={t("settings.retryDefault")}>
                <select
                  value={settings.retryModeDefault}
                  onChange={(event) =>
                    settings.setSettings({ retryModeDefault: event.target.value as RetryMode })
                  }
                  className="w-full input-base"
                >
                  <option value="same_seed">{t("settings.sameSeed")}</option>
                  <option value="new_seed">{t("settings.newSeed")}</option>
                </select>
              </SettingField>

              <SettingField label={t("settings.currency")}>
                <input
                  value={settings.currency}
                  onChange={(event) => settings.setSettings({ currency: event.target.value })}
                  className="w-full input-base"
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
                  className="w-full input-base"
                >
                  <option value="provider_api">{t("settings.costModeProviderApi")}</option>
                  <option value="local_config">{t("settings.costModeLocalConfig")}</option>
                </select>
              </SettingField>

              <SettingField label={t("settings.pricingVersion")}>
                <input
                  value={settings.pricingVersion}
                  onChange={(event) => settings.setSettings({ pricingVersion: event.target.value })}
                  className="w-full input-base"
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
        <section
          id={sectionIds.privacy_storage}
          className="card"
        >
          <h3 className="m-0 text-heading">{t("settings.privacyStorage")}</h3>
          <div className="mt-3 flex flex-col gap-2">
            <ToggleRow
              label={t("settings.restoreLastSession")}
              checked={settings.restoreLastSession}
              onChange={(checked) => settings.setSettings({ restoreLastSession: checked })}
              isZh={isZh}
            />
            <ToggleRow
              label={t("settings.savePromptHistory")}
              checked={settings.savePromptHistory}
              onChange={(checked) => settings.setSettings({ savePromptHistory: checked })}
              isZh={isZh}
            />

            <div className="flex items-center justify-between gap-2 rounded-xl bg-surface-raised px-3 py-2">
              <span className="text-sm font-medium text-[var(--c-text)]">{t("settings.historyRetentionDays")}</span>
              <input
                type="number"
                min={1}
                step={1}
                value={settings.historyRetentionDays}
                onChange={(event) =>
                  settings.setSettings({ historyRetentionDays: Number(event.target.value) || 90 })
                }
                className="w-20 input-base text-right"
              />
            </div>

            <div className="rounded-xl border border-border bg-warning-bg p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-warning-text">
                  {isZh ? "本地缓存摘要" : "Local Cache Summary"}
                </span>
                <span className="rounded-full bg-warning-bg px-2 py-1 text-[10px] font-semibold text-warning-text">
                  {historyStatusLabel}
                </span>
              </div>
              <p className="m-0 text-[11px] text-warning-text">
                {isZh ? "缓存键数量" : "Cache keys"}: {cacheStats.keyCount}
              </p>
              <p className="mb-0 mt-0.5 text-[11px] text-warning-text">
                {isZh ? "缓存占用" : "Cache size"}: {formatBytes(cacheStats.sizeBytes)}
              </p>
              <button
                type="button"
                onClick={clearLocalCache}
                className="btn-danger mt-2 text-xs"
              >
                <Trash size={13} />
                {t("settings.clearLocalCache")}
              </button>
            </div>
          </div>
        </section>
      </section>

      {hint ? <p className="m-0 text-xs text-[var(--c-text-tertiary)]">{hint}</p> : null}
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
      className={`segment-item ${active ? "segment-active" : ""}`}
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
      <span className="text-label mb-1.5 block">{label}</span>
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
    <div className="segment-group">
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            type="button"
            key={option.value}
            onClick={() => onChange(option.value)}
            className={`segment-item ${active ? "segment-active" : ""}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
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
    <div className="flex items-center justify-between gap-2 rounded-xl bg-surface-raised px-4 py-3">
      <span className="text-sm text-[var(--c-text)]">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-all duration-200 ${
          checked
            ? "bg-success-bg text-success-text hover:opacity-80"
            : "bg-[var(--c-surface-inset)] text-[var(--c-text-secondary)] hover:bg-[var(--c-border)]"
        }`}
      >
        {checked ? (isZh ? "开启" : "On") : (isZh ? "关闭" : "Off")}
      </button>
    </div>
  );
}

function isImageProviderType(providerType: string): boolean {
  return providerType.toLowerCase().includes("image");
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
