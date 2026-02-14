import { useEffect, useMemo, useState } from "react";
import { useI18n } from "../i18n";
import { useAppSettingsStore } from "../state";
import { SESSION_STORAGE_KEY, supportedDurationOptions } from "../utils";
import type { ProviderInfo, RetryMode } from "../types";

interface Props {
  pricingVersion: string | null;
  providers: ProviderInfo[];
}

export function SettingsPage(props: Props) {
  const { t } = useI18n();
  const settings = useAppSettingsStore();
  const [hint, setHint] = useState("");
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

  return (
    <div className="max-w-2xl mx-auto px-6 md:px-10 py-8 flex flex-col gap-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white m-0">{t("settings.title")}</h2>
        <p className="text-sm text-gray-400 dark:text-gray-500 m-0 mt-1">{t("settings.subtitle")}</p>
      </div>

      {/* Language */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 m-0">{t("settings.language")}</h3>
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1 text-xs text-gray-500 dark:text-gray-400">
            {t("settings.language")}
            <select
              value={settings.language}
              onChange={(event) =>
                settings.setSettings({ language: event.target.value as "system" | "zh-CN" | "en" })
              }
              className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-300 dark:focus:ring-gray-600 dark:text-gray-200"
            >
              <option value="system">{t("settings.languageSystem")}</option>
              <option value="zh-CN">{t("settings.languageZhCN")}</option>
              <option value="en">{t("settings.languageEn")}</option>
            </select>
          </label>
        </div>
      </section>

      {/* Gateway */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 m-0">{t("settings.gateway")}</h3>
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            {t("settings.gatewayToken")}
            <input
              type="password"
              value={settings.gatewayToken}
              onChange={(event) => settings.setSettings({ gatewayToken: event.target.value })}
              placeholder={t("settings.gatewayTokenPlaceholder")}
              className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-300 dark:focus:ring-gray-600 dark:text-gray-200"
            />
          </label>
        </div>
      </section>

      {/* Generation Defaults */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 m-0">{t("settings.generationDefaults")}</h3>
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            {t("settings.defaultProvider")}
            <select
              value={settings.defaultProvider}
              onChange={(event) => settings.setSettings({ defaultProvider: event.target.value })}
              className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-300 dark:focus:ring-gray-600 dark:text-gray-200"
            >
              <option value="">{t("settings.defaultProviderAuto")}</option>
              {props.providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.display_name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            {t("settings.defaultRatio")}
            <select
              value={settings.defaultRatio}
              onChange={(event) =>
                settings.setSettings({ defaultRatio: event.target.value as "16:9" | "9:16" })
              }
              className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-300 dark:focus:ring-gray-600 dark:text-gray-200"
            >
              <option value="16:9">16:9</option>
              <option value="9:16">9:16</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            {t("settings.defaultDuration")}
            <select
              value={String(settings.defaultDurationSec)}
              onChange={(event) =>
                settings.setSettings({ defaultDurationSec: Number(event.target.value) || 8 })
              }
              className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-300 dark:focus:ring-gray-600 dark:text-gray-200"
            >
              {durationOptions.map((seconds) => (
                <option key={seconds} value={String(seconds)}>
                  {seconds}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            {t("settings.defaultQuality")}
            <input
              value={settings.defaultQuality}
              onChange={(event) => settings.setSettings({ defaultQuality: event.target.value })}
              className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-300 dark:focus:ring-gray-600 dark:text-gray-200"
            />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-xs text-gray-500">
          {t("settings.defaultNegativePrompt")}
          <textarea
            rows={3}
            value={settings.defaultNegativePrompt}
            onChange={(event) =>
              settings.setSettings({ defaultNegativePrompt: event.target.value })
            }
            className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-300 dark:focus:ring-gray-600 dark:text-gray-200 resize-y"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.restoreLastSession}
            onChange={(event) =>
              settings.setSettings({ restoreLastSession: event.target.checked })
            }
            className="rounded"
          />
          {t("settings.restoreLastSession")}
        </label>
      </section>

      {/* Retry Behavior */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 m-0">{t("settings.retryBehavior")}</h3>
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            {t("settings.retryDefault")}
            <select
              value={settings.retryModeDefault}
              onChange={(event) =>
                settings.setSettings({ retryModeDefault: event.target.value as RetryMode })
              }
              className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-300 dark:focus:ring-gray-600 dark:text-gray-200"
            >
              <option value="same_seed">{t("settings.sameSeed")}</option>
              <option value="new_seed">{t("settings.newSeed")}</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer self-end pb-1">
            <input
              type="checkbox"
              checked={settings.showBothRetryActions}
              onChange={(event) =>
                settings.setSettings({ showBothRetryActions: event.target.checked })
              }
              className="rounded"
            />
            {t("settings.showBothRetryActions")}
          </label>
        </div>
      </section>

      {/* Notifications */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 m-0">{t("settings.notifications")}</h3>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.notifyOnSuccess}
              onChange={(event) => settings.setSettings({ notifyOnSuccess: event.target.checked })}
              className="rounded"
            />
            {t("settings.notifySuccess")}
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.notifyOnFailure}
              onChange={(event) => settings.setSettings({ notifyOnFailure: event.target.checked })}
              className="rounded"
            />
            {t("settings.notifyFailure")}
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.notifySound}
              onChange={(event) => settings.setSettings({ notifySound: event.target.checked })}
              className="rounded"
            />
            {t("settings.notifySound")}
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.notifyBadge}
              onChange={(event) => settings.setSettings({ notifyBadge: event.target.checked })}
              className="rounded"
            />
            {t("settings.notifyBadge")}
          </label>
        </div>
        <button
          type="button"
          className="self-start px-4 py-1.5 text-sm font-medium rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors dark:text-gray-200"
          onClick={async () => {
            if (!("Notification" in window)) {
              setHint(t("settings.notificationUnsupported"));
              return;
            }
            const permission = await Notification.requestPermission();
            setHint(t("settings.notificationPermission", { permission }));
          }}
        >
          {t("settings.requestNotificationPermission")}
        </button>
      </section>

      {/* Cost & Pricing */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 m-0">{t("settings.costPricing")}</h3>
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            {t("settings.costMode")}
            <select
              value={settings.costMode}
              onChange={(event) =>
                settings.setSettings({
                  costMode: event.target.value as "provider_api" | "local_config",
                })
              }
              className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-300 dark:focus:ring-gray-600 dark:text-gray-200"
            >
              <option value="provider_api">{t("settings.costModeProviderApi")}</option>
              <option value="local_config">{t("settings.costModeLocalConfig")}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            {t("settings.currency")}
            <input
              value={settings.currency}
              onChange={(event) => settings.setSettings({ currency: event.target.value })}
              className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-300 dark:focus:ring-gray-600 dark:text-gray-200"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            {t("settings.pricingVersion")}
            <input
              value={settings.pricingVersion}
              onChange={(event) => settings.setSettings({ pricingVersion: event.target.value })}
              className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-300 dark:focus:ring-gray-600 dark:text-gray-200"
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.showEstimatedCostPreSubmit}
              onChange={(event) =>
                settings.setSettings({ showEstimatedCostPreSubmit: event.target.checked })
              }
              className="rounded"
            />
            {t("settings.showEstimatedBeforeSubmit")}
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.showActualCostPostDone}
              onChange={(event) =>
                settings.setSettings({ showActualCostPostDone: event.target.checked })
              }
              className="rounded"
            />
            {t("settings.showActualAfterDone")}
          </label>
        </div>
      </section>

      {/* Privacy & Storage */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 m-0">{t("settings.privacyStorage")}</h3>
        <div className="grid grid-cols-2 gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.savePromptHistory}
              onChange={(event) => settings.setSettings({ savePromptHistory: event.target.checked })}
              className="rounded"
            />
            {t("settings.savePromptHistory")}
          </label>
          <label className="flex flex-col gap-1 text-xs text-gray-500">
            {t("settings.historyRetentionDays")}
            <input
              type="number"
              min={1}
              step={1}
              value={settings.historyRetentionDays}
              onChange={(event) =>
                settings.setSettings({ historyRetentionDays: Number(event.target.value) || 90 })
              }
              className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-300 dark:focus:ring-gray-600 dark:text-gray-200"
            />
          </label>
        </div>
        <button
          type="button"
          className="self-start px-4 py-1.5 text-sm font-medium rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-red-400 hover:text-red-600"
          onClick={() => {
            localStorage.removeItem(SESSION_STORAGE_KEY);
            setHint(t("settings.clearedLocalCache"));
          }}
        >
          {t("settings.clearLocalCache")}
        </button>
      </section>

      {hint ? <p className="text-xs text-gray-400 m-0">{hint}</p> : null}
    </div>
  );
}
