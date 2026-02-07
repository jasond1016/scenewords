import { useEffect, useState } from "react";
import { useAppSettingsStore } from "../state";
import { SESSION_STORAGE_KEY } from "../utils";
import type { RetryMode } from "../types";

interface Props {
  pricingVersion: string | null;
}

export function SettingsPage(props: Props) {
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
        <h2>Settings</h2>
        <p>默认值、通知与成本展示策略。</p>
      </div>

      <h3>Generation Defaults</h3>
      <div className="grid-2">
        <label>
          Default Provider
          <input
            value={settings.defaultProvider}
            onChange={(event) => settings.setSettings({ defaultProvider: event.target.value })}
          />
        </label>
        <label>
          Default Ratio
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
          Default Duration (s)
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
          Default Quality
          <input
            value={settings.defaultQuality}
            onChange={(event) => settings.setSettings({ defaultQuality: event.target.value })}
          />
        </label>
      </div>
      <label>
        Default Negative Prompt
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
        Restore Last Session
      </label>

      <h3>Retry Behavior</h3>
      <div className="grid-2">
        <label>
          Retry Default
          <select
            value={settings.retryModeDefault}
            onChange={(event) =>
              settings.setSettings({ retryModeDefault: event.target.value as RetryMode })
            }
          >
            <option value="same_seed">Same Seed</option>
            <option value="new_seed">New Seed</option>
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
          Show Both Retry Actions
        </label>
      </div>

      <h3>Notifications</h3>
      <div className="grid-2">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.notifyOnSuccess}
            onChange={(event) => settings.setSettings({ notifyOnSuccess: event.target.checked })}
          />
          Notify Success
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.notifyOnFailure}
            onChange={(event) => settings.setSettings({ notifyOnFailure: event.target.checked })}
          />
          Notify Failure
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.notifySound}
            onChange={(event) => settings.setSettings({ notifySound: event.target.checked })}
          />
          Notify Sound
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.notifyBadge}
            onChange={(event) => settings.setSettings({ notifyBadge: event.target.checked })}
          />
          Notify Badge
        </label>
      </div>
      <button
        type="button"
        onClick={async () => {
          if (!("Notification" in window)) {
            setHint("当前浏览器不支持通知。");
            return;
          }
          const permission = await Notification.requestPermission();
          setHint(`通知权限：${permission}`);
        }}
      >
        Request Notification Permission
      </button>

      <h3>Cost & Pricing</h3>
      <div className="grid-2">
        <label>
          Cost Mode
          <select
            value={settings.costMode}
            onChange={(event) =>
              settings.setSettings({
                costMode: event.target.value as "provider_api" | "local_config",
              })
            }
          >
            <option value="provider_api">Provider API</option>
            <option value="local_config">Local Config</option>
          </select>
        </label>
        <label>
          Currency
          <input
            value={settings.currency}
            onChange={(event) => settings.setSettings({ currency: event.target.value })}
          />
        </label>
        <label>
          Pricing Version
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
          Show Estimated Cost Before Submit
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.showActualCostPostDone}
            onChange={(event) =>
              settings.setSettings({ showActualCostPostDone: event.target.checked })
            }
          />
          Show Actual Cost After Done
        </label>
      </div>

      <h3>Privacy & Storage</h3>
      <div className="grid-2">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={settings.savePromptHistory}
            onChange={(event) => settings.setSettings({ savePromptHistory: event.target.checked })}
          />
          Save Prompt History
        </label>
        <label>
          History Retention Days
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
            setHint("已清理本地会话缓存。");
          }}
        >
          Clear Local Cache
        </button>
      </div>
      <p className="hint">{hint}</p>
    </section>
  );
}
