import { invoke } from "@tauri-apps/api/core";

export type ChatProvider = "ollama" | "api";

export type ChatSettings = {
  provider: ChatProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
};

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  provider: "ollama",
  baseUrl: "http://127.0.0.1:11434",
  model: "",
  apiKey: "",
};

export const PROVIDER_DEFAULTS: Record<ChatProvider, { baseUrl: string; label: string }> = {
  ollama: { baseUrl: "http://127.0.0.1:11434", label: "Ollama" },
  api: { baseUrl: "https://api.openai.com/v1", label: "Внешний API" },
};

export function normalizeSettings(raw: Partial<ChatSettings> | null | undefined): ChatSettings {
  if (!raw) {
    return { ...DEFAULT_CHAT_SETTINGS };
  }
  const provider: ChatProvider = raw.provider === "api" ? "api" : "ollama";
  return {
    provider,
    baseUrl: (raw.baseUrl ?? PROVIDER_DEFAULTS[provider].baseUrl).trim(),
    model: (raw.model ?? "").trim(),
    apiKey: raw.apiKey ?? "",
  };
}

export async function loadChatSettings(): Promise<ChatSettings> {
  try {
    const saved = await invoke<Partial<ChatSettings> | null>("load_chat_settings");
    return normalizeSettings(saved);
  } catch {
    return { ...DEFAULT_CHAT_SETTINGS };
  }
}

export async function saveChatSettings(settings: ChatSettings): Promise<void> {
  await invoke("save_chat_settings", { settings: normalizeSettings(settings) });
}

export function isChatConfigured(settings: ChatSettings): boolean {
  return settings.baseUrl.trim().length > 0 && settings.model.trim().length > 0;
}

export function providerLabel(settings: ChatSettings): string {
  return settings.provider === "ollama" ? "Ollama" : "API";
}
