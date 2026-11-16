/**
 * Просмотр интерфейса в браузере: npm run preview:ui
 *
 * Параметры:
 *   theme=light|dark      яркость
 *   palette=neutral|red|blue|green
 *   screen=stats|accounts|categories|recurring
 *   compose=1             раскрыть форму новой операции
 *   transfer=1            раскрыть форму перевода
 *   edit=1                открыть правку первой операции
 *   dialog=1              показать подтверждение удаления
 *   conduct=1             провести первый доступный повтор (покажет уведомление)
 *   account-edit=1        открыть редактирование первого счёта
 *   account-save=1        изменить остаток (и имя через name=) и сохранить
 *   name=...              новое имя счёта для account-save
 *   balance=...           новый остаток счёта для account-save
 *   after=operations      после действия перейти в другой раздел
 *   chat=1                открыть панель чата
 *   chat-settings=1       открыть настройки модели
 *   chat-send=...         отправить сообщение в чат
 *   chat-undo=1           отменить последнее изменение из чата
 *   chat-test=1           нажать «Проверить» в настройках
 *   chat-save=1           сохранить настройки
 *   scroll=600            прокрутить содержимое на N пикселей
 *   welcome=1             экран выбора папки
 *   empty=1               папка без счетов и операций
 *   broken=1              файл с ошибочной строкой
 */
import { monthLabel } from "../src/finance/entry-file";

const params = new URLSearchParams(window.location.search);
const palettes = ["neutral", "red", "blue", "green"];
const brightness = params.get("theme") === "light" ? "light" : "dark";
const requested = params.get("palette") ?? "neutral";
const palette = palettes.includes(requested) ? requested : "neutral";

window.localStorage.setItem("finbymd.theme", JSON.stringify({ brightness, palette }));
document.documentElement.dataset.brightness = brightness;
document.documentElement.dataset.palette = palette;

await import("../src/main.ts");
await wait(450);

const month = params.get("month");
if (month) {
  const item = [...document.querySelectorAll<HTMLElement>(".month-item")].find((node) =>
    node.textContent?.includes(monthLabel(month)),
  );
  item?.click();
  await wait(200);
}

const screen = params.get("screen");
if (screen) {
  const label =
    screen === "stats"
      ? "Статистика"
      : screen === "accounts"
        ? "Счета"
        : screen === "categories"
          ? "Категории"
          : screen === "recurring"
            ? "Повторы"
            : screen === "debts"
              ? "Долги"
              : screen === "plans"
                ? "Планы"
                : null;
  if (label) {
    clickByText(".nav-item", label);
    await wait(150);
  }
}

if (params.get("compose") === "1") {
  const composer = document.querySelector<HTMLDetailsElement>(".composer");
  if (composer) {
    composer.open = true;
  }
  document.querySelector<HTMLInputElement>(".form-movement .field-amount input")?.focus();
  await wait(150);
}

const category = params.get("category");
if (category) {
  const chip = [
    ...document.querySelectorAll<HTMLButtonElement>(".chip-link, .legend-row, .bar-row, .delta-row"),
  ].find((node) => node.textContent?.includes(category));
  chip?.click();
  await wait(200);
}

const debt = params.get("debt");
if (debt) {
  const name = [...document.querySelectorAll<HTMLButtonElement>(".debt-name")].find((node) =>
    node.textContent?.includes(debt),
  );
  name?.click();
  await wait(200);
}

if (params.get("debt-pay") === "1") {
  document.querySelector<HTMLButtonElement>(".debt-actions .btn.primary")?.click();
  await wait(150);
}

if (params.get("debt-change") === "1") {
  clickByText("button", "Изменить сумму");
  await wait(150);
}

if (params.get("plan-form") === "1") {
  const composer = document.querySelector<HTMLDetailsElement>(".composer");
  if (composer) {
    composer.open = true;
  }
  await wait(150);
}

if (params.get("debt-save") === "1") {
  const composer = document.querySelector<HTMLDetailsElement>(".form-debt")?.closest("details");
  if (composer) {
    composer.open = true;
  }
  const form = document.querySelector<HTMLFormElement>(".form-debt");
  const person = form?.querySelector<HTMLInputElement>(".field input");
  const amount = form?.querySelector<HTMLInputElement>(".field-amount input");
  if (person && params.get("person")) {
    person.value = params.get("person") ?? "";
  }
  if (amount && params.get("amount")) {
    amount.value = params.get("amount") ?? "";
  }
  form?.requestSubmit();
  await wait(700);
}

if (params.get("debt-pay-save") === "1") {
  const form = document.querySelector<HTMLFormElement>(".debt-inline");
  const amount = form?.querySelector<HTMLInputElement>(".field-amount input");
  if (amount && params.get("amount")) {
    amount.value = params.get("amount") ?? "";
  }
  form?.requestSubmit();
  await wait(700);
}

if (params.get("debt-agree-save") === "1") {
  const form = document.querySelector<HTMLFormElement>(".debt-inline");
  const amount = form?.querySelector<HTMLInputElement>(".field-amount input");
  if (amount && params.get("amount")) {
    amount.value = params.get("amount") ?? "";
  }
  form?.requestSubmit();
  await wait(700);
}

if (params.get("plan-done") === "1") {
  document.querySelector<HTMLButtonElement>(".plan-check")?.click();
  await wait(700);
}

if (params.get("plan-add") === "1") {
  const composer = document.querySelector<HTMLDetailsElement>(".form-plan")?.closest("details");
  if (composer) {
    composer.open = true;
  }
  const form = document.querySelector<HTMLFormElement>(".form-plan");
  const title = form?.querySelector<HTMLInputElement>(".field input");
  const amount = form?.querySelector<HTMLInputElement>(".field-amount input");
  if (title && params.get("title")) {
    title.value = params.get("title") ?? "";
  }
  if (amount && params.get("amount")) {
    amount.value = params.get("amount") ?? "";
  }
  form?.requestSubmit();
  await wait(700);
}

if (params.get("chart") === "bars") {
  document.querySelector<HTMLButtonElement>('.chart-tab[data-view="bars"]')?.click();
  await wait(150);
}

if (params.get("transfer") === "1") {
  const composers = document.querySelectorAll<HTMLDetailsElement>(".composer");
  const transfer = composers[1];
  if (transfer) {
    transfer.open = true;
  }
  await wait(150);
}

if (params.get("conduct") === "1") {
  document.querySelector<HTMLButtonElement>(".rec-actions .btn.primary")?.click();
  await wait(500);
}

if (params.get("scroll")) {
  const content = document.querySelector<HTMLElement>(".content");
  if (content) {
    content.scrollTop = Number(params.get("scroll")) || 0;
  }
  await wait(150);
}

if (params.get("account-edit") === "1" || params.get("account-save") === "1") {
  if (!screen) {
    clickByText(".nav-item", "Счета");
    await wait(150);
  }
  document.querySelector<HTMLButtonElement>(".account-card .icon-btn")?.click();
  await wait(150);
  if (params.get("account-save") === "1") {
    const panel = document.querySelector<HTMLElement>(".account-editor-panel");
    const name = panel?.querySelector<HTMLInputElement>(".field input");
    const balance = panel?.querySelector<HTMLInputElement>(".field-amount input");
    if (name && params.get("name")) {
      name.value = params.get("name") ?? name.value;
    }
    if (balance && params.get("balance")) {
      balance.value = params.get("balance") ?? balance.value;
    }
    panel?.querySelector<HTMLFormElement>("form")?.requestSubmit();
    await wait(600);
  }
}

if (params.get("after")) {
  const label =
    params.get("after") === "stats"
      ? "Статистика"
      : params.get("after") === "accounts"
        ? "Счета"
        : params.get("after") === "categories"
          ? "Категории"
          : params.get("after") === "recurring"
            ? "Повторы"
            : "Операции";
  clickByText(".nav-item", label);
  await wait(200);
}

if (params.get("edit") === "1") {
  document.querySelector<HTMLButtonElement>('button[title="Изменить"]')?.click();
  await wait(150);
}

if (params.get("dialog") === "1") {
  document.querySelector<HTMLButtonElement>(".op .icon-btn.danger")?.click();
  await wait(150);
}

if (params.get("chat") === "1" || params.get("chat-send") || params.get("chat-settings") === "1") {
  document
    .querySelector<HTMLButtonElement>('button[title="Чат с ассистентом"]')
    ?.click();
  await wait(300);
}

if (params.get("chat-settings") === "1") {
  document
    .querySelector<HTMLButtonElement>('button[title="Настройки модели"]')
    ?.click();
  await wait(250);
}

if (params.get("chat-send")) {
  const input = document.querySelector<HTMLTextAreaElement>(".chat-input");
  if (input) {
    input.value = params.get("chat-send") ?? "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector<HTMLFormElement>(".chat-composer")?.requestSubmit();
  }
  await wait(1800);
}

if (params.get("chat-test") === "1") {
  clickByText("button", "Проверить");
  await wait(800);
}

if (params.get("chat-save") === "1") {
  clickByText("button", "Сохранить");
  await wait(400);
}

if (params.get("chat-undo") === "1") {
  document
    .querySelector<HTMLButtonElement>('button[title="Отменить последнее изменение"]')
    ?.click();
  await wait(700);
}

function clickByText(selector: string, text: string): void {
  const element = [...document.querySelectorAll<HTMLElement>(selector)].find(
    (item) => item.textContent?.trim() === text,
  );
  element?.click();
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
