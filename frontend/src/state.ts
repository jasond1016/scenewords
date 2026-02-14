import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { RetryMode } from "./types";

export type LanguagePreference = "system" | "zh-CN" | "en";

export interface CreateDraft {
  provider: string;
  model: string;
  operation: string;
  prompt: string;
  negativePrompt: string;
  durationSec: number | null;
  resolution: string;
  fps: number | null;
  seed: number | null;
  providerOptions: Record<string, unknown>;
}

export interface AppSettingsState {
  gatewayToken: string;
  defaultProvider: string;
  defaultRatio: "16:9" | "9:16";
  defaultDurationSec: number;
  defaultQuality: string;
  defaultNegativePrompt: string;
  restoreLastSession: boolean;
  retryModeDefault: RetryMode;
  showBothRetryActions: boolean;
  notifyOnSuccess: boolean;
  notifyOnFailure: boolean;
  notifySound: boolean;
  notifyBadge: boolean;
  costMode: "provider_api" | "local_config";
  currency: string;
  showEstimatedCostPreSubmit: boolean;
  showActualCostPostDone: boolean;
  pricingVersion: string;
  savePromptHistory: boolean;
  historyRetentionDays: number;
  language: LanguagePreference;
  theme: "light" | "dark" | "system";
  pendingReuseDraft: CreateDraft | null;
  setSettings: (partial: Partial<AppSettingsState>) => void;
  setPendingReuseDraft: (draft: CreateDraft | null) => void;
}

const defaults: Omit<AppSettingsState, "setSettings" | "setPendingReuseDraft"> = {
  gatewayToken: "",
  defaultProvider: "",
  defaultRatio: "16:9",
  defaultDurationSec: 8,
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
  pricingVersion: "2026-02-07",
  savePromptHistory: true,
  historyRetentionDays: 90,
  language: "system",
  theme: "system",
  pendingReuseDraft: null,
};

export const useAppSettingsStore = create<AppSettingsState>()(
  persist(
    (set) => ({
      ...defaults,
      setSettings: (partial) =>
        set((state) => ({
          ...state,
          ...partial,
        })),
      setPendingReuseDraft: (draft) => set(() => ({ pendingReuseDraft: draft })),
    }),
    {
      name: "scenewords_gateway_settings_v1",
      partialize: (state) => ({
        gatewayToken: state.gatewayToken,
        defaultProvider: state.defaultProvider,
        defaultRatio: state.defaultRatio,
        defaultDurationSec: state.defaultDurationSec,
        defaultQuality: state.defaultQuality,
        defaultNegativePrompt: state.defaultNegativePrompt,
        restoreLastSession: state.restoreLastSession,
        retryModeDefault: state.retryModeDefault,
        showBothRetryActions: state.showBothRetryActions,
        notifyOnSuccess: state.notifyOnSuccess,
        notifyOnFailure: state.notifyOnFailure,
        notifySound: state.notifySound,
        notifyBadge: state.notifyBadge,
        costMode: state.costMode,
        currency: state.currency,
        showEstimatedCostPreSubmit: state.showEstimatedCostPreSubmit,
        showActualCostPostDone: state.showActualCostPostDone,
        pricingVersion: state.pricingVersion,
        savePromptHistory: state.savePromptHistory,
        historyRetentionDays: state.historyRetentionDays,
        language: state.language,
        theme: state.theme,
      }),
    },
  ),
);
