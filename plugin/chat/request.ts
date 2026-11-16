import { requestUrl } from "obsidian";
import {
  buildRequest,
  parseModelResponse,
  type ChatMessage,
  type ModelResponse,
  type ToolDefinition,
} from "../../src/chat/protocol";
import type { ChatSettings } from "../../src/chat/settings";

export async function requestChat(
  settings: ChatSettings,
  messages: ChatMessage[],
  tools: ToolDefinition[],
): Promise<ModelResponse> {
  const spec = buildRequest(settings, messages, tools);
  const response = await requestUrl({
    url: spec.url,
    method: "POST",
    headers: spec.headers,
    body: JSON.stringify(spec.body),
    throw: false,
  });
  if (response.status >= 400) {
    const text = response.text.slice(0, 300);
    throw new Error(`Модель ответила ${response.status}: ${text}`);
  }
  return parseModelResponse(settings.provider, response.json as unknown);
}
