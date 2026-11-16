import { beforeEach, expect, it, vi } from "vitest";
import { runChatTurn } from "./chat";
import { requestChat } from "./provider";
import { executeTool } from "./tools";
import { DEFAULT_CHAT_SETTINGS } from "./settings";
import type { ChatMessage } from "./protocol";

vi.mock("../data-folder", () => ({ readDataFolder: vi.fn().mockResolvedValue([]) }));
vi.mock("./changes", () => ({ collectChanges: vi.fn().mockResolvedValue([]) }));
vi.mock("./context", () => ({ buildSnapshot: vi.fn().mockResolvedValue({ operations: [] }) }));
vi.mock("./prompt", () => ({ buildSystemPrompt: () => "Current snapshot has no operations" }));
vi.mock("./provider", () => ({ requestChat: vi.fn() }));
vi.mock("./tools", () => ({ CHAT_TOOLS: [], executeTool: vi.fn(), toolLabel: () => "удаляю операцию" }));

beforeEach(() => vi.clearAllMocks());

it.each([false, true])("keeps deletion details for the next turn, including after a provider error (%s)", async (fails) => {
  const call = { id: "call_1", name: "delete_operation", arguments: { id: "t1" } };
  const deleted = 'Удалена: {"id":"t1","title":"Телевизор","amount":"1000.00"}';
  vi.mocked(executeTool).mockResolvedValue(deleted);
  vi.mocked(requestChat).mockResolvedValueOnce({ text: "", toolCalls: [call] });
  if (fails) {
    vi.mocked(requestChat).mockRejectedValueOnce(new Error("Connection lost"));
  } else {
    vi.mocked(requestChat).mockResolvedValueOnce({ text: "Удалил.", toolCalls: [] });
  }
  const input = { settings: DEFAULT_CHAT_SETTINGS, dir: "/money", month: "2026-11", history: [], userText: "Удали телевизор" };
  const result = await runChatTurn(input);
  expect(result.messages).toContainEqual({ role: "tool", content: deleted, toolCallId: call.id, toolName: call.name });
  let nextMessages: ChatMessage[] = [];
  vi.mocked(requestChat).mockImplementationOnce(async (_settings, messages) => {
    nextMessages = [...messages];
    return { text: "Вы удалили телевизор за 1000.", toolCalls: [] };
  });
  await runChatTurn({ ...input, history: [
    { role: "user", text: input.userText },
    { role: "assistant", text: result.text, messages: result.messages },
  ], userText: "Сколько стоила эта операция?" });
  expect(nextMessages).toContainEqual({ role: "assistant", content: "", toolCalls: [call] });
  expect(nextMessages).toContainEqual({ role: "tool", content: deleted, toolCallId: call.id, toolName: call.name });
  expect(executeTool).toHaveBeenCalledTimes(1);
});
