import type { FinbymdSettings } from "./settings";

export const DEFAULT_SETTINGS: FinbymdSettings = {
  folder: "финансы",
  chat: {
    provider: "ollama",
    baseUrl: "http://127.0.0.1:11434",
    model: "",
  },
};
