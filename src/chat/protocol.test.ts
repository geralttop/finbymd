import { describe, expect, it } from "vitest";
import {
  buildRequest,
  endpointFor,
  parseModelResponse,
  type ChatMessage,
  type ToolDefinition,
} from "./protocol";
import type { ChatSettings } from "./settings";

const tool: ToolDefinition = {
  name: "add_expense",
  description: "Add an expense",
  parameters: {
    type: "object",
    required: ["amount"],
    properties: { amount: { type: "string" } },
  },
};

const api: ChatSettings = {
  provider: "api",
  baseUrl: "https://api.example.com/v1/",
  model: "test-model",
  apiKey: "secret",
};

const ollama: ChatSettings = {
  provider: "ollama",
  baseUrl: "http://127.0.0.1:11434",
  model: "qwen3",
  apiKey: "",
};

const messages: ChatMessage[] = [
  { role: "system", content: "rules" },
  { role: "user", content: "кофе за 5 BYN" },
  {
    role: "assistant",
    content: "",
    toolCalls: [{ id: "call_1", name: "add_expense", arguments: { amount: "5.00" } }],
  },
  {
    role: "tool",
    content: "готово",
    toolCallId: "call_1",
    toolName: "add_expense",
  },
];

describe("endpointFor", () => {
  it("builds OpenAI-compatible and Ollama endpoints", () => {
    expect(endpointFor(api)).toBe("https://api.example.com/v1/chat/completions");
    expect(endpointFor(ollama)).toBe("http://127.0.0.1:11434/api/chat");
    expect(endpointFor({ ...ollama, baseUrl: "http://127.0.0.1:11434/api/chat" })).toBe(
      "http://127.0.0.1:11434/api/chat",
    );
  });

  it("rejects an empty address", () => {
    expect(() => endpointFor({ ...api, baseUrl: "  " })).toThrow();
  });
});

describe("buildRequest", () => {
  it("builds an OpenAI request with bearer auth and tool calls", () => {
    const request = buildRequest(api, messages, [tool]);
    expect(request.headers.Authorization).toBe("Bearer secret");
    expect(request.body.model).toBe("test-model");
    expect(request.body.stream).toBe(false);
    const wire = request.body.messages as Record<string, unknown>[];
    const assistant = wire[2];
    expect(assistant.role).toBe("assistant");
    expect((assistant.tool_calls as { function: { arguments: string } }[])[0].function.arguments).toBe(
      '{"amount":"5.00"}',
    );
    expect(wire[3]).toMatchObject({ role: "tool", tool_call_id: "call_1", content: "готово" });
  });

  it("does not send a key to local Ollama", () => {
    const request = buildRequest(ollama, messages, [tool]);
    expect(request.headers.Authorization).toBeUndefined();
    const wire = request.body.messages as Record<string, unknown>[];
    expect(wire[3]).toMatchObject({ role: "tool", tool_name: "add_expense" });
    const assistant = wire[2] as { tool_calls: { function: { arguments: unknown } }[] };
    expect(assistant.tool_calls[0].function.arguments).toEqual({ amount: "5.00" });
  });
});

describe("parseModelResponse", () => {
  it("reads OpenAI tool calls with JSON-string arguments", () => {
    const result = parseModelResponse("api", {
      choices: [
        {
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_9",
                type: "function",
                function: {
                  name: "add_expense",
                  arguments: '{"amount":"1000.00","title":"телевизор"}',
                },
              },
            ],
          },
        },
      ],
    });
    expect(result.text).toBe("");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toMatchObject({
      id: "call_9",
      name: "add_expense",
      arguments: { amount: "1000.00", title: "телевизор" },
    });
  });

  it("reads Ollama tool calls with object arguments", () => {
    const result = parseModelResponse("ollama", {
      message: {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            function: {
              name: "add_expense",
              arguments: { amount: "1000.00" },
            },
          },
        ],
      },
    });
    expect(result.toolCalls[0]).toMatchObject({
      id: "call_0",
      name: "add_expense",
      arguments: { amount: "1000.00" },
    });
  });

  it("joins array content", () => {
    const result = parseModelResponse("api", {
      choices: [
        {
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "Готово: " },
              { type: "text", text: "записал." },
            ],
          },
        },
      ],
    });
    expect(result.text).toBe("Готово: записал.");
  });

  it("rejects an empty response", () => {
    expect(() => parseModelResponse("api", { choices: [] })).toThrow();
  });
});
