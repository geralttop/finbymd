import { readDataFolder } from "../data-folder";
import { collectChanges, type FileChange } from "./changes";
import { buildSnapshot } from "./context";
import { buildSystemPrompt } from "./prompt";
import { requestChat } from "./provider";
import type { ChatMessage } from "./protocol";
import type { ChatSettings } from "./settings";
import { CHAT_TOOLS, executeTool, toolLabel } from "./tools";

export type ChatHistoryEntry = {
  role: "user" | "assistant";
  text: string;
  messages?: ChatMessage[];
};

export type ChatTurnInput = {
  settings: ChatSettings;
  dir: string;
  month: string;
  history: ChatHistoryEntry[];
  userText: string;
  onStatus?: (status: string) => void;
};

export type ChatTurnResult = {
  text: string;
  changes: FileChange[];
  steps: string[];
  messages: ChatMessage[];
  error?: string;
};

const MAX_STEPS = 6;

export async function runChatTurn(input: ChatTurnInput): Promise<ChatTurnResult> {
  const before = await readDataFolder(input.dir);
  const snapshot = await buildSnapshot(input.dir, input.month);
  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(snapshot) },
    ...input.history.slice(-12).flatMap((entry) =>
      entry.messages ?? [{ role: entry.role, content: entry.text }],
    ),
    { role: "user", content: input.userText },
  ];

  const turnStart = messages.length;
  let text = "";
  let error: string | undefined;
  const steps: string[] = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    input.onStatus?.(step === 0 ? "Думаю…" : "Уточняю…");
    let response;
    try {
      response = await requestChat(input.settings, messages, CHAT_TOOLS);
    } catch (caught) {
      error = message(caught);
      break;
    }

    if (response.toolCalls.length === 0) {
      text = response.text.trim();
      break;
    }

    messages.push({
      role: "assistant",
      content: response.text,
      toolCalls: response.toolCalls,
    });

    for (const call of response.toolCalls) {
      const label = toolLabel(call.name);
      steps.push(label);
      input.onStatus?.(`${label[0]?.toUpperCase() ?? ""}${label.slice(1)}…`);
      const output = await executeTool(call.name, call.arguments, {
        dir: input.dir,
        month: input.month,
      });
      messages.push({
        role: "tool",
        content: output,
        toolCallId: call.id,
        toolName: call.name,
      });
    }

    if (step === MAX_STEPS - 1) {
      error = "Модель сделала слишком много шагов подряд. Попробуйте переформулировать запрос.";
    }
  }

  let changes: FileChange[] = [];
  try {
    changes = await collectChanges(input.dir, before);
  } catch {
    changes = [];
  }

  if (!text && !error) {
    text = "Готово.";
  }

  const turnMessages = messages.slice(turnStart);
  if (text) {
    turnMessages.push({ role: "assistant", content: text });
  }
  return { text, changes, steps, error, messages: turnMessages };
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
