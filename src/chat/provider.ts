import { fetch as httpFetch } from "@tauri-apps/plugin-http";
import {
  buildRequest,
  parseModelResponse,
  type ChatMessage,
  type ModelResponse,
  type ToolDefinition,
} from "./protocol";
import type { ChatSettings } from "./settings";

export type Fetcher = (
  url: string,
  init?: RequestInit & { connectTimeout?: number },
) => Promise<Response>;

const DEFAULT_TIMEOUT = 120_000;

export async function requestChat(
  settings: ChatSettings,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  fetcher: Fetcher = httpFetch,
  timeoutMs = DEFAULT_TIMEOUT,
): Promise<ModelResponse> {
  const spec = buildRequest(settings, messages, tools);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetcher(spec.url, {
      method: "POST",
      headers: spec.headers,
      body: JSON.stringify(spec.body),
      signal: controller.signal,
      connectTimeout: 20_000,
    });
  } catch (error) {
    throw new Error(networkError(error, settings));
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(httpError(response.status, text));
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Модель вернула не JSON: ${text.slice(0, 300)}`);
  }
  return parseModelResponse(settings.provider, json);
}

export async function testConnection(
  settings: ChatSettings,
  fetcher: Fetcher = httpFetch,
): Promise<string> {
  const result = await requestChat(
    settings,
    [{ role: "user", content: "Ответь одним словом: работает" }],
    [],
    fetcher,
    90_000,
  );
  if (result.toolCalls.length > 0) {
    throw new Error("Модель вызвала инструмент вместо ответа. Проверьте, что это обычная чат-модель.");
  }
  return result.text.trim() || "Подключение работает";
}

function httpError(status: number, body: string): string {
  const snippet = body.replace(/\s+/g, " ").trim().slice(0, 300);
  if (status === 401 || status === 403) {
    return "Ключ API не принят. Проверьте ключ и права доступа.";
  }
  if (status === 404) {
    return `Адрес или модель не найдены (404). Проверьте base URL и имя модели.${snippet ? ` Ответ: ${snippet}` : ""}`;
  }
  if (status === 429) {
    return "Слишком много запросов или закончилась квота. Подождите и попробуйте снова.";
  }
  if (status >= 500) {
    return `Сервис модели временно недоступен (${status}).${snippet ? ` ${snippet}` : ""}`;
  }
  return `Модель ответила ${status}.${snippet ? ` ${snippet}` : ""}`;
}

function networkError(error: unknown, settings: ChatSettings): string {
  const name = (error as { name?: string } | null)?.name ?? "";
  const raw = error instanceof Error ? error.message : String(error);
  if (name === "AbortError" || /aborted|abort/i.test(raw)) {
    return "Модель не ответила вовремя. Увеличьте таймаут или проверьте сервис.";
  }
  if (/scope|not allowed|not permitted/i.test(raw)) {
    return "Адрес не разрешён для HTTP-запросов. Проверьте настройки доступа Tauri.";
  }
  if (/ECONNREFUSED|connection refused|Network request failed|fetch failed/i.test(raw)) {
    return settings.provider === "ollama"
      ? `Ollama не отвечает на ${settings.baseUrl}. Запущен ли \`ollama serve\` и скачана ли модель?`
      : `Нет связи с API ${settings.baseUrl}. Проверьте адрес и интернет.`;
  }
  return `Не удалось связаться с моделью: ${raw}`;
}
