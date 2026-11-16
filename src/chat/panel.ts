import type { ChatMessage } from "./protocol";
import { toast } from "../ui/feedback";
import { icon } from "../ui/icons";
import { runChatTurn, type ChatHistoryEntry } from "./chat";
import { undoChanges, type FileChange } from "./changes";
import { testConnection } from "./provider";
import {
  DEFAULT_CHAT_SETTINGS,
  PROVIDER_DEFAULTS,
  isChatConfigured,
  loadChatSettings,
  normalizeSettings,
  providerLabel,
  saveChatSettings,
  type ChatProvider,
  type ChatSettings,
} from "./settings";

type ChatApp = {
  getDir: () => string | null;
  getMonth: () => string;
  reload: () => Promise<void>;
};

type Entry = {
  role: "user" | "assistant" | "error";
  text: string;
  messages?: ChatMessage[];
};

const EXAMPLES = [
  "Купил телевизор за 1000 BYN с карты",
  "Сколько я потратил на продукты в этом месяце?",
  "Переведи 50 BYN с карты на наличные",
];

let chatApp: ChatApp | null = null;
let panel: HTMLElement | null = null;
let messagesEl: HTMLElement | null = null;
let inputEl: HTMLTextAreaElement | null = null;
let sendButton: HTMLButtonElement | null = null;
let headerSub: HTMLElement | null = null;
let undoButton: HTMLButtonElement | null = null;
let settingsDialog: HTMLElement | null = null;
let settings: ChatSettings = { ...DEFAULT_CHAT_SETTINGS };
let entries: Entry[] = [];
let pending = false;
let status = "";
let lastChanges: FileChange[] = [];
let lastChangesDir: string | null = null;
let settingsReady: Promise<void> | null = null;

export function initChat(context: ChatApp): void {
  chatApp = context;
  ensurePanel();
  settingsReady = loadChatSettings()
    .then((loaded) => {
      settings = loaded;
      updateHeader();
      renderMessages();
    })
    .catch(() => {
      settings = { ...DEFAULT_CHAT_SETTINGS };
      updateHeader();
    });
}

export function toggleChat(): void {
  if (panel && !panel.hidden) {
    closeChat();
    return;
  }
  void openChat();
}

async function openChat(): Promise<void> {
  if (!chatApp) {
    return;
  }
  if (!chatApp.getDir()) {
    toast("Сначала выберите папку с деньгами", "error");
    return;
  }
  const element = ensurePanel();
  element.hidden = false;
  await settingsReady;
  renderMessages();
  updateHeader();
  if (!isChatConfigured(settings)) {
    openSettings();
  } else {
    inputEl?.focus();
  }
}

function closeChat(): void {
  if (panel) {
    panel.hidden = true;
  }
}

function ensurePanel(): HTMLElement {
  if (panel) {
    return panel;
  }
  panel = el("aside", "chat-panel");
  panel.hidden = true;
  panel.setAttribute("aria-label", "Чат с ассистентом");

  headerSub = el("span", "chat-sub");
  const header = el(
    "header",
    "chat-head",
    el(
      "div",
      "chat-head-text",
      el("span", "chat-title", "Чат"),
      headerSub,
    ),
  );
  const actions = el("div", "chat-head-actions");
  undoButton = iconButton("undo", "Отменить последнее изменение");
  undoButton.hidden = true;
  undoButton.addEventListener("click", () => {
    void undoLastChange();
  });
  const settingsButton = iconButton("settings", "Настройки модели");
  settingsButton.addEventListener("click", openSettings);
  const closeButton = iconButton("x", "Закрыть чат");
  closeButton.addEventListener("click", closeChat);
  actions.append(undoButton, settingsButton, closeButton);
  header.append(actions);

  messagesEl = el("div", "chat-messages");
  messagesEl.setAttribute("role", "log");
  messagesEl.setAttribute("aria-live", "polite");

  inputEl = el("textarea", "chat-input");
  inputEl.rows = 1;
  inputEl.placeholder = "Например: кофе за 5 BYN с наличных";
  inputEl.addEventListener("input", resizeInput);
  inputEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void send();
    }
  });
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !settingsDialog) {
      event.preventDefault();
      closeChat();
    }
  });
  sendButton = el("button", "btn primary chat-send");
  sendButton.type = "submit";
  sendButton.title = "Отправить";
  sendButton.setAttribute("aria-label", "Отправить");
  sendButton.append(icon("send", 15));

  const composer = el("form", "chat-composer", inputEl, sendButton);
  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    void send();
  });
  const hint = el(
    "p",
    "chat-hint",
    "Enter — отправить, Shift + Enter — новая строка",
  );

  panel.append(
    header,
    messagesEl,
    el("div", "chat-composer-wrap", composer, hint),
  );
  document.body.append(panel);
  updateHeader();
  renderMessages();
  return panel;
}

async function send(): Promise<void> {
  if (pending || !chatApp) {
    return;
  }
  const text = inputEl?.value.trim() ?? "";
  if (!text) {
    return;
  }
  if (!isChatConfigured(settings)) {
    openSettings();
    return;
  }
  const dir = chatApp.getDir();
  if (!dir) {
    toast("Сначала выберите папку с деньгами", "error");
    return;
  }
  const history: ChatHistoryEntry[] = entries
    .filter((entry) => entry.role !== "error")
    .map((entry) => ({ role: entry.role as "user" | "assistant", text: entry.text, messages: entry.messages }));

  entries.push({ role: "user", text });
  if (inputEl) {
    inputEl.value = "";
    resizeInput();
  }
  pending = true;
  status = "Думаю…";
  renderMessages();
  updateSendState();

  let result;
  try {
    result = await runChatTurn({
      settings,
      dir,
      month: chatApp.getMonth(),
      history,
      userText: text,
      onStatus: (next) => {
        status = next;
        renderMessages();
      },
    });
  } catch (error) {
    pending = false;
    status = "";
    entries.push({ role: "error", text: message(error) });
    renderMessages();
    updateSendState();
    return;
  }

  pending = false;
  status = "";
  if (result.text || result.messages.length > 0) {
    entries.push({ role: "assistant", text: result.text, messages: result.messages });
  }
  if (result.error) {
    entries.push({ role: "error", text: result.error });
  }
  if (result.changes.length > 0) {
    lastChanges = result.changes;
    lastChangesDir = dir;
    try {
      await chatApp.reload();
    } catch {
      // Экран обновится при следующем изменении файлов.
    }
  }
  updateHeader();
  renderMessages();
  updateSendState();
  if (result.changes.length > 0) {
    toast("Изменения записаны в файлы");
  }
}

async function undoLastChange(): Promise<void> {
  if (!chatApp || lastChanges.length === 0) {
    return;
  }
  const dir = chatApp.getDir();
  if (!dir || dir !== lastChangesDir) {
    lastChanges = [];
    lastChangesDir = null;
    updateHeader();
    renderMessages();
    return;
  }
  if (undoButton) {
    undoButton.disabled = true;
  }
  try {
    await undoChanges(dir, lastChanges);
    lastChanges = [];
    lastChangesDir = null;
    entries.push({ role: "assistant", text: "Отменил последнее изменение из чата." });
    await chatApp.reload();
    updateHeader();
    renderMessages();
    toast("Изменение отменено");
  } catch (error) {
    entries.push({ role: "error", text: message(error) });
    renderMessages();
  } finally {
    if (undoButton) {
      undoButton.disabled = false;
    }
  }
}

function renderMessages(): void {
  if (!messagesEl) {
    return;
  }
  messagesEl.replaceChildren();
  if (entries.length === 0 && !pending) {
    messagesEl.append(emptyState());
  }
  for (const entry of entries) {
    if (!entry.text) continue;
    messagesEl.append(messageBubble(entry));
  }
  if (pending) {
    messagesEl.append(
      el(
        "div",
        "chat-typing",
        el("span", "spinner"),
        el("span", undefined, status || "Думаю…"),
      ),
    );
  }
  updateHeader();
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function emptyState(): HTMLElement {
  const box = el(
    "div",
    "chat-empty",
    el("span", "chat-empty-icon", icon("chat", 22)),
    el("h2", undefined, "Спросите про деньги"),
    el(
      "p",
      undefined,
      "Напишите обычной фразой — ассистент найдёт счёт и категорию, проверит сумму и запишет строку в markdown.",
    ),
  );
  const list = el("ul", "chat-examples");
  for (const example of EXAMPLES) {
    const button = el("button", "chat-example", example);
    button.type = "button";
    button.addEventListener("click", () => {
      if (inputEl) {
        inputEl.value = example;
        resizeInput();
        inputEl.focus();
      }
    });
    list.append(el("li", undefined, button));
  }
  box.append(list);
  if (!isChatConfigured(settings)) {
    const setup = el("button", "btn primary small", "Настроить модель");
    setup.type = "button";
    setup.addEventListener("click", openSettings);
    box.append(el("div", "chat-empty-action", setup));
  }
  return box;
}

function messageBubble(entry: Entry): HTMLElement {
  if (entry.role === "user") {
    return el("div", "chat-msg is-user", el("div", "chat-bubble", entry.text));
  }
  if (entry.role === "error") {
    return el(
      "div",
      "chat-msg is-assistant",
      el(
        "div",
        "chat-bubble is-error",
        el("span", "chat-error-icon", icon("alert", 15)),
        el("span", undefined, entry.text),
      ),
    );
  }
  return el(
    "div",
    "chat-msg is-assistant",
    el("div", "chat-bubble", entry.text),
  );
}

function updateHeader(): void {
  if (headerSub) {
    headerSub.textContent = isChatConfigured(settings)
      ? `${providerLabel(settings)} · ${settings.model}`
      : "Модель не настроена";
  }
  if (undoButton) {
    undoButton.hidden =
      lastChanges.length === 0 ||
      (chatApp !== null && lastChangesDir !== chatApp.getDir());
  }
  if (sendButton) {
    sendButton.disabled = pending;
  }
}

function updateSendState(): void {
  if (sendButton) {
    sendButton.disabled = pending;
  }
  if (inputEl) {
    inputEl.disabled = pending;
  }
}

function resizeInput(): void {
  if (!inputEl) {
    return;
  }
  inputEl.style.height = "auto";
  inputEl.style.height = `${Math.min(inputEl.scrollHeight, 150)}px`;
}

function openSettings(): void {
  if (settingsDialog) {
    return;
  }
  let draftProvider: ChatProvider = settings.provider;
  const base = textField("Адрес", settings.baseUrl);
  const baseUrl = base.input;
  const modelField = textField("Модель", settings.model);
  const model = modelField.input;
  model.placeholder = "например qwen3 или gpt-4.1-mini";
  const key = textField("Ключ API", settings.apiKey, "password");
  const apiKey = key.input;
  const keyField = key.field;
  const keyHint = el(
    "p",
    "form-hint",
    "Для локальной Ollama ключ не нужен. Для внешнего API он хранится в настройках приложения, не в папке с деньгами.",
  );

  const providerTabs = el("div", "segmented");
  providerTabs.setAttribute("role", "group");
  const tabOllama = providerTab("Ollama");
  const tabApi = providerTab("Внешний API");
  providerTabs.append(tabOllama, tabApi);

  const hint = el("p", "form-hint");
  const privacy = el("p", "form-hint");
  const statusLine = el("p", "settings-status");
  statusLine.hidden = true;

  const syncProvider = (): void => {
    for (const tab of [tabOllama, tabApi]) {
      const active = tab.dataset.provider === draftProvider;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-pressed", String(active));
    }
    const defaults = PROVIDER_DEFAULTS[draftProvider];
    baseUrl.placeholder = defaults.baseUrl;
    hint.textContent =
      draftProvider === "ollama"
        ? "Локальный сервер Ollama. Адрес по умолчанию — http://127.0.0.1:11434. Модель должна поддерживать вызов инструментов."
        : "OpenAI-совместимый сервис. Укажите base URL до /v1, например https://api.openai.com/v1.";
    privacy.textContent =
      draftProvider === "ollama"
        ? "Запросы и данные остаются на этом компьютере."
        : "Сообщение, снимок счетов и операций месяца уйдут на выбранный сервис.";
    keyField.hidden = false;
    keyHint.hidden = false;
  };
  for (const tab of [tabOllama, tabApi]) {
    tab.addEventListener("click", () => {
      const next = tab.dataset.provider as ChatProvider;
      if (next === draftProvider) {
        return;
      }
      const previousDefault = PROVIDER_DEFAULTS[draftProvider].baseUrl;
      if (!baseUrl.value.trim() || baseUrl.value.trim() === previousDefault) {
        baseUrl.value = PROVIDER_DEFAULTS[next].baseUrl;
      }
      draftProvider = next;
      syncProvider();
    });
  }
  syncProvider();

  const test = el("button", "btn ghost", "Проверить");
  test.type = "button";
  const save = el("button", "btn primary", "Сохранить");
  save.type = "submit";
  const cancel = el("button", "btn ghost", "Отмена");
  cancel.type = "button";
  cancel.addEventListener("click", closeSettings);

  const form = el(
    "form",
    "chat-settings-form",
    field("Провайдер", providerTabs),
    base.field,
    modelField.field,
    keyField,
    hint,
    privacy,
    keyHint,
    statusLine,
    el("div", "dialog-actions", test, el("span", "dialog-spacer"), cancel, save),
  );

  const dialog = el(
    "div",
    "dialog chat-settings",
    el(
      "div",
      "chat-settings-head",
      el(
        "div",
        undefined,
        el("h2", "dialog-title", "Настройки модели"),
        el("p", "dialog-text", "Ассистент работает через Ollama или OpenAI-совместимый API."),
      ),
      (() => {
        const close = iconButton("x", "Закрыть настройки");
        close.addEventListener("click", closeSettings);
        return close;
      })(),
    ),
    form,
  );
  const overlay = el("div", "overlay chat-settings-overlay", dialog);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      closeSettings();
    }
  });
  settingsDialog = overlay;
  document.body.append(overlay);
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      document.removeEventListener("keydown", onKey);
      closeSettings();
    }
  };
  document.addEventListener("keydown", onKey);

  test.addEventListener("click", () => {
    void runTest();
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveDraft();
  });
  baseUrl.focus();

  function closeSettings(): void {
    document.removeEventListener("keydown", onKey);
    settingsDialog?.remove();
    settingsDialog = null;
    if (inputEl) {
      inputEl.focus();
    }
  }

  async function currentDraft(): Promise<ChatSettings> {
    return normalizeSettings({
      provider: draftProvider,
      baseUrl: baseUrl.value,
      model: model.value,
      apiKey: apiKey.value,
    });
  }

  function setStatus(text: string, kind: "ok" | "error" | "info"): void {
    statusLine.hidden = false;
    statusLine.textContent = text;
    statusLine.dataset.kind = kind;
  }

  async function runTest(): Promise<void> {
    const draft = await currentDraft();
    if (!draft.model.trim() || !draft.baseUrl.trim()) {
      setStatus("Заполните адрес и модель.", "error");
      return;
    }
    test.disabled = true;
    save.disabled = true;
    setStatus("Проверяю подключение…", "info");
    try {
      const answer = await testConnection(draft);
      setStatus(`Подключение работает: ${answer.slice(0, 120)}`, "ok");
    } catch (error) {
      setStatus(message(error), "error");
    } finally {
      test.disabled = false;
      save.disabled = false;
    }
  }

  async function saveDraft(): Promise<void> {
    const draft = await currentDraft();
    if (!draft.baseUrl.trim()) {
      setStatus("Укажите адрес API.", "error");
      return;
    }
    if (!draft.model.trim()) {
      setStatus("Укажите имя модели.", "error");
      return;
    }
    save.disabled = true;
    test.disabled = true;
    try {
      await saveChatSettings(draft);
      settings = draft;
      closeSettings();
      updateHeader();
      renderMessages();
      toast("Настройки модели сохранены");
    } catch (error) {
      setStatus(message(error), "error");
      save.disabled = false;
      test.disabled = false;
    }
  }
}

function providerTab(label: string): HTMLButtonElement {
  const button = el("button", "segmented-item", el("span", undefined, label));
  button.type = "button";
  button.dataset.provider = label === "Ollama" ? "ollama" : "api";
  return button;
}

function field(label: string, control: HTMLElement): HTMLElement {
  return el("label", "field", el("span", "field-label", label), control);
}

function textField(
  label: string,
  value: string,
  type = "text",
): { input: HTMLInputElement; field: HTMLElement } {
  const control = el("input", "input");
  control.type = type;
  control.value = value;
  control.autocomplete = "off";
  const wrapper = el("label", "field", el("span", "field-label", label), control);
  return { input: control, field: wrapper };
}

function iconButton(name: Parameters<typeof icon>[0], label: string): HTMLButtonElement {
  const button = el("button", "icon-btn");
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.append(icon(name, 16));
  return button;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  ...children: (Node | string | false | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) {
      continue;
    }
    node.append(child);
  }
  return node;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
