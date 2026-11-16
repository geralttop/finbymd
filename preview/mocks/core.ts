import { ROOT } from "../fixtures";

const initialProvider =
  new URLSearchParams(window.location.search).get("provider") === "api" ? "api" : "ollama";

let chatSettings: Record<string, unknown> = {
  provider: initialProvider,
  baseUrl:
    initialProvider === "api"
      ? "https://api.example.com/v1"
      : "http://127.0.0.1:11434",
  model: "preview-model",
  apiKey: initialProvider === "api" ? "preview-key" : "",
};

export async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const params = new URLSearchParams(window.location.search);
  if (command === "load_chat_settings") {
    return chatSettings as T;
  }
  if (command === "save_chat_settings") {
    chatSettings = (args?.settings as Record<string, unknown>) ?? chatSettings;
    return null as T;
  }
  if (command === "load_data_dir") {
    if (params.get("welcome") === "1") {
      return null as T;
    }
    return ROOT as T;
  }
  if (command === "save_data_dir") {
    return (args?.path as string | undefined) ?? ROOT as T;
  }
  throw new Error(`Предпросмотр: неизвестная команда ${command}`);
}
