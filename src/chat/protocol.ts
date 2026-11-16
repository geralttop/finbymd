import type { ChatSettings } from "./settings";

export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ChatMessage = {
  role: ChatRole;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  toolName?: string;
};

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ModelResponse = {
  text: string;
  toolCalls: ToolCall[];
};

export type RequestSpec = {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
};

export function endpointFor(settings: ChatSettings): string {
  const base = settings.baseUrl.trim().replace(/\/+$/, "");
  if (base.length === 0) {
    throw new Error("Не задан адрес модели");
  }
  if (settings.provider === "ollama") {
    return /\/api\/chat$/.test(base) ? base : `${base}/api/chat`;
  }
  return /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
}

export function buildRequest(
  settings: ChatSettings,
  messages: ChatMessage[],
  tools: ToolDefinition[],
): RequestSpec {
  if (!settings.model.trim()) {
    throw new Error("Не задано имя модели");
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (settings.apiKey.trim()) {
    headers.Authorization = `Bearer ${settings.apiKey.trim()}`;
  }
  const wireTools = tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));

  if (settings.provider === "ollama") {
    const body: Record<string, unknown> = {
      model: settings.model.trim(),
      messages: messages.map(toOllamaMessage),
      stream: false,
    };
    if (wireTools.length > 0) {
      body.tools = wireTools;
    }
    return { url: endpointFor(settings), headers, body };
  }

  const body: Record<string, unknown> = {
    model: settings.model.trim(),
    messages: messages.map(toOpenAiMessage),
    stream: false,
  };
  if (wireTools.length > 0) {
    body.tools = wireTools;
    body.tool_choice = "auto";
  }
  return { url: endpointFor(settings), headers, body };
}

export function parseModelResponse(
  provider: ChatSettings["provider"],
  json: unknown,
): ModelResponse {
  const record = asRecord(json);
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const message =
    provider === "ollama"
      ? asRecord(record.message)
      : asRecord(asRecord(choices[0]).message);
  if (Object.keys(message).length === 0) {
    throw new Error("Модель вернула ответ без message");
  }
  const text = contentToString(message.content);
  const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const toolCalls: ToolCall[] = rawCalls.map((raw, index) => {
    const call = asRecord(raw);
    const fn = asRecord(call.function);
    const id = typeof call.id === "string" && call.id ? call.id : `call_${index}`;
    const name = typeof fn.name === "string" ? fn.name : "";
    return {
      id,
      name,
      arguments: argumentsObject(fn.arguments),
    };
  });
  if (!text && toolCalls.length === 0) {
    throw new Error("Модель вернула пустой ответ");
  }
  return { text, toolCalls };
}

function toOpenAiMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId ?? "",
      content: message.content,
    };
  }
  if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: {
          name: call.name,
          arguments: JSON.stringify(call.arguments),
        },
      })),
    };
  }
  return { role: message.role, content: message.content };
}

function toOllamaMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_name: message.toolName ?? "",
      content: message.content,
    };
  }
  if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: message.content,
      tool_calls: message.toolCalls.map((call, index) => ({
        type: "function",
        function: {
          index,
          name: call.name,
          arguments: call.arguments,
        },
      })),
    };
  }
  return { role: message.role, content: message.content };
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function contentToString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        const record = asRecord(part);
        if (typeof record.text === "string") {
          return record.text;
        }
        return "";
      })
      .join("");
  }
  return "";
}

function argumentsObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return {};
    }
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return asRecord(parsed);
    } catch {
      return {};
    }
  }
  return asRecord(value);
}
