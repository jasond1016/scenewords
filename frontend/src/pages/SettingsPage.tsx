import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { useAppSettingsStore } from "../state";
import { SESSION_STORAGE_KEY } from "../utils";
import type { RetryMode } from "../types";

interface Props {
  pricingVersion: string | null;
}

export function SettingsPage(props: Props) {
  const { t } = useI18n();
  const settings = useAppSettingsStore();
  const [hint, setHint] = useState("");

  useEffect(() => {
    if (!props.pricingVersion || props.pricingVersion === settings.pricingVersion) {
      return;
    }
    settings.setSettings({ pricingVersion: props.pricingVersion });
  }, [props.pricingVersion, settings.pricingVersion, settings.setSettings]);

  return (
    <section className="panel settings-page">
      <div className="panel-header">
        <h2>{t("settings.title")}</h2>
        <p>{t("settings.subtitle")}</p>
      </div>

      <h3>{t("settings.language")}</h3>
      <div className="grid-2">
        <label>
          {t("settings.language")}
          <select
            value={settings.language}
            onChange={(event) =>
              settings.setSettings({ language: event.target.value as "system" | "zh-CN" | "en" })
            }
          >
            <option value="system">{t("settings.languageSystem")}</option>
            <option value="zh-CN">{t("settings.languageZhCN")}</option>
            <option value="en">{t("settings.languageEn")}</option>
          </select>
        </label>
      </div>

      <h3>{t("settings.generationDefaults")}</h3>
      <div className="grid-2">
        <label>
          {t("settings.defaultProvider")}
          <input
            value={settings.defaultProvider}
            onChange={(event) => settings.setSettings({ defaultProvider: event.target.value })}
          />
        </label>
        <label>
          {t("settings.defaultRatio")}
          <select
            value={settings.defaultRatio}
            onChange={(event) =>
              settings.setSettings({ defaultRatio: event.target.value as "16:9" | "9:16" })
            }
          >
            <option value="16:9">16:9</option>
            <option value="9:16">9:16</option>
          </select>
        </label>
        <label>
          {t("settings.defaultDuration")}
          <input
            type="number"
            min={1}
            step={1}
            value={settings.defaultDurationSec}
            onChange={(event) =>
              settings.setSettings({ defaultDurationSec: Number(event.target.value) || 8 })
            }
          />
        </label>
        <label>
          {t("settings.defaultQuality")}
          <input
            value={settings.defaultQuality}
            onChange={(event) => settings.setSettings({ defaultQuality: event.target.value })}
          />
        </label>
      </div>
      <label>
        {t("settings.defaultNegativePrompt")}
        <textarea
          rows={3}
          value={settings.defaultNegativePrompt}
          onChange={(event) =>
            settings.setSettings({ defaultNegativePrompt: event.target.value })
          }
        />
      </label>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={settings.restoreLastSession}
          onChange={(event) =>
            settings.setSettings({ restoreLastSession: event.target.checked })
          }
        />
        {t("settings.restoreLastSession")}
      </label>

      <h3>{t("settings.retryBehavior")}</h3>
      <div className="grid-2">
        <label>
          {t("settings.retryDefault")}
          <select
            value={settings.retryModeDefault}
            onChange={(event) =>
              settings.setSettings({ retryModeDefault: event.target.value as RetryMode })
            }
          >
            <option value="same_seed">{t("settings.sameSeed")}</option>
            <option value="new_seed">{t("settings.newSeed")}</option>
          </select>
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.showBothRetryActions}
            onChange={(event) =>
              settings.setSettings({ showBothRetryActions: event.target.checked })
            }
          />
          {t("settings.showBothRetryActions")}
        </label>
      </div>

      <h3>{t("settings.notifications")}</h3>
      <div className="grid-2">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.notifyOnSuccess}
            onChange={(event) => settings.setSettings({ notifyOnSuccess: event.target.checked })}
          />
          {t("settings.notifySuccess")}
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.notifyOnFailure}
            onChange={(event) => settings.setSettings({ notifyOnFailure: event.target.checked })}
          />
          {t("settings.notifyFailure")}
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.notifySound}
            onChange={(event) => settings.setSettings({ notifySound: event.target.checked })}
          />
          {t("settings.notifySound")}
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.notifyBadge}
            onChange={(event) => settings.setSettings({ notifyBadge: event.target.checked })}
          />
          {t("settings.notifyBadge")}
        </label>
      </div>
      <button
        type="button"
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

      <h3>{t("settings.costPricing")}</h3>
      <div className="grid-2">
        <label>
          {t("settings.costMode")}
          <select
            value={settings.costMode}
            onChange={(event) =>
              settings.setSettings({
                costMode: event.target.value as "provider_api" | "local_config",
              })
            }
          >
            <option value="provider_api">{t("settings.costModeProviderApi")}</option>
            <option value="local_config">{t("settings.costModeLocalConfig")}</option>
          </select>
        </label>
        <label>
          {t("settings.currency")}
          <input
            value={settings.currency}
            onChange={(event) => settings.setSettings({ currency: event.target.value })}
          />
        </label>
        <label>
          {t("settings.pricingVersion")}
          <input
            value={settings.pricingVersion}
            onChange={(event) => settings.setSettings({ pricingVersion: event.target.value })}
          />
        </label>
      </div>
      <div className="grid-2">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.showEstimatedCostPreSubmit}
            onChange={(event) =>
              settings.setSettings({ showEstimatedCostPreSubmit: event.target.checked })
            }
          />
          {t("settings.showEstimatedBeforeSubmit")}
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.showActualCostPostDone}
            onChange={(event) =>
              settings.setSettings({ showActualCostPostDone: event.target.checked })
            }
          />
          {t("settings.showActualAfterDone")}
        </label>
      </div>

      <h3>{t("settings.privacyStorage")}</h3>
      <div className="grid-2">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.savePromptHistory}
            onChange={(event) => settings.setSettings({ savePromptHistory: event.target.checked })}
          />
          {t("settings.savePromptHistory")}
        </label>
        <label>
          {t("settings.historyRetentionDays")}
          <input
            type="number"
            min={1}
            step={1}
            value={settings.historyRetentionDays}
            onChange={(event) =>
              settings.setSettings({ historyRetentionDays: Number(event.target.value) || 90 })
            }
          />
        </label>
      </div>
      <div className="inline-actions">
        <button
          type="button"
          onClick={() => {
            localStorage.removeItem(SESSION_STORAGE_KEY);
            setHint(t("settings.clearedLocalCache"));
          }}
        >
          {t("settings.clearLocalCache")}
        </button>
      </div>
      <p className="hint">{hint}</p>
    </section>
  );
}
