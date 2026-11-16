import { Platform } from "obsidian";
import type { App } from "obsidian";
import { buildSystemPrompt } from "../../src/chat/prompt";
import type { ChatMessage, ToolDefinition } from "../../src/chat/protocol";
import type { ChatProvider, ChatSettings } from "../../src/chat/settings";
import type FinbymdPlugin from "../main";
import type { Book } from "../storage";
import { requestChat } from "./request";
import { buildSnapshot, todayKey } from "./snapshot";
import { CHAT_TOOLS, executeTool } from "./tools";

const KEY_STORAGE = "finbymd.apiKey";

export type ChatContext = {
  book: Book;
  month: string;
  reload: () => Promise<void>;
};

export class ChatPanel {
  private messages: ChatMessage[] = [];
  private busy = false;
  private settingsOpen = false;
  private error: string | null = null;
  private host: HTMLElement | null = null;

  constructor(
    private app: App,
    private plugin: FinbymdPlugin,
    private context: ChatContext,
    private onClose?: () => void,
  ) {}

  setContext(context: ChatContext): void {
    this.context = context;
  }

  render(host: HTMLElement): void {
    this.host = host;
    host.empty();
    host.addClass("finbymd-chat");

    const head = host.createDiv({ cls: "finbymd-chat-head" });
    head.createEl("strong", { text: "Чат" });
    const gear = head.createEl("button", { text: "⚙", cls: "finbymd-chat-icon" });
    gear.setAttribute("aria-label", "Настройки модели");
    gear.addEventListener("click", () => {
      this.settingsOpen = !this.settingsOpen;
      this.render(host);
    });
    if (this.onClose) {
      const close = head.createEl("button", { text: "×", cls: "finbymd-chat-icon" });
      close.setAttribute("aria-label", "Закрыть чат");
      close.addEventListener("click", () => this.onClose?.());
    }

    if (this.settingsOpen) {
      this.renderSettings(host);
    }

    const list = host.createDiv({ cls: "finbymd-chat-list" });
    for (const message of this.messages) {
      if (message.role === "user") {
        list.createDiv({ cls: "finbymd-msg finbymd-msg-user", text: message.content });
      } else if (message.role === "assistant" && message.content) {
        list.createDiv({ cls: "finbymd-msg finbymd-msg-bot", text: message.content });
      } else if (message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0) {
        list.createDiv({
          cls: "finbymd-msg finbymd-msg-tool",
          text: message.toolCalls.map((call) => call.name).join(", "),
        });
      }
    }
    if (this.busy) {
      list.createDiv({ cls: "finbymd-msg finbymd-msg-bot finbymd-muted", text: "Думаю…" });
    }
    if (this.error) {
      list.createDiv({ cls: "finbymd-msg finbymd-msg-error", text: this.error });
    }

    const form = host.createDiv({ cls: "finbymd-chat-form" });
    const input = form.createEl("textarea", {
      cls: "finbymd-chat-input",
      attr: { rows: "2", placeholder: "Спроси про траты или попроси записать" },
    });
    const send = form.createEl("button", { text: "→", cls: "finbymd-chat-send" });
    const submit = (): void => {
      const text = input.value.trim();
      if (!text || this.busy) {
        return;
      }
      input.value = "";
      void this.send(text);
    };
    send.addEventListener("click", submit);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        submit();
      }
    });

    window.requestAnimationFrame(() => {
      list.scrollTop = list.scrollHeight;
    });
    input.addEventListener("focus", () => {
      window.setTimeout(() => {
        list.scrollTop = list.scrollHeight;
      }, 250);
    });
    if (!this.busy && this.messages.length === 0 && !Platform.isMobile) {
      input.focus();
    }
  }

  private renderSettings(host: HTMLElement): void {
    const settings = this.chatSettings();
    const box = host.createDiv({ cls: "finbymd-chat-settings" });

    const provider = box.createEl("select", { cls: "finbymd-chat-field" });
    for (const [value, label] of [["ollama", "Ollama"], ["api", "Внешний API"]] as const) {
      const option = provider.createEl("option", { text: label });
      option.value = value;
    }
    provider.value = settings.provider;
    provider.addEventListener("change", () => {
      this.plugin.settings.chat.provider = provider.value as ChatProvider;
      this.plugin.settings.chat.baseUrl =
        provider.value === "api" ? "https://api.openai.com/v1" : "http://127.0.0.1:11434";
      void this.plugin.saveSettings();
      this.settingsOpen = true;
      if (this.host) {
        this.render(this.host);
      }
    });

    const baseUrl = box.createEl("input", { cls: "finbymd-chat-field", type: "text" });
    baseUrl.value = settings.baseUrl;
    baseUrl.addEventListener("change", () => {
      this.plugin.settings.chat.baseUrl = baseUrl.value.trim();
      void this.plugin.saveSettings();
    });

    const model = box.createEl("input", { cls: "finbymd-chat-field", type: "text" });
    model.placeholder = "имя модели";
    model.value = settings.model;
    model.addEventListener("change", () => {
      this.plugin.settings.chat.model = model.value.trim();
      void this.plugin.saveSettings();
    });

    const key = box.createEl("input", { cls: "finbymd-chat-field", type: "password" });
    key.placeholder = "ключ API (хранится на устройстве)";
    key.value = this.apiKey();
    key.addEventListener("change", () => {
      window.localStorage.setItem(KEY_STORAGE, key.value.trim());
    });

    box.createEl("p", {
      cls: "finbymd-muted",
      text: "Ключ лежит в localStorage устройства, а не в data.json, чтобы не уехать в git.",
    });
  }

  private chatSettings(): ChatSettings {
    const chat = this.plugin.settings.chat;
    return {
      provider: chat.provider,
      baseUrl: chat.baseUrl,
      model: chat.model,
      apiKey: this.apiKey(),
    };
  }

  private apiKey(): string {
    try {
      return window.localStorage.getItem(KEY_STORAGE) ?? "";
    } catch {
      return "";
    }
  }

  private async send(text: string): Promise<void> {
    this.busy = true;
    this.error = null;
    this.messages.push({ role: "user", content: text });
    this.rerender();

    const settings = this.chatSettings();
    if (!settings.model.trim() || !settings.baseUrl.trim()) {
      this.error = "Задай модель и адрес в настройках (шестерёнка).";
      this.busy = false;
      this.rerender();
      return;
    }

    const snapshot = buildSnapshot(this.context.book, this.context.month, todayKey());
    const history: ChatMessage[] = [
      { role: "system", content: buildSystemPrompt(snapshot) },
      ...this.messages.filter((message) => message.role !== "system"),
    ];

    try {
      for (let step = 0; step < 6; step += 1) {
        const response = await requestChat(settings, history, CHAT_TOOLS as ToolDefinition[]);
        if (response.toolCalls.length === 0) {
          this.messages.push({ role: "assistant", content: response.text });
          break;
        }
        this.messages.push({
          role: "assistant",
          content: response.text,
          toolCalls: response.toolCalls,
        });
        history.push({
          role: "assistant",
          content: response.text,
          toolCalls: response.toolCalls,
        });
        let wrote = false;
        for (const call of response.toolCalls) {
          const result = await executeTool(
            this.app,
            this.context.book,
            this.context.month,
            call.name,
            call.arguments,
          );
          const toolMessage: ChatMessage = {
            role: "tool",
            content: result,
            toolCallId: call.id,
            toolName: call.name,
          };
          this.messages.push(toolMessage);
          history.push(toolMessage);
          wrote = wrote || result.includes('"ok":true');
        }
        if (wrote) {
          await this.context.reload();
        }
      }
    } catch (caught) {
      this.error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      this.busy = false;
      this.rerender();
    }
  }

  private rerender(): void {
    if (this.host) {
      this.render(this.host);
    }
  }
}
