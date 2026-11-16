import { invoke } from "@tauri-apps/api/core";
import { join } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile, type UnwatchFn } from "@tauri-apps/plugin-fs";
import { accountLine, normalizeAccount } from "./finance/account-file";
import { accountUsage, replaceAccountLine, rewriteAccountReferences } from "./finance/account-edit";
import { categoryLine, normalizeCategory } from "./finance/category-file";
import {
  findStatementLine,
  replaceStatement,
  retireStatement,
  retiredIds,
} from "./finance/edit-line";
import {
  currentMonth,
  monthLabel,
  movementLine,
  prepareEdit,
  prepareMovement,
  shiftMonth,
  todayDate,
} from "./finance/entry-file";
import { appendStatement } from "./finance/fence";
import { balances } from "./finance/balance";
import {
  alreadyPosted,
  findRecurringLine,
  postRecurring,
  prepareRecurring,
  recurringLine,
  reminderDue,
} from "./finance/recurring-file";
import {
  categoryHistory,
  monthComparison,
  monthInsights,
  monthStats,
  type AmountDelta,
  type CategoryDelta,
  type CurrencyStats,
  type MonthComparison,
  type MonthInsight,
} from "./finance/stats";
import {
  buildDebts,
  debtAgreedLine,
  debtForgiveLine,
  debtLine,
  debtMonthFlow,
  debtPaymentLine,
  debtTotals,
  prepareAgreed,
  prepareDebt,
  preparePayment,
  settleDirection,
  type Debt,
  type DebtEvent,
  type DebtFlow,
} from "./finance/debt";
import {
  buildPlans,
  nextPlanId,
  openPlans,
  planDoneLine,
  planLine,
  planTotals,
  preparePlan,
  type Plan,
} from "./finance/plans";
import { prepareTransfer, transferLine } from "./finance/transfer-file";
import { interpretFiles, monthOf, type LoadedFile } from "./finance/load";
import {
  parseFinance,
  type AccountStatement,
  type CategoryStatement,
  type ExchangeStatement,
  type ExpenseStatement,
  type IncomeStatement,
  type RecurringStatement,
  type Statement,
  type TransferStatement,
} from "./finance/parse";
import { readDataFolder, watchDataFolder } from "./data-folder";
import { initChat, toggleChat } from "./chat/panel";
import { applyTheme, readTheme, themeControl } from "./theme";
import { confirmAction, toast } from "./ui/feedback";
import {
  dayLabel,
  difference,
  formatAmount,
  formatCount,
  percent,
  signedAmount,
  weekdayLabel,
} from "./ui/format";
import { icon, logo, type IconName } from "./ui/icons";

const rootElement = document.querySelector("#app");
if (!(rootElement instanceof HTMLElement)) {
  throw new Error("Нет корневого элемента");
}
const app: HTMLElement = rootElement;

let unwatch: UnwatchFn | null = null;
let currentDir: string | null = null;
let loading = false;
let reloadQueued = false;
let selectedMonth = currentMonth();
let selectedCategory: string | null = null;
let selectedDebt: string | null = null;
let lastFiles: LoadedFile[] | null = null;
let screen: Screen = "operations";
type ChartView = "donut" | "bars";
let chartView: ChartView = readChartView();

type Screen =
  | "operations"
  | "stats"
  | "debts"
  | "debt"
  | "plans"
  | "accounts"
  | "categories"
  | "recurring"
  | "category";
type Ledger = ReturnType<typeof interpretFiles>;

const OPERATION_FORMS = ["операция", "операции", "операций"] as const;
const ACCOUNT_FORMS = ["счёт", "счёта", "счетов"] as const;
const CATEGORY_FORMS = ["категория", "категории", "категорий"] as const;

applyTheme(readTheme());
initChat({
  getDir: () => currentDir,
  getMonth: () => selectedMonth,
  reload,
});
void start();

async function start(): Promise<void> {
  renderBoot();
  try {
    const saved = await invoke<string | null>("load_data_dir");
    if (saved) {
      await openDir(saved);
      return;
    }
    render(null, null, null);
  } catch (error) {
    render(null, null, message(error));
  }
}

async function pick(): Promise<void> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Папка с деньгами",
  });
  if (selected === null) {
    if (!currentDir) {
      render(null, null, null);
    }
    return;
  }
  try {
    const path = await invoke<string>("save_data_dir", { path: selected });
    await openDir(path);
  } catch (error) {
    render(currentDir, currentDir ? lastFiles : null, message(error));
  }
}

async function openDir(dir: string): Promise<void> {
  unwatch?.();
  unwatch = null;
  currentDir = dir;
  await reload();
  unwatch = await watchDataFolder(dir, () => {
    void reload();
  });
}

async function reload(): Promise<void> {
  if (!currentDir) {
    return;
  }
  if (loading) {
    reloadQueued = true;
    return;
  }
  loading = true;
  const dir = currentDir;
  try {
    const files = await readDataFolder(dir);
    if (currentDir === dir) {
      lastFiles = files;
      render(dir, files, null);
    }
  } catch (error) {
    if (currentDir === dir) {
      render(dir, lastFiles, message(error));
    }
  } finally {
    loading = false;
    if (reloadQueued) {
      reloadQueued = false;
      void reload();
    }
  }
}

function render(dir: string | null, files: LoadedFile[] | null, error: string | null): void {
  app.replaceChildren();
  if (!dir) {
    app.append(welcome(error));
    return;
  }

  const loaded = files ? interpretFiles(files) : null;
  const shell = el("div", "app");
  shell.append(buildSidebar(dir, files, loaded), buildMain(dir, files, loaded, error));
  app.append(shell);
}

function renderBoot(): void {
  app.replaceChildren(
    el(
      "div",
      "boot",
      el("span", "brand-mark brand-mark-lg", logo(24)),
      el("span", "spinner"),
      el("p", "loading-text", "Читаем папку с деньгами…"),
    ),
  );
}

function welcome(error: string | null): HTMLElement {
  const box = el("div", "welcome");
  const card = el("div", "welcome-card");
  card.append(
    el("span", "brand-mark brand-mark-xl", logo(30)),
    el("h1", undefined, "finbymd"),
    el("p", "welcome-lead", "Учёт денег в markdown-файлах."),
    el(
      "p",
      "welcome-text",
      "Выберите папку для заметок. Программа создаст в ней accounts.md, categories.md, recurring.md и каталог transactions. Файлы останутся вашими: их можно открыть в Obsidian или править в Cursor.",
    ),
    el("div", "welcome-actions", primaryButton("Выбрать папку", "folder", () => void pick())),
  );
  const points = el("ul", "welcome-points");
  for (const text of ["Без сервера", "Без аккаунта", "Только ваши файлы"]) {
    points.append(el("li", undefined, text));
  }
  card.append(points);
  box.append(card);
  const control = themeControl();
  control.classList.add("welcome-theme");
  box.append(control);
  if (error) {
    box.append(el("div", "welcome-error", icon("alert", 15), el("span", undefined, error)));
  }
  return box;
}

function buildSidebar(dir: string, files: LoadedFile[] | null, loaded: Ledger | null): HTMLElement {
  const aside = el("aside", "sidebar");
  const brand = el(
    "div",
    "brand",
    el("span", "brand-mark", logo(18)),
    el(
      "div",
      "brand-text",
      el("span", "brand-name", "finbymd"),
      el("span", "brand-sub", "учёт денег"),
    ),
  );
  const scroll = el("div", "side-scroll");
  scroll.append(navigation(), accountsSection(loaded), monthsSection(files, loaded));
  aside.append(brand, scroll, sideFooter(dir));
  return aside;
}

function navigation(): HTMLElement {
  const nav = el("nav", "nav");
  const items: [Screen, string, IconName][] = [
    ["operations", "Операции", "list"],
    ["stats", "Статистика", "chart"],
    ["debts", "Долги", "debt"],
    ["plans", "Планы", "plan"],
    ["accounts", "Счета", "wallet"],
    ["categories", "Категории", "tag"],
    ["recurring", "Повторы", "repeat"],
  ];
  for (const [id, label, iconName] of items) {
    const active =
      id === screen ||
      (screen === "category" && id === "categories") ||
      (screen === "debt" && id === "debts");
    const button = el("button", active ? "nav-item is-current" : "nav-item");
    button.type = "button";
    button.append(icon(iconName, 17), el("span", undefined, label));
    if (active) {
      button.setAttribute("aria-current", "page");
    }
    button.addEventListener("click", () => {
      chooseScreen(id);
    });
    nav.append(button);
  }
  return nav;
}

function accountsSection(loaded: Ledger | null): HTMLElement {
  const section = el("section", "side-section");
  section.append(sideHeading("Счета"));
  const accountBalances = loaded ? balances(loaded.statements.map((item) => item.statement)) : [];
  if (accountBalances.length === 0) {
    section.append(el("p", "side-empty", "Пока нет счетов."));
    return section;
  }

  const types = new Map<string, string>();
  for (const item of loaded?.statements ?? []) {
    if (item.statement.kind === "account" && !types.has(item.statement.name)) {
      types.set(item.statement.name, item.statement.accountType);
    }
  }

  const list = el("ul", "side-accounts");
  for (const account of accountBalances) {
    const type = types.get(account.name);
    const row = el(
      "li",
      "account-row",
      el(
        "span",
        "account-type-icon",
        icon(type === "bank" ? "bank" : "wallet", 14),
      ),
      el("span", "account-name", account.name),
      el(
        "span",
        "account-amount",
        formatAmount(account.amount),
        el("span", "cur", account.currency),
      ),
    );
    row.title = `${account.name} · ${formatAmount(account.amount)} ${account.currency}`;
    if (Number(account.amount) < 0) {
      row.classList.add("is-negative");
    }
    list.append(row);
  }
  section.append(list);
  return section;
}

function monthsSection(files: LoadedFile[] | null, loaded: Ledger | null): HTMLElement {
  const section = el("section", "side-section months-section");
  const controls = el("div", "side-nav");
  const earlier = iconButton("chevron-left", "Предыдущий месяц");
  earlier.addEventListener("click", () => {
    chooseMonth(shiftMonth(selectedMonth, -1));
  });
  const later = iconButton("chevron-right", "Следующий месяц");
  later.addEventListener("click", () => {
    chooseMonth(shiftMonth(selectedMonth, 1));
  });
  controls.append(earlier, later);
  section.append(el("div", "side-head", el("h2", undefined, "Месяцы"), controls));

  const counts = new Map<string, number>();
  for (const item of loaded?.statements ?? []) {
    const month = monthOf(item.file);
    if (month && isOperation(item.statement)) {
      counts.set(month, (counts.get(month) ?? 0) + 1);
    }
  }

  const months = new Set<string>([currentMonth(), selectedMonth]);
  for (const file of files ?? []) {
    const month = monthOf(file.file);
    if (month) {
      months.add(month);
    }
  }

  const list = el("div", "month-list");
  for (const month of [...months].sort().reverse()) {
    const current = month === selectedMonth;
    const button = el("button", current ? "month-item is-current" : "month-item");
    button.type = "button";
    button.append(el("span", "month-name", monthLabel(month)));
    const count = counts.get(month);
    if (count) {
      button.append(el("span", "month-count", String(count)));
    }
    if (current) {
      button.setAttribute("aria-current", "true");
    }
    button.addEventListener("click", () => {
      chooseMonth(month);
    });
    list.append(button);
  }
  section.append(list);
  return section;
}

function sideFooter(dir: string): HTMLElement {
  const path = el(
    "div",
    "folder-path",
    icon("folder", 13),
    el("span", "folder-text", compactPath(dir)),
  );
  path.title = dir;
  const change = el("button", "btn ghost small", el("span", undefined, "Другая папка"));
  change.type = "button";
  change.addEventListener("click", () => {
    void pick();
  });
  return el("footer", "side-footer", path, change);
}

function buildMain(
  dir: string,
  files: LoadedFile[] | null,
  loaded: Ledger | null,
  error: string | null,
): HTMLElement {
  const main = el("main", "main");
  const failed = loaded?.errors.length ?? 0;
  const status = el(
    "div",
    failed > 0 ? "topbar-status is-error" : "topbar-status",
    el("span", "status-dot"),
    el("span", undefined, failed > 0 ? "Ошибки в файлах" : "Локальные файлы"),
  );
  const chatButton = iconButton("chat", "Чат с ассистентом");
  chatButton.addEventListener("click", () => {
    toggleChat();
  });
  main.append(
    el(
      "header",
      "topbar",
      status,
      el("div", "topbar-actions", chatButton, themeControl()),
    ),
  );

  const content = el("div", "content");
  if (error) {
    content.append(errorState(error));
  } else if (!loaded || !files) {
    content.append(loadingState());
  } else {
    if (loaded.errors.length > 0) {
      content.append(errorsCallout(loaded));
    }
    content.append(screenBody(dir, loaded));
  }
  main.append(content);
  return main;
}

function errorState(text: string): HTMLElement {
  const button = primaryButton("Выбрать другую папку", "folder", () => void pick());
  return el(
    "div",
    "page",
    el(
      "div",
      "error-state",
      el("span", "empty-art", icon("alert", 22)),
      el("h2", "empty-title", "Не удалось открыть папку"),
      el("p", "empty-text", text),
      el("div", "empty-actions", button),
    ),
  );
}

function loadingState(): HTMLElement {
  return el("div", "loading-state", el("span", "spinner"), el("p", "loading-text", "Читаем файлы…"));
}

function screenBody(dir: string, loaded: Ledger): HTMLElement {
  const monthStatements = statementsOfMonth(loaded, selectedMonth);
  if (screen === "stats") {
    return statsScreen(loaded);
  }
  if (screen === "accounts") {
    return accountsScreen(dir, loaded);
  }
  if (screen === "categories") {
    return categoriesScreen(dir, loaded, monthStatements);
  }
  if (screen === "debts") {
    return debtsScreen(dir, loaded);
  }
  if (screen === "debt") {
    return debtScreen(dir, loaded);
  }
  if (screen === "plans") {
    return plansScreen(dir, loaded);
  }
  if (screen === "category") {
    return categoryScreen(dir, loaded);
  }
  if (screen === "recurring") {
    return recurringScreen(dir, loaded, monthStatements);
  }
  return operationsScreen(dir, loaded, monthStatements);
}

function statementsOfMonth(loaded: Ledger, month: string): Statement[] {
  return loaded.statements.flatMap((item) =>
    monthOf(item.file) === month ? [item.statement] : [],
  );
}

function operationsScreen(dir: string, loaded: Ledger, monthStatements: Statement[]): HTMLElement {
  const page = el("div", "page");
  const movements = monthStatements.filter(isOperation);
  const accounts = firstAccounts(loaded.statements.map((item) => item.statement));
  const stats = monthStats(monthStatements);

  if (accounts.length === 0) {
    const start = el("div", "page");
    start.append(
      pageHead({
        eyebrow: "Журнал",
        title: monthLabel(selectedMonth),
        sub: "Первый счёт — начало учёта",
        actions: [monthNav()],
      }),
      emptyState({
        iconName: "wallet",
        title: "Начните со счёта",
        text: "Счёт — это наличные или карта. Заведите первый, и здесь появятся операции, остатки и сводка за месяц.",
        action: primaryButton("Создать счёт", "plus", () => chooseScreen("accounts")),
      }),
    );
    return start;
  }

  const composer = composerPanel({
    title: "Новая операция",
    hint: "Расход или доход в выбранном месяце",
    open: movements.length === 0,
    content: movementForm(dir),
  });
  const transfer = composerPanel({
    title: "Перевод или обмен",
    hint: "Между своими счетами, в том числе в разных валютах",
    open: false,
    content: transferForm(dir),
  });

  const sub =
    movements.length === 0
      ? "В этом месяце пока нет операций"
      : `${formatCount(movements.length, OPERATION_FORMS)} · ${formatCount(accounts.length, ACCOUNT_FORMS)}`;

  page.append(
    pageHead({
      eyebrow: "Журнал",
      title: monthLabel(selectedMonth),
      sub,
      actions: [monthNav(), primaryButton("Операция", "plus", () => openComposer(composer))],
    }),
  );

  const recurrings = loaded.statements.flatMap((item) =>
    item.statement.kind === "recurring" ? [item.statement] : [],
  );
  const due = recurrings.filter(
    (recurring) =>
      !alreadyPosted(monthStatements, recurring) && reminderDue(recurring.day, selectedMonth),
  );
  if (due.length > 0) {
    page.append(dueCallout(due));
  }
  if (stats.length > 0) {
    page.append(summaryStrip(stats));
  }
  const debtFlow = debtMonthFlow(debtsOf(loaded), selectedMonth);
  if (debtFlow.length > 0) {
    page.append(debtFlowLine(debtFlow, selectedMonth, () => chooseScreen("debts")));
  }
  const planTotalsOpen = planTotals(buildPlans(loaded.statements.map((item) => item.statement)));
  if (planTotalsOpen.length > 0) {
    const plans = openPlans(buildPlans(loaded.statements.map((item) => item.statement)));
    page.append(plansCallout(plans, planTotalsOpen));
  }
  page.append(composer, transfer);

  if (movements.length > 0) {
    page.append(journal(dir, movements));
  }
  page.append(sourcePanel(loaded));
  return page;
}

function statsScreen(loaded: Ledger): HTMLElement {
  const page = el("div", "page");
  page.append(
    pageHead({
      eyebrow: "Статистика",
      title: monthLabel(selectedMonth),
      sub: "Расходы, доходы и категории за месяц",
      actions: [monthNav()],
    }),
  );
  const monthStatements = statementsOfMonth(loaded, selectedMonth);
  const stats = monthStats(monthStatements);
  if (stats.length === 0) {
    page.append(
      emptyState({
        iconName: "chart",
        title: "Считать пока нечего",
        text: "В этом месяце ещё нет расходов и доходов. Добавьте операцию — сводка появится здесь.",
      }),
    );
    return page;
  }
  const previousMonth = shiftMonth(selectedMonth, -1);
  const previousLabel = monthLabel(previousMonth);
  const insights = monthInsights(monthStatements);
  const comparisons = monthComparison(stats, monthStats(statementsOfMonth(loaded, previousMonth)));
  for (const stat of stats) {
    page.append(
      currencyStats(
        stat,
        insights.find((item) => item.currency === stat.currency) ?? null,
        comparisons.find((item) => item.currency === stat.currency) ?? null,
        previousLabel,
      ),
    );
  }
  const flow = debtMonthFlow(debtsOf(loaded), selectedMonth);
  if (flow.length > 0) {
    page.append(
      debtFlowLine(
        flow,
        selectedMonth,
        () => chooseScreen("debts"),
        "Эти суммы не входят в доходы и расходы выше. Именно они объясняют, почему на счетах стало больше или меньше, чем показывает разница.",
      ),
    );
  }
  page.append(
    hintLine("Переводы между своими счетами в эти суммы не входят. Валюты не складываются."),
    hintLine("Долги в доходы и расходы не попадают: они меняют остаток счёта отдельной строкой."),
    hintLine("Клик по категории на диаграмме или в полосах открывает её историю."),
  );
  return page;
}

function currencyStats(
  stat: CurrencyStats,
  insight: MonthInsight | null,
  comparison: MonthComparison | null,
  previousLabel: string,
): HTMLElement {
  const block = el("section", "currency-block");
  const total = difference(stat.income, stat.expense);
  const tone = total.startsWith("+") ? "income" : total.startsWith("−") ? "expense" : "neutral";
  const head = el(
    "div",
    "currency-head",
    el("span", "currency-mark", stat.currency),
    el(
      "span",
      "currency-total",
      "Итог за месяц",
      el("strong", `is-${tone}`, `${total} ${stat.currency}`),
    ),
  );
  block.append(
    head,
    el(
      "div",
      "stat-grid",
      statCard("Расходы", "arrow-down", formatAmount(stat.expense), stat.currency, "expense"),
      statCard("Доходы", "arrow-up", formatAmount(stat.income), stat.currency, "income"),
      statCard("Разница", "chart", total, stat.currency, tone),
    ),
  );
  if (insight && insight.operations > 0) {
    const biggest = insight.biggest;
    block.append(
      el(
        "div",
        "stat-grid stat-grid-secondary",
        statCard(
          "Средний чек",
          "tag",
          formatAmount(insight.averageCheck),
          stat.currency,
          "neutral",
          `по ${formatCount(insight.operations, OPERATION_FORMS)}`,
        ),
        statCard(
          "Дней с тратами",
          "calendar",
          String(insight.days),
          "",
          "neutral",
          `из ${daysInMonth(selectedMonth)}`,
        ),
        statCard(
          "Крупнейшая трата",
          "alert",
          biggest ? formatAmount(biggest.amount) : formatAmount("0"),
          stat.currency,
          "expense",
          biggest ? `${biggest.title} · ${dayLabel(biggest.date)}` : undefined,
        ),
      ),
    );
    if (insight.top && stat.expense !== "0.00") {
      block.append(
        el(
          "p",
          "stat-line",
          icon("info", 14),
          el(
            "span",
            undefined,
            `Больше всего ушло на «${insight.top.name}» — ${formatAmount(insight.top.amount)} ${stat.currency}, ${percent(insight.top.amount, stat.expense)}% расходов.`,
          ),
        ),
      );
    }
  }
  if (stat.expenseCategories.length > 0) {
    block.append(
      chartCard(
        "Расходы по категориям",
        stat.expenseCategories,
        stat.expense,
        stat.currency,
        "expense",
      ),
    );
  }
  if (stat.incomeCategories.length > 0) {
    block.append(
      chartCard(
        "Доходы по категориям",
        stat.incomeCategories,
        stat.income,
        stat.currency,
        "income",
      ),
    );
  }
  if (comparison) {
    const card = comparisonCard(comparison, previousLabel);
    if (card) {
      block.append(card);
    }
  }
  return block;
}

function statCard(
  label: string,
  iconName: IconName,
  value: string,
  currency: string,
  tone: string,
  note?: string,
): HTMLElement {
  const card = el(
    "article",
    "stat-card",
    el("span", "stat-icon", icon(iconName, 15)),
    el("span", "stat-label", label),
    el(
      "strong",
      "stat-value",
      value,
      currency ? el("span", "stat-cur", currency) : null,
    ),
  );
  if (note) {
    card.append(el("span", "stat-note", note));
  }
  card.dataset.tone = tone;
  return card;
}

function chartCard(
  title: string,
  rows: { name: string; amount: string }[],
  total: string,
  currency: string,
  kind: "expense" | "income",
): HTMLElement {
  const card = el("section", "chart-card");
  card.dataset.view = chartView;
  card.append(
    el("div", "chart-head", el("h3", undefined, title), chartSwitch()),
    el("div", "chart-donut", donutChart(rows, total, currency, kind), donutLegend(rows, total)),
    el("div", "chart-bars", ...barRows(rows, total, kind)),
  );
  return card;
}

function chartSwitch(): HTMLElement {
  const group = el("div", "segmented chart-switch");
  group.setAttribute("role", "group");
  for (const [view, label] of [
    ["donut", "Кольцо"],
    ["bars", "Полосы"],
  ] as const) {
    const button = el("button", "segmented-item chart-tab", el("span", undefined, label));
    button.type = "button";
    button.dataset.view = view;
    button.setAttribute("aria-pressed", String(chartView === view));
    button.addEventListener("click", () => {
      setChartView(view);
    });
    group.append(button);
  }
  return group;
}

function setChartView(view: ChartView): void {
  chartView = view;
  try {
    window.localStorage.setItem("finbymd.chart", view);
  } catch {
    // Приватный режим без localStorage — просто переключаем без запоминания.
  }
  for (const card of document.querySelectorAll<HTMLElement>(".chart-card")) {
    card.dataset.view = view;
  }
  for (const tab of document.querySelectorAll<HTMLButtonElement>(".chart-tab")) {
    tab.setAttribute("aria-pressed", String(tab.dataset.view === view));
  }
}

function readChartView(): ChartView {
  try {
    return window.localStorage.getItem("finbymd.chart") === "bars" ? "bars" : "donut";
  } catch {
    return "donut";
  }
}

function donutChart(
  rows: { name: string; amount: string }[],
  total: string,
  currency: string,
  kind: "expense" | "income",
): HTMLElement {
  const box = el("div", "donut");
  const size = 150;
  const radius = 56;
  const circumference = 2 * Math.PI * radius;
  const totalCents = Math.max(toCents(total), 0);
  const gap = rows.length > 1 ? 2.6 : 0;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("class", "donut-svg");
  svg.setAttribute("role", "img");
  svg.setAttribute(
    "aria-label",
    `${kind === "expense" ? "Расходы" : "Доходы"} по категориям`,
  );

  let offset = 0;
  rows.forEach((row, index) => {
    const cents = Math.round(Number(row.amount) * 100);
    const share = totalCents > 0 ? cents / totalCents : 0;
    const length = Math.max(share * circumference - gap, rows.length > 1 ? 0.8 : circumference);
    const slice = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    slice.setAttribute("cx", String(size / 2));
    slice.setAttribute("cy", String(size / 2));
    slice.setAttribute("r", String(radius));
    slice.setAttribute("fill", "none");
    slice.setAttribute("stroke", `var(--chart-${(index % 10) + 1})`);
    slice.setAttribute("stroke-width", "15");
    slice.setAttribute("stroke-dasharray", `${length} ${circumference - length}`);
    slice.setAttribute("stroke-dashoffset", String(-offset));
    slice.setAttribute("transform", `rotate(-90 ${size / 2} ${size / 2})`);
    slice.setAttribute("class", "donut-slice");
    slice.setAttribute("tabindex", "0");
    slice.setAttribute("role", "button");
    slice.setAttribute("aria-label", `История категории «${row.name}»`);
    const hint = document.createElementNS("http://www.w3.org/2000/svg", "title");
    hint.textContent = `${row.name}: ${formatAmount(row.amount)} ${currency} · ${chartPercent(cents, totalCents)}`;
    slice.append(hint);
    slice.addEventListener("click", () => {
      openCategory(row.name);
    });
    slice.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openCategory(row.name);
      }
    });
    svg.append(slice);
    offset += share * circumference;
  });

  box.append(
    svg,
    el(
      "div",
      "donut-center",
      el("span", "donut-label", kind === "expense" ? "Расход" : "Доход"),
      el("strong", "donut-value", formatAmount(total)),
      el("span", "donut-cur", currency),
    ),
  );
  return box;
}

function donutLegend(
  rows: { name: string; amount: string }[],
  total: string,
): HTMLElement {
  const totalCents = Math.max(toCents(total), 0);
  const legend = el("div", "legend");
  rows.forEach((row, index) => {
    const cents = Math.round(Number(row.amount) * 100);
    const dot = el("span", "legend-dot");
    dot.style.background = `var(--chart-${(index % 10) + 1})`;
    const button = el("button", "legend-row");
    button.type = "button";
    button.title = `История категории «${row.name}»`;
    button.append(
      dot,
      el("span", "legend-name", row.name),
      el("span", "legend-percent", chartPercent(cents, totalCents)),
      el("span", "legend-amount", formatAmount(row.amount)),
    );
    button.addEventListener("click", () => {
      openCategory(row.name);
    });
    legend.append(button);
  });
  return legend;
}

function barRows(
  rows: { name: string; amount: string }[],
  total: string,
  kind: "expense" | "income",
): HTMLButtonElement[] {
  const max = Math.max(...rows.map((row) => Number(row.amount)));
  return rows.map((row) => {
    const width = max > 0 ? (Number(row.amount) / max) * 100 : 0;
    const fill = el("span", kind === "income" ? "bar-fill income" : "bar-fill");
    fill.style.width = `${width}%`;
    const button = el(
      "button",
      "bar-row",
      el("span", "bar-name", row.name),
      el("span", "bar-track", fill),
      el("span", "bar-amount", formatAmount(row.amount)),
      el("span", "bar-percent", `${percent(row.amount, total)}%`),
    );
    button.type = "button";
    button.title = `История категории «${row.name}»`;
    button.addEventListener("click", () => {
      openCategory(row.name);
    });
    return button;
  });
}

function chartPercent(part: number, total: number): string {
  if (total <= 0) {
    return "0%";
  }
  const value = (part / total) * 100;
  if (value > 0 && value < 1) {
    return "<1%";
  }
  return `${value.toFixed(value >= 10 ? 0 : 1).replace(".", ",")}%`;
}

function comparisonCard(comparison: MonthComparison, previousLabel: string): HTMLElement | null {
  if (comparison.expense.previous === "0.00" && comparison.income.previous === "0.00") {
    return null;
  }
  const card = el(
    "section",
    "delta-card",
    el(
      "div",
      "chart-head",
      el("h3", undefined, "К прошлому месяцу"),
      el("span", "chart-sub", previousLabel),
    ),
    el(
      "div",
      "delta-totals",
      deltaTotal("Расходы", comparison.expense, "expense", comparison.currency),
      deltaTotal("Доходы", comparison.income, "income", comparison.currency),
    ),
  );
  const rows = comparison.categories.slice(0, 4);
  if (rows.length > 0) {
    const list = el("div", "delta-list");
    for (const row of rows) {
      list.append(deltaRow(row));
    }
    card.append(list);
  }
  return card;
}

function deltaTotal(
  label: string,
  delta: AmountDelta,
  kind: "expense" | "income",
  currency: string,
): HTMLElement {
  return el(
    "div",
    "delta-total",
    el("span", "delta-label", label),
    el(
      "span",
      "delta-value",
      formatAmount(delta.current),
      el("span", "delta-cur", currency),
    ),
    el("span", `delta-badge ${deltaClass(delta.deltaCents, kind)}`, deltaText(delta.deltaCents)),
    el("span", "delta-note", changeNote(delta)),
  );
}

function deltaRow(row: CategoryDelta): HTMLElement {
  const button = el("button", "delta-row");
  button.type = "button";
  button.title = `История категории «${row.name}»`;
  button.append(
    el("span", "delta-name", row.name),
    el(
      "span",
      "delta-move",
      formatAmount(row.previous),
      el("span", "delta-arrow", "→"),
      formatAmount(row.current),
    ),
    el(
      "span",
      `delta-badge ${deltaClass(row.deltaCents, "expense")}`,
      deltaText(row.deltaCents),
    ),
  );
  button.addEventListener("click", () => {
    openCategory(row.name);
  });
  return button;
}

/** Рост расходов — плохо, рост доходов — хорошо; красим одинаковыми цветами. */
function deltaClass(cents: number, kind: "expense" | "income"): "is-good" | "is-bad" | "is-flat" {
  if (cents === 0) {
    return "is-flat";
  }
  const growing = cents > 0;
  return growing === (kind === "income") ? "is-good" : "is-bad";
}

function deltaText(cents: number): string {
  if (cents === 0) {
    return formatAmount("0");
  }
  return `${cents > 0 ? "+" : "−"}${formatAmount((Math.abs(cents) / 100).toFixed(2))}`;
}

function changeNote(delta: AmountDelta): string {
  if (delta.deltaCents === 0) {
    return "как в прошлом месяце";
  }
  if (delta.percent === null) {
    return "в прошлом месяце не было";
  }
  const percent = delta.percent.toFixed(1).replace(/\.0$/, "").replace(".", ",");
  return `${delta.percent > 0 ? "+" : "−"}${percent}%`;
}

function daysInMonth(month: string): number {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

function categoryScreen(dir: string, loaded: Ledger): HTMLElement {
  const page = el("div", "page");
  const category = uniqueCategories(loaded.statements.map((item) => item.statement)).find(
    (item) => item.name === selectedCategory,
  );
  const back = el("button", "btn ghost small", icon("chevron-left", 14), el("span", undefined, "Категории"));
  back.type = "button";
  back.addEventListener("click", () => {
    chooseScreen("categories");
  });

  if (!category) {
    page.append(
      pageHead({ eyebrow: "Категория", title: "Не найдена", actions: [back] }),
      emptyState({
        iconName: "tag",
        title: "Категория не найдена",
        text: "Возможно, её переименовали в markdown-файле. Вернитесь к списку категорий.",
        action: primaryButton("Все категории", "tag", () => chooseScreen("categories")),
      }),
    );
    return page;
  }

  const rows = loaded.statements
    .flatMap((item) => {
      const month = monthOf(item.file);
      const statement = item.statement;
      if (!month || (statement.kind !== "expense" && statement.kind !== "income")) {
        return [];
      }
      if (statement.category !== category.name || statement.kind !== category.categoryKind) {
        return [];
      }
      return [{ file: item.file, month, statement }];
    })
    .sort(
      (left, right) =>
        right.statement.date.localeCompare(left.statement.date) ||
        right.statement.line - left.statement.line,
    );
  const history = categoryHistory(
    rows.map(({ month, statement }) => ({ month, statement })),
    category,
  );
  const kindLabel = category.categoryKind === "income" ? "Доход" : "Расход";
  const sub =
    history.operations === 0
      ? "Пока без операций"
      : `${kindLabel} · ${formatCount(history.operations, OPERATION_FORMS)} · ${formatCount(history.months, ["месяц", "месяца", "месяцев"])}`;

  page.append(pageHead({ eyebrow: "Категория", title: category.name, sub, actions: [back] }));

  if (history.operations === 0) {
    page.append(
      emptyState({
        iconName: "tag",
        title: "Здесь пока пусто",
        text: "У этой категории ещё нет операций. Добавьте расход или доход в журнале — история появится сама.",
        action: primaryButton("К операциям", "list", () => chooseScreen("operations")),
      }),
    );
    return page;
  }

  for (const total of history.totals) {
    const perMonth = history.perMonth.find((item) => item.currency === total.currency)?.amount ?? "0.00";
    const averageCheck =
      history.averageCheck.find((item) => item.currency === total.currency)?.amount ?? "0.00";
    page.append(
      el(
        "div",
        "currency-block",
        el("div", "currency-head", el("span", "currency-mark", total.currency)),
        el(
          "div",
          "stat-grid",
          statCard("Всего", "wallet", formatAmount(total.amount), total.currency, category.categoryKind),
          statCard("В месяц", "calendar", formatAmount(perMonth), total.currency, "neutral"),
          statCard("Средний чек", "tag", formatAmount(averageCheck), total.currency, "neutral"),
        ),
      ),
    );
  }

  if (history.biggest) {
    const biggest = history.biggest;
    page.append(
      hintLine(
        `Крупнейшая операция — ${formatAmount(biggest.amount)} ${biggest.currency}${biggest.title ? `, «${biggest.title}»` : ""}, ${dayLabel(biggest.date)}.`,
      ),
    );
  }

  if (history.monthly.length > 1) {
    page.append(monthTrend(history, category.categoryKind));
  }

  const journal = el("div", "journal history");
  for (const monthRow of history.monthly) {
    const items = rows.filter((row) => row.month === monthRow.month);
    const list = el("ul", "ops");
    for (const row of items) {
      list.append(movementItem(dir, row.file, row.statement, { date: true, chip: false }));
    }
    journal.append(
      el(
        "section",
        "day",
        el(
          "div",
          "day-head",
          el("span", "day-title", monthLabel(monthRow.month)),
          el("span", "day-weekday", formatCount(items.length, OPERATION_FORMS)),
          el(
            "span",
            "day-meta",
            monthRow.totals
              .map((item) => `${formatAmount(item.amount)} ${item.currency}`)
              .join(" · "),
          ),
        ),
        list,
      ),
    );
  }
  page.append(el("h2", "section-title", "История"), journal);
  return page;
}

function monthTrend(
  history: ReturnType<typeof categoryHistory>,
  kind: "expense" | "income",
): HTMLElement {
  const primary = history.totals[0]?.currency;
  const points = [...history.monthly].reverse().map((row) => ({
    month: row.month,
    operations: row.operations,
    amount: row.totals.find((item) => item.currency === primary)?.amount ?? "0.00",
  }));
  const max = Math.max(...points.map((point) => Number(point.amount)));
  const block = el(
    "section",
    "bars trend",
    el("h3", undefined, primary ? `По месяцам, ${primary}` : "По месяцам"),
  );
  for (const point of points) {
    const width = max > 0 ? (Number(point.amount) / max) * 100 : 0;
    const fill = el("span", kind === "income" ? "bar-fill income" : "bar-fill");
    fill.style.width = `${width}%`;
    block.append(
      el(
        "div",
        "bar-row static",
        el("span", "bar-name", shortMonth(point.month)),
        el("span", "bar-track", fill),
        el("span", "bar-amount", formatAmount(point.amount)),
        el("span", "bar-percent", `${point.operations} оп.`),
      ),
    );
  }
  return block;
}

function shortMonth(month: string): string {
  const [name = month, year = ""] = monthLabel(month).split(" ");
  return `${name.slice(0, 3)} ${year.slice(2)}`;
}

function openCategory(name: string): void {
  selectedCategory = name;
  screen = "category";
  if (currentDir && lastFiles) {
    render(currentDir, lastFiles, null);
  }
}

/* ————————————————————————— долги ————————————————————————— */

function debtsOf(loaded: Ledger): Debt[] {
  return buildDebts(loaded.statements.map((item) => item.statement));
}

function debtsScreen(dir: string, loaded: Ledger): HTMLElement {
  const page = el("div", "page");
  const debts = debtsOf(loaded);
  const open = debts.filter((debt) => debt.status === "open");
  const closed = debts.filter((debt) => debt.status === "closed");
  const totals = debtTotals(debts);
  const flow = debtMonthFlow(debts, selectedMonth);

  const composer = composerPanel({
    title: "Новый долг",
    hint: "Мне дали в долг или я дал в долг",
    open: debts.length === 0,
    content: debtForm(dir, loaded),
  });

  page.append(
    pageHead({
      eyebrow: "Долги",
      title: "Долги",
      sub:
        open.length === 0
          ? "Пока ни одного открытого долга"
          : `${formatCount(open.length, ["открытый долг", "открытых долга", "открытых долгов"])} · ${formatCount(closed.length, ["закрыт", "закрыто", "закрыто"])}`,
      actions: [primaryButton("Долг", "plus", () => openComposer(composer))],
    }),
  );

  if (debts.length === 0) {
    page.append(
      emptyState({
        iconName: "debt",
        title: "Долгов пока нет",
        text: "Запишите, кто дал вам денег или кому дали вы. Сумма на счёте изменится, а долг останется здесь.",
        action: primaryButton("Новый долг", "plus", () => openComposer(composer)),
      }),
      composer,
    );
    return page;
  }

  page.append(composer);

  if (totals.length > 0) {
    const grid = el("div", "debt-totals");
    for (const total of totals) {
      grid.append(
        el(
          "article",
          "debt-total",
          el("span", "currency-mark", total.currency),
          el(
            "div",
            "debt-total-row",
            debtTotalLine("Я должен", total.owe, total.currency, "owe"),
            debtTotalLine("Мне должны", total.owed, total.currency, "owed"),
          ),
        ),
      );
    }
    page.append(grid);
  }

  if (flow.length > 0) {
    page.append(debtFlowLine(flow, selectedMonth));
  }

  for (const group of [
    { title: "Открытые", items: open },
    { title: "Закрытые", items: closed },
  ]) {
    if (group.items.length === 0) {
      continue;
    }
    page.append(el("h2", "section-title", group.title));
    const list = el("div", "debt-list");
    for (const debt of group.items) {
      list.append(debtCard(dir, debt, loaded));
    }
    page.append(list);
  }

  page.append(
    hintLine(
      "Долг меняет остаток счёта, но не попадает в доходы и расходы: в статистике он идёт отдельной строкой.",
    ),
  );
  return page;
}

function debtTotalLine(label: string, amount: string, currency: string, tone: string): HTMLElement {
  const row = el(
    "div",
    "debt-total-line",
    el("span", "debt-total-label", label),
    el("strong", "debt-total-value", formatAmount(amount), el("span", "stat-cur", currency)),
  );
  row.dataset.tone = amount === "0.00" ? "neutral" : tone;
  return row;
}

function debtFlowLine(
  flow: DebtFlow[],
  month: string,
  onOpen?: () => void,
  note?: string,
): HTMLElement {
  const box = el("div", "debt-flow");
  const head = el("div", "debt-flow-head");
  head.append(el("span", "debt-flow-title", `Долги за ${monthLabel(month).toLowerCase()}`));
  if (onOpen) {
    const link = el("button", "btn ghost small", el("span", undefined, "Все долги"));
    link.type = "button";
    link.addEventListener("click", onOpen);
    head.append(link);
  }
  box.append(head);
  for (const item of flow) {
    const parts: string[] = [];
    if (item.borrowed !== "0.00") {
      parts.push(`взял ${formatAmount(item.borrowed)}`);
    }
    if (item.repaid !== "0.00") {
      parts.push(`вернул ${formatAmount(item.repaid)}`);
    }
    if (item.lent !== "0.00") {
      parts.push(`дал ${formatAmount(item.lent)}`);
    }
    if (item.collected !== "0.00") {
      parts.push(`получил назад ${formatAmount(item.collected)}`);
    }
    if (item.forgiven !== "0.00") {
      parts.push(`прощено ${formatAmount(item.forgiven)}`);
    }
    box.append(
      el(
        "div",
        "debt-flow-row",
        el("span", "currency-mark", item.currency),
        el("span", "debt-flow-text", parts.join(" · ")),
        el(
          "span",
          "debt-flow-cash",
          `на счетах ${item.cash.startsWith("-") ? "−" : "+"}${formatAmount(item.cash.replace("-", ""))} ${item.currency}`,
        ),
      ),
    );
  }
  if (note) {
    box.append(el("p", "debt-flow-note", note));
  }
  return box;
}

function debtCard(dir: string, debt: Debt, loaded: Ledger): HTMLElement {
  const card = el("article", "debt-card");
  card.dataset.status = debt.status;
  card.dataset.direction = debt.direction;

  const title = el("button", "debt-name", debt.person);
  title.type = "button";
  title.title = "Открыть историю долга";
  title.addEventListener("click", () => {
    openDebt(debt.id);
  });

  const remaining =
    debt.status === "closed"
      ? el("span", "debt-closed", "закрыт")
      : el(
          "strong",
          "debt-remaining",
          formatAmount(debt.remaining),
          el("span", "stat-cur", debt.currency),
        );

  const head = el(
    "div",
    "debt-head",
    el(
      "div",
      "debt-head-text",
      el(
        "div",
        "debt-title-line",
        title,
        el(
          "span",
          debt.direction === "owe" ? "op-chip is-owe" : "op-chip is-owed",
          debt.direction === "owe" ? "я должен" : "мне должны",
        ),
      ),
      el(
        "span",
        "debt-sub",
        debt.agreed === debt.principal
          ? `${formatAmount(debt.principal)} ${debt.currency} · ${dayLabel(debt.opened)}`
          : `${formatAmount(debt.principal)} → ${formatAmount(debt.agreed)} ${debt.currency} · ${dayLabel(debt.opened)}`,
      ),
    ),
    remaining,
  );
  card.append(head);

  const principalCents = Math.max(Math.round(Number(debt.principal) * 100), 1);
  const paidShare = Math.min(Math.round((Number(debt.paid) * 10000) / principalCents), 100);
  const forgivenShare = Math.min(
    Math.round((Number(debt.forgiven) * 10000) / principalCents),
    100 - paidShare,
  );
  const track = el("span", "debt-track");
  const paid = el("span", "debt-fill paid");
  paid.style.width = `${paidShare}%`;
  track.append(paid);
  if (forgivenShare > 0) {
    const forgiven = el("span", "debt-fill forgiven");
    forgiven.style.width = `${forgivenShare}%`;
    forgiven.title = `прощено ${formatAmount(debt.forgiven)} ${debt.currency}`;
    track.append(forgiven);
  }
  card.append(
    el(
      "div",
      "debt-progress",
      track,
      el(
        "span",
        "debt-progress-text",
        debt.status === "closed"
          ? `возвращено ${formatAmount(debt.paid)} из ${formatAmount(debt.agreed)}`
          : `возвращено ${formatAmount(debt.paid)} из ${formatAmount(debt.agreed)} · ${debt.forgiven !== "0.00" ? `прощено ${formatAmount(debt.forgiven)}` : "без прощений"}`,
      ),
    ),
  );

  if (debt.status === "open") {
    const actions = el("div", "debt-actions");
    const settle = primaryButton(
      debt.direction === "owe" ? "Вернуть" : "Получить",
      debt.direction === "owe" ? "arrow-up" : "arrow-down",
    );
    settle.classList.add("small");
    settle.addEventListener("click", () => {
      toggleInline(actions, () => paymentForm(dir, debt, loaded));
    });
    const change = el(
      "button",
      "btn subtle small",
      el("span", undefined, "Изменить сумму"),
    );
    change.type = "button";
    change.addEventListener("click", () => {
      toggleInline(actions, () => agreedForm(dir, debt, loaded));
    });
    const forgive = el("button", "btn ghost small", el("span", undefined, "Простить"));
    forgive.type = "button";
    forgive.addEventListener("click", () => {
      void forgiveDebt(dir, debt, loaded);
    });
    actions.append(settle, change, forgive);
    card.append(actions);
  }

  const history = el("button", "debt-history-link", "История");
  history.type = "button";
  history.addEventListener("click", () => {
    openDebt(debt.id);
  });
  card.append(history);
  return card;
}

/** Показывает форму сразу под блоком действий, а не в конце карточки. */
function toggleInline(host: HTMLElement, build: () => HTMLElement): void {
  const existing = host.parentElement?.querySelector(".debt-inline");
  if (existing) {
    existing.remove();
    return;
  }
  const form = build();
  host.after(form);
  form.querySelector<HTMLInputElement>("input")?.focus();
}

function debtForm(dir: string, loaded: Ledger): HTMLFormElement {
  const form = el("form", "form form-grid form-debt");
  const accounts = firstAccounts(loaded.statements.map((item) => item.statement));

  const direction = segmented(
    [
      { value: "to", label: "Мне дали" },
      { value: "from", label: "Я дал" },
    ],
    "to",
  );
  const person = inputField("Кто", { placeholder: "Андрей", required: true });
  const amount = inputField("Сумма", {
    value: "0.00",
    required: true,
    inputMode: "decimal",
    className: "field-amount",
  });
  const account = selectField(
    "Счёт",
    accounts.map((item) => ({ value: item.name, label: `${item.name} · ${item.currency}` })),
  );
  const date = inputField("Дата", { type: "date", required: true, value: todayDate() });
  const description = inputField("Заметка", {
    placeholder: "верну 40, договорились",
    className: "field-wide",
  });
  const hint = el("p", "form-hint");
  if (accounts.length === 0) {
    hint.textContent = "Сначала добавьте счёт в разделе «Счета».";
    hint.classList.add("warn");
  }

  const submit = primaryButton("Записать долг", "check");
  submit.type = "submit";
  submit.disabled = accounts.length === 0;
  const error = formError();

  form.append(
    el("div", "span-all", direction.element),
    person.label,
    amount.label,
    account.label,
    date.label,
    description.label,
    hint,
    error,
    el("div", "form-actions", submit),
  );

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (submit.disabled) {
      return;
    }
    submit.disabled = true;
    void submitDebt(
      dir,
      loaded,
      {
        person: person.input.value,
        amount: amount.input.value,
        direction: direction.get(),
        account: account.select.value,
        date: date.input.value,
        description: description.input.value,
      },
      error,
    ).finally(() => {
      submit.disabled = accounts.length === 0;
    });
  });
  return form;
}

async function submitDebt(
  dir: string,
  loaded: Ledger,
  input: {
    person: string;
    amount: string;
    direction: string;
    account: string;
    date: string;
    description: string;
  },
  error: HTMLParagraphElement,
): Promise<void> {
  try {
    const accounts = firstAccounts(loaded.statements.map((item) => item.statement));
    const account = accounts.find((item) => item.name === input.account);
    if (!account) {
      showFormError(error, "Выберите счёт");
      return;
    }
    const debts = debtsOf(loaded);
    const nextIds = [
      ...debts.map((debt) => debt.id),
      ...(lastFiles ?? []).flatMap((file) => retiredIds(file.source)),
    ];
    const debt = prepareDebt({
      ...input,
      currency: account.currency,
      ids: nextIds,
    });
    if (typeof debt === "string") {
      showFormError(error, debt);
      return;
    }
    await appendToDebts(dir, debtLine(debt));
    error.hidden = true;
    await reload();
    toast(
      debt.direction === "to"
        ? `Записано: вы должны «${debt.person}»`
        : `Записано: «${debt.person}» должен вам`,
    );
  } catch (caught) {
    showFormError(error, message(caught));
  }
}

async function appendToPlans(dir: string, line: string): Promise<void> {
  const path = await join(dir, "plans.md");
  let source: string;
  try {
    source = await readTextFile(path);
  } catch {
    source = "# Планы\n\n```finance\n```\n";
  }
  await writeTextFile(path, appendStatement(source, line));
}

async function appendToDebts(dir: string, line: string): Promise<void> {
  const path = await join(dir, "debts.md");
  let source: string;
  try {
    source = await readTextFile(path);
  } catch {
    source = "# Долги\n\n```finance\n```\n";
  }
  await writeTextFile(path, appendStatement(source, line));
}

function openDebt(id: string): void {
  selectedDebt = id;
  screen = "debt";
  if (currentDir && lastFiles) {
    render(currentDir, lastFiles, null);
  }
}

function debtScreen(dir: string, loaded: Ledger): HTMLElement {
  const page = el("div", "page");
  const debts = debtsOf(loaded);
  const debt = debts.find((item) => item.id === selectedDebt);
  const back = el("button", "btn ghost small", icon("chevron-left", 14), el("span", undefined, "Долги"));
  back.type = "button";
  back.addEventListener("click", () => {
    chooseScreen("debts");
  });

  if (!debt) {
    page.append(
      pageHead({ eyebrow: "Долг", title: "Не найден", actions: [back] }),
      emptyState({
        iconName: "debt",
        title: "Долг не найден",
        text: "Возможно, строку убрали из debts.md. Вернитесь к списку долгов.",
        action: primaryButton("Все долги", "debt", () => chooseScreen("debts")),
      }),
    );
    return page;
  }

  const owed = debt.direction === "owe" ? "Вы должны" : "Вам должны";
  page.append(
    pageHead({
      eyebrow: "Долг",
      title: debt.person,
      sub:
        debt.status === "closed"
          ? `${owed} · закрыт ${lowerFirst(dayLabel(debt.events[debt.events.length - 1]?.date ?? debt.opened))}`
          : `${owed} ${formatAmount(debt.remaining)} ${debt.currency}`,
      actions: [back],
    }),
  );

  const cards = el(
    "div",
    "stat-grid stat-grid-secondary",
    statCard(
      debt.direction === "owe" ? "Взял" : "Дал",
      "debt",
      formatAmount(debt.principal),
      debt.currency,
      debt.direction === "owe" ? "expense" : "income",
      dayLabel(debt.opened),
    ),
    statCard(
      "Договорились",
      "check",
      formatAmount(debt.agreed),
      debt.currency,
      "neutral",
      debt.agreed === debt.principal ? "как взяли" : `было ${formatAmount(debt.principal)}`,
    ),
    statCard(
      debt.direction === "owe" ? "Вернул" : "Получил",
      "swap",
      formatAmount(debt.paid),
      debt.currency,
      "neutral",
      formatCount(debt.events.filter((event) => event.kind === "pay").length, [
        "платёж",
        "платежа",
        "платежей",
      ]),
    ),
  );
  page.append(cards);
  if (debt.forgiven !== "0.00") {
    page.append(
      hintLine(`Прощено ${formatAmount(debt.forgiven)} ${debt.currency}: остаток уменьшился без движения денег.`),
    );
  }
  if (debt.description) {
    page.append(hintLine(debt.description));
  }

  if (debt.status === "open") {
    const actions = el("div", "debt-actions is-block");
    const settle = primaryButton(
      debt.direction === "owe" ? "Вернуть часть" : "Получить часть",
      null,
    );
    settle.addEventListener("click", () => {
      toggleInline(actions, () => paymentForm(dir, debt, loaded));
    });
    const change = el("button", "btn subtle small", el("span", undefined, "Изменить сумму"));
    change.type = "button";
    change.addEventListener("click", () => {
      toggleInline(actions, () => agreedForm(dir, debt, loaded));
    });
    const forgive = el("button", "btn ghost small", el("span", undefined, "Простить остаток"));
    forgive.type = "button";
    forgive.addEventListener("click", () => {
      void forgiveDebt(dir, debt, loaded);
    });
    actions.append(settle, change, forgive);
    page.append(actions);
  }

  page.append(el("h2", "section-title", "Как менялся долг"));
  const list = el("ul", "debt-events");
  for (const event of [...debt.events].reverse()) {
    list.append(debtEventRow(event, debt));
  }
  page.append(list);
  page.append(
    hintLine(`Строки долга лежат в debts.md. Счёт «${debt.account}» меняется сразу, история остаётся в файле.`),
  );
  return page;
}

function debtEventRow(event: DebtEvent, debt: Debt): HTMLLIElement {
  const label =
    event.kind === "open"
      ? debt.direction === "owe"
        ? "Взяли в долг"
        : "Дали в долг"
      : event.kind === "pay"
        ? debt.direction === "owe"
          ? "Вернули"
          : "Получили назад"
        : event.kind === "agreed"
          ? "Договорились о новой сумме"
          : "Долг прощён";
  const amount =
    event.kind === "forgive"
      ? `прощено ${formatAmount(event.amount)} ${debt.currency}`
      : event.kind === "agreed"
        ? `теперь ${formatAmount(event.amount)} ${debt.currency}${event.forgiven ? ` · прощено ${formatAmount(event.forgiven)}` : ""}`
        : `${formatAmount(event.amount)} ${debt.currency}`;
  const row = el(
    "li",
    "debt-event",
    el("span", "debt-event-dot"),
    el(
      "div",
      "debt-event-body",
      el("span", "debt-event-title", label),
      el(
        "span",
        "debt-event-meta",
        [dayLabel(event.date), event.account, event.description].filter(Boolean).join(" · "),
      ),
    ),
    el("span", "debt-event-amount", amount),
  );
  row.dataset.kind = event.kind;
  return row;
}

function paymentForm(dir: string, debt: Debt, loaded: Ledger): HTMLElement {
  const form = el("form", "form form-grid debt-inline");
  const accounts = firstAccounts(loaded.statements.map((item) => item.statement)).filter(
    (item) => item.currency === debt.currency,
  );
  const amount = inputField(
    debt.direction === "owe" ? "Вернуть" : "Получить",
    {
      value: debt.remaining,
      required: true,
      inputMode: "decimal",
      className: "field-amount",
    },
  );
  const account = selectField(
    "Счёт",
    accounts.map((item) => ({ value: item.name, label: `${item.name} · ${item.currency}` })),
  );
  const date = inputField("Дата", { type: "date", required: true, value: todayDate() });
  const description = inputField("Заметка", { placeholder: "наличными", className: "field-wide" });
  const submit = primaryButton(
    debt.direction === "owe" ? "Записать возврат" : "Записать получение",
    "check",
  );
  submit.type = "submit";
  submit.disabled = accounts.length === 0;
  const hint = el("p", "form-hint");
  if (accounts.length === 0) {
    hint.textContent = `Нужен счёт в ${debt.currency}.`;
    hint.classList.add("warn");
  }
  const error = formError();

  form.append(
    amount.label,
    account.label,
    date.label,
    description.label,
    hint,
    error,
    el("div", "form-actions", submit),
  );

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (submit.disabled) {
      return;
    }
    submit.disabled = true;
    void submitPayment(
      dir,
      debt,
      {
        amount: amount.input.value,
        account: account.select.value,
        date: date.input.value,
        description: description.input.value,
      },
      accounts,
      error,
    ).finally(() => {
      submit.disabled = accounts.length === 0;
    });
  });
  return form;
}

async function submitPayment(
  dir: string,
  debt: Debt,
  input: { amount: string; account: string; date: string; description: string },
  accounts: AccountStatement[],
  error: HTMLParagraphElement,
): Promise<void> {
  try {
    const account = accounts.find((item) => item.name === input.account);
    if (!account) {
      showFormError(error, "Выберите счёт");
      return;
    }
    const prepared = preparePayment(debt, { ...input, account });
    if (typeof prepared === "string") {
      showFormError(error, prepared);
      return;
    }
    await appendToDebts(
      dir,
      debtPaymentLine({
        debt: debt.id,
        date: prepared.date,
        amount: prepared.amount,
        currency: debt.currency,
        direction: settleDirection(debt),
        account: prepared.account,
        ...(prepared.description ? { description: prepared.description } : {}),
      }),
    );
    error.hidden = true;
    await reload();
    toast(debt.direction === "owe" ? "Возврат записан" : "Получение записано");
  } catch (caught) {
    showFormError(error, message(caught));
  }
}

function agreedForm(dir: string, debt: Debt, loaded: Ledger): HTMLElement {
  const form = el("form", "form form-grid debt-inline");
  const amount = inputField("Новая сумма долга", {
    value: debt.agreed,
    required: true,
    inputMode: "decimal",
    className: "field-amount",
  });
  const date = inputField("Дата", { type: "date", required: true, value: todayDate() });
  const description = inputField("Почему", {
    placeholder: "договорились вернуть меньше",
    className: "field-wide",
  });
  const submit = primaryButton("Сохранить сумму", "check");
  submit.type = "submit";
  const error = formError();

  form.append(
    amount.label,
    date.label,
    description.label,
    error,
    el("div", "form-actions", submit),
  );

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit.disabled = true;
    void (async () => {
      try {
        const prepared = prepareAgreed(debt, {
          amount: amount.input.value,
          date: date.input.value,
          description: description.input.value,
        });
        if (typeof prepared === "string") {
          showFormError(error, prepared);
          return;
        }
        await appendToDebts(
          dir,
          debtAgreedLine({
            debt: debt.id,
            date: prepared.date,
            amount: prepared.amount,
            ...(prepared.description ? { description: prepared.description } : {}),
          }),
        );
        await reload();
        toast("Сумма долга обновлена");
      } catch (caught) {
        showFormError(error, message(caught));
      } finally {
        submit.disabled = false;
      }
    })();
  });
  void loaded;
  return form;
}

async function forgiveDebt(dir: string, debt: Debt, loaded: Ledger): Promise<void> {
  void loaded;
  const rest = formatAmount(debt.remaining);
  const confirmed = await confirmAction({
    title: "Простить долг?",
    text: `Остаток ${rest} ${debt.currency} по долгу с «${debt.person}» закроется. Деньги по счетам не двигаются, строка останется в debts.md.`,
    confirmLabel: "Простить",
  });
  if (!confirmed) {
    return;
  }
  try {
    await appendToDebts(
      dir,
      debtForgiveLine({ debt: debt.id, date: todayDate() }),
    );
    await reload();
    toast("Долг закрыт");
  } catch (caught) {
    toast(message(caught), "error");
  }
}

/* ————————————————————————— планы ————————————————————————— */

function plansScreen(dir: string, loaded: Ledger): HTMLElement {
  const page = el("div", "page");
  const plans = buildPlans(loaded.statements.map((item) => item.statement));
  const open = openPlans(plans);
  const totals = planTotals(plans);
  const accountBalances = balances(loaded.statements.map((item) => item.statement));

  const composer = composerPanel({
    title: "Новый план",
    hint: "Куда потратить деньги",
    open: plans.length === 0,
    content: planForm(dir, loaded),
  });

  page.append(
    pageHead({
      eyebrow: "Планы",
      title: "Куда потратить",
      sub:
        plans.length === 0
          ? "Пока ни одного плана"
          : `${formatCount(open.length, ["план", "плана", "планов"])} · ${formatCount(plans.length - open.length, ["выполнен", "выполнено", "выполнено"])}`,
      actions: [primaryButton("План", "plus", () => openComposer(composer))],
    }),
  );

  if (plans.length === 0) {
    page.append(
      emptyState({
        iconName: "plan",
        title: "Планов пока нет",
        text: "Запишите крупную трату: сумму, срок и важность. Программа покажет, сколько денег останется после них.",
        action: primaryButton("Новый план", "plus", () => openComposer(composer)),
      }),
      composer,
    );
    return page;
  }

  page.append(composer);

  if (totals.length > 0) {
    const grid = el("div", "plan-totals");
    for (const total of totals) {
      const free = accountBalances
        .filter((account) => account.currency === total.currency)
        .reduce((sum, account) => sum + Math.round(Number(account.amount) * 100), 0);
      const left = free - Math.round(Number(total.amount) * 100);
      const ready = left >= 0;
      const card = el(
        "article",
        "plan-total",
        el("span", "currency-mark", total.currency),
        el(
          "div",
          "plan-total-body",
          el(
            "span",
            "plan-total-line",
            el("span", "debt-total-label", "На планы"),
            el("strong", "debt-total-value", formatAmount(total.amount), el("span", "stat-cur", total.currency)),
          ),
          el(
            "span",
            "plan-total-line",
            el("span", "debt-total-label", ready ? "Останется" : "Не хватает"),
            el(
              "strong",
              ready ? "debt-total-value" : "debt-total-value is-short",
              formatAmount((Math.abs(left) / 100).toFixed(2)),
              el("span", "stat-cur", total.currency),
            ),
          ),
        ),
      );
      card.dataset.ready = String(ready);
      grid.append(card);
    }
    page.append(grid);
  }

  const pending = el("div", "plan-list");
  for (const plan of open) {
    pending.append(planRow(dir, plan));
  }
  page.append(pending);

  const done = plans.filter((plan) => plan.done !== undefined);
  if (done.length > 0) {
    const details = el("details", "plan-done-block");
    details.append(
      el("summary", undefined, el("span", undefined, `Выполненные · ${done.length}`)),
    );
    const list = el("div", "plan-list");
    for (const plan of done) {
      list.append(planRow(dir, plan));
    }
    details.append(list);
    page.append(details);
  }

  page.append(
    hintLine("Планы не двигают деньги: они только показывают, сколько останется на счетах после покупок."),
  );
  return page;
}

function planRow(dir: string, plan: Plan): HTMLElement {
  const row = el("article", "plan-row");
  row.dataset.done = String(plan.done !== undefined);
  if (plan.priority) {
    row.dataset.priority = String(plan.priority);
  }

  const check = el("button", plan.done ? "plan-check is-done" : "plan-check");
  check.type = "button";
  check.title = plan.done ? "Вернуть в планы" : "Отметить выполненным";
  check.setAttribute("aria-label", check.title);
  check.append(icon("check", 13));
  check.addEventListener("click", () => {
    void togglePlan(dir, plan);
  });

  const meta: string[] = [];
  if (plan.due) {
    meta.push(dueLabel(plan.due, plan.done === undefined));
  }
  if (plan.priority) {
    meta.push(plan.priority === 1 ? "важное" : plan.priority === 2 ? "обычное" : "потом");
  }
  if (plan.description) {
    meta.push(plan.description);
  }
  if (plan.done) {
    meta.push(`выполнено ${dayLabel(plan.done)}`);
  }

  const body = el(
    "div",
    "plan-body",
    el("span", "plan-title", plan.title),
    el("span", "plan-meta", meta.join(" · ")),
  );
  const amount = el(
    "span",
    "plan-amount",
    formatAmount(plan.amount),
    el("span", "stat-cur", plan.currency),
  );
  const remove = iconButton("trash", "Удалить план", "danger");
  remove.addEventListener("click", () => {
    void removePlan(dir, plan);
  });

  row.append(check, body, amount, remove);
  return row;
}

function lowerFirst(text: string): string {
  return text.length === 0 ? text : text[0].toLowerCase() + text.slice(1);
}

function dueLabel(due: string, active: boolean): string {
  if (!active) {
    return `срок ${dayLabel(due)}`;
  }
  const today = todayDate();
  if (due < today) {
    return `просрочено · ${dayLabel(due)}`;
  }
  if (due === today) {
    return "сегодня";
  }
  return `до ${dayLabel(due)}`;
}

async function togglePlan(dir: string, plan: Plan): Promise<void> {
  try {
    const path = await join(dir, "plans.md");
    const source = await readTextFile(path);
    const next =
      plan.done === undefined
        ? appendStatement(source, planDoneLine(plan.id, todayDate()))
        : removePlanMarks(source, plan.id);
    if (next === null) {
      toast("Строка уже изменилась. Проверьте файл.", "error");
      return;
    }
    await writeTextFile(path, next);
    await reload();
    toast(plan.done === undefined ? "План выполнен" : "План снова в списке");
  } catch (caught) {
    toast(message(caught), "error");
  }
}

/** Убирает строки плана и отметки о выполнении. */
function removePlanMarks(source: string, id: string): string | null {
  const lines = source.split(/\r?\n/);
  const drop = new Set<number>();
  for (const statement of parseFinance(source).statements) {
    if (statement.kind === "plan" && statement.id === id) {
      drop.add(statement.line - 1);
    }
    if (statement.kind === "plan-done" && statement.plan === id) {
      drop.add(statement.line - 1);
    }
  }
  if (drop.size === 0) {
    return null;
  }
  return lines.filter((_, index) => !drop.has(index)).join(source.includes("\r\n") ? "\r\n" : "\n");
}

async function removePlan(dir: string, plan: Plan): Promise<void> {
  const confirmed = await confirmAction({
    title: "Удалить план?",
    text: `«${plan.title}» исчезнет из plans.md вместе с отметкой о выполнении.`,
    confirmLabel: "Удалить",
  });
  if (!confirmed) {
    return;
  }
  try {
    const path = await join(dir, "plans.md");
    const source = await readTextFile(path);
    const next = removePlanMarks(source, plan.id);
    if (next === null) {
      toast("Строка уже изменилась. Проверьте файл.", "error");
      return;
    }
    await writeTextFile(path, next);
    await reload();
    toast("План удалён");
  } catch (caught) {
    toast(message(caught), "error");
  }
}

function planForm(dir: string, loaded: Ledger): HTMLFormElement {
  const form = el("form", "form form-grid form-plan");
  const currencies = firstAccounts(loaded.statements.map((item) => item.statement)).map(
    (account) => account.currency,
  );
  const unique = [...new Set(currencies.length > 0 ? currencies : ["BYN"])];
  const plans = buildPlans(loaded.statements.map((item) => item.statement));

  const title = inputField("Что купить", { placeholder: "Телевизор", required: true });
  const amount = inputField("Сколько", {
    value: "0.00",
    required: true,
    inputMode: "decimal",
    className: "field-amount",
  });
  const currency = selectField(
    "Валюта",
    unique.map((item) => ({ value: item, label: item })),
  );
  const due = inputField("К какому сроку", { type: "date" });
  const priority = selectField(
    "Важность",
    [
      { value: "1", label: "Важное" },
      { value: "2", label: "Обычное" },
      { value: "3", label: "Когда-нибудь" },
    ],
    "2",
  );
  const description = inputField("Заметка", { className: "field-wide" });

  const submit = primaryButton("Добавить план", "check");
  submit.type = "submit";
  const error = formError();

  form.append(
    title.label,
    amount.label,
    currency.label,
    due.label,
    priority.label,
    description.label,
    error,
    el("div", "form-actions", submit),
  );

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit.disabled = true;
    void (async () => {
      try {
        const plan = preparePlan({
          title: title.input.value,
          amount: amount.input.value,
          currency: currency.select.value,
          due: due.input.value,
          priority: priority.select.value,
          description: description.input.value,
          ids: [
            ...plans.map((item) => item.id),
            ...(lastFiles ?? []).flatMap((file) => retiredIds(file.source)),
          ],
        });
        if (typeof plan === "string") {
          showFormError(error, plan);
          return;
        }
        await appendToPlans(dir, planLine(plan));
        await reload();
        toast("План добавлен");
      } catch (caught) {
        showFormError(error, message(caught));
      } finally {
        submit.disabled = false;
      }
    })();
  });
  void nextPlanId;
  return form;
}

function accountsScreen(dir: string, loaded: Ledger): HTMLElement {
  const page = el("div", "page");
  const statements = loaded.statements.map((item) => item.statement);
  const accountBalances = balances(statements);
  const currencies = new Set(accountBalances.map((account) => account.currency));

  const composer = composerPanel({
    title: "Новый счёт",
    hint: "Наличные или банковская карта",
    open: accountBalances.length === 0,
    content: accountForm(dir),
  });
  const editorHost = el("div", "account-editor");
  editorHost.hidden = true;

  const sub =
    accountBalances.length === 0
      ? "Пока ни одного счёта"
      : `${formatCount(accountBalances.length, ACCOUNT_FORMS)} · ${formatCount(currencies.size, [
          "валюта",
          "валюты",
          "валют",
        ])}`;

  page.append(
    pageHead({
      eyebrow: "Справочник",
      title: "Счета",
      sub,
      actions: [primaryButton("Счёт", "plus", () => openComposer(composer))],
    }),
    composer,
    editorHost,
  );

  if (accountBalances.length === 0) {
    page.append(
      emptyState({
        iconName: "wallet",
        title: "Счетов ещё нет",
        text: "Заведите первый счёт — наличные или карту. Остаток программа посчитает сама.",
        action: primaryButton("Новый счёт", "plus", () => openComposer(composer)),
      }),
    );
    return page;
  }

  const details = new Map<string, { accountType: "cash" | "bank"; opening: string }>();
  for (const item of loaded.statements) {
    if (item.statement.kind === "account" && !details.has(item.statement.name)) {
      details.set(item.statement.name, {
        accountType: item.statement.accountType,
        opening: item.statement.opening,
      });
    }
  }

  const grid = el("div", "account-grid");
  for (const account of accountBalances) {
    const info = details.get(account.name);
    const type = info?.accountType ?? "cash";
    const used = accountUsage(statements, account.name);
    const edit = iconButton("pencil", "Изменить счёт");
    edit.addEventListener("click", () => {
      editorHost.hidden = false;
      editorHost.replaceChildren(
        accountEditor({
          dir,
          account: {
            name: account.name,
            amount: account.amount,
            currency: account.currency,
            opening: info?.opening ?? "0.00",
            accountType: type,
          },
          used: used.total,
          onClose: () => {
            editorHost.hidden = true;
            editorHost.replaceChildren();
          },
        }),
      );
      editorHost.scrollIntoView({ block: "nearest" });
    });

    const card = el(
      "article",
      "account-card",
      el(
        "div",
        "account-card-top",
        el("span", "account-icon", icon(type === "bank" ? "bank" : "wallet", 17)),
        el("span", "account-type", type === "bank" ? "Банк" : "Наличные"),
        edit,
      ),
      el("h3", "account-name", account.name),
      el(
        "div",
        "account-balance",
        formatAmount(account.amount),
        el("span", "cur", account.currency),
      ),
      el(
        "div",
        "account-foot",
        el("span", undefined, "Начальный остаток"),
        el(
          "span",
          "account-opening",
          `${formatAmount(info?.opening ?? "0.00")} ${account.currency}`,
        ),
      ),
    );
    if (Number(account.amount) < 0) {
      card.classList.add("is-negative");
    }
    grid.append(card);
  }
  page.append(grid);
  return page;
}

function accountEditor(options: {
  dir: string;
  account: {
    name: string;
    amount: string;
    currency: string;
    opening: string;
    accountType: "cash" | "bank";
  };
  used: number;
  onClose: () => void;
}): HTMLElement {
  const { dir, account, used, onClose } = options;
  const close = iconButton("x", "Закрыть");
  close.addEventListener("click", onClose);

  const panel = el(
    "section",
    "account-editor-panel",
    el(
      "div",
      "editor-head",
      el(
        "div",
        "editor-title",
        el("h2", undefined, `Счёт «${account.name}»`),
        el("p", "editor-sub", "Остаток, имя, тип и валюта"),
      ),
      close,
    ),
  );

  const form = el("form", "form form-grid form-account");
  const name = inputField("Имя", { value: account.name, required: true });
  const type = selectField("Тип", [
    { value: "cash", label: "Наличные" },
    { value: "bank", label: "Банк" },
  ]);
  type.select.value = account.accountType;
  const currency = inputField("Валюта", {
    value: account.currency,
    required: true,
    className: "field-short",
  });
  currency.input.maxLength = 4;
  if (used > 0) {
    currency.input.disabled = true;
  }
  const balance = inputField("Остаток на счёте", {
    value: account.amount,
    required: true,
    inputMode: "decimal",
    className: "field-amount",
  });

  const submit = primaryButton("Сохранить", "check");
  submit.type = "submit";
  const cancel = el("button", "btn ghost", el("span", undefined, "Отмена"));
  cancel.type = "button";
  cancel.addEventListener("click", onClose);
  const error = formError();

  const notes = el("div", "form-notes span-all");
  notes.append(
    el(
      "p",
      "form-hint",
      `Сейчас на счёте ${formatAmount(account.amount)} ${account.currency}, начальный остаток ${formatAmount(account.opening)} ${account.currency}. Если ввести другую сумму, начальный остаток изменится на ту же разницу.`,
    ),
  );
  notes.append(
    el(
      "p",
      used > 0 ? "form-hint warn" : "form-hint",
      used > 0
        ? "Валюту менять нельзя: на счёт уже ссылаются операции или повторы."
        : "Валюту можно менять, пока на счёт не ссылается ни одна операция.",
    ),
  );
  notes.append(
    el(
      "p",
      "form-hint",
      "Новое имя обновится в операциях, переводах и повторах.",
    ),
  );

  form.append(
    name.label,
    type.label,
    currency.label,
    balance.label,
    notes,
    error,
    el("div", "form-actions", cancel, submit),
  );

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit.disabled = true;
    void submitAccountEdit(
      dir,
      {
        name: account.name,
        currency: account.currency,
        opening: account.opening,
      },
      {
        name: name.input.value,
        accountType: type.select.value,
        currency: currency.input.value,
        balance: balance.input.value,
      },
      error,
    ).finally(() => {
      submit.disabled = false;
    });
  });

  panel.append(form);
  return panel;
}

async function submitAccountEdit(
  dir: string,
  original: { name: string; currency: string; opening: string },
  input: { name: string; accountType: string; currency: string; balance: string },
  error: HTMLParagraphElement,
): Promise<void> {
  try {
    const files = await readDataFolder(dir);
    const loaded = interpretFiles(files);
    const statements = loaded.statements.map((item) => item.statement);
    const accountsFile = files.find((file) => file.file === "accounts.md");
    if (!accountsFile) {
      showFormError(error, "Нет файла accounts.md");
      return;
    }
    const parsedAccounts = parseFinance(accountsFile.source);
    const statement = parsedAccounts.statements.find(
      (item) => item.kind === "account" && item.name === original.name,
    );
    if (!statement || statement.kind !== "account") {
      showFormError(error, "Счёт не найден. Возможно, файл изменился снаружи.");
      return;
    }

    const current =
      balances(statements).find((item) => item.name === original.name)?.amount ??
      statement.opening;
    const desired = parseBalanceCents(input.balance);
    if (desired === null) {
      showFormError(error, "Остаток запишите числом, не больше двух знаков после точки");
      return;
    }
    const openingCents = toCents(statement.opening) + desired - toCents(current);
    if (openingCents < 0) {
      showFormError(
        error,
        "С таким остатком начальный остаток станет отрицательным. Измените сумму операций, а не счёт.",
      );
      return;
    }

    const next = normalizeAccount({
      name: input.name,
      accountType: input.accountType,
      currency: input.currency,
      opening: fromCents(openingCents),
    });
    if (typeof next === "string") {
      showFormError(error, next);
      return;
    }

    const names = parsedAccounts.statements.flatMap((item) =>
      item.kind === "account" ? [item.name] : [],
    );
    if (next.name !== original.name && names.includes(next.name)) {
      showFormError(error, `Счёт «${next.name}» уже есть`);
      return;
    }
    const usage = accountUsage(statements, original.name);
    if (next.currency !== original.currency && usage.total > 0) {
      showFormError(
        error,
        "У счёта уже есть операции или повторы — валюту менять нельзя. Заведите отдельный счёт.",
      );
      return;
    }

    const nextSources = new Map<string, string>();
    const nextAccounts = replaceAccountLine(accountsFile.source, statement.line, next);
    if (nextAccounts === null) {
      showFormError(error, "Строка счёта не найдена");
      return;
    }
    nextSources.set("accounts.md", nextAccounts);
    if (next.name !== original.name) {
      for (const file of files) {
        if (file.file === "accounts.md") {
          continue;
        }
        const rewritten = rewriteAccountReferences(file.source, original.name, next.name);
        if (rewritten.changed) {
          nextSources.set(file.file, rewritten.source);
        }
      }
    }

    const nextFiles = files.map((file) => ({
      file: file.file,
      source: nextSources.get(file.file) ?? file.source,
    }));
    const existing = new Set(
      interpretFiles(files).errors.map((item) => `${item.file}:${item.line}:${item.message}`),
    );
    const added = interpretFiles(nextFiles).errors.find(
      (item) => !existing.has(`${item.file}:${item.line}:${item.message}`),
    );
    if (added) {
      showFormError(error, `${added.file}:${added.line} — ${added.message}`);
      return;
    }

    const written: string[] = [];
    try {
      for (const [file, source] of nextSources) {
        await writeTextFile(await join(dir, ...file.split("/")), source);
        written.push(file);
      }
    } catch (caught) {
      for (const file of written) {
        const previous = files.find((item) => item.file === file);
        if (!previous) {
          continue;
        }
        try {
          await writeTextFile(await join(dir, ...file.split("/")), previous.source);
        } catch {
          // Если откат не удался, покажем исходную ошибку.
        }
      }
      throw caught;
    }

    error.hidden = true;
    await reload();
    toast("Счёт обновлён");
  } catch (caught) {
    showFormError(error, message(caught));
  }
}

function categoriesScreen(
  dir: string,
  loaded: Ledger,
  monthStatements: Statement[],
): HTMLElement {
  const page = el("div", "page");
  const categories = uniqueCategories(loaded.statements.map((item) => item.statement));
  const expenseCategories = categories
    .filter((category) => category.categoryKind === "expense")
    .sort((left, right) => left.name.localeCompare(right.name, "ru"));
  const incomeCategories = categories
    .filter((category) => category.categoryKind === "income")
    .sort((left, right) => left.name.localeCompare(right.name, "ru"));

  const composer = composerPanel({
    title: "Новая категория",
    hint: "Статья расхода или дохода",
    open: categories.length === 0,
    content: categoryForm(dir),
  });

  const sub =
    categories.length === 0
      ? "Пока ни одной категории"
      : `${formatCount(categories.length, CATEGORY_FORMS)} · расход ${expenseCategories.length} · доход ${incomeCategories.length}`;

  page.append(
    pageHead({
      eyebrow: "Справочник",
      title: "Категории",
      sub,
      actions: [primaryButton("Категория", "plus", () => openComposer(composer))],
    }),
    composer,
  );

  if (categories.length === 0) {
    page.append(
      emptyState({
        iconName: "tag",
        title: "Категорий ещё нет",
        text: "Категории нужны расходу и доходу. Начните с «Продукты» и «Зарплата».",
        action: primaryButton("Новая категория", "plus", () => openComposer(composer)),
      }),
    );
    return page;
  }

  const counts = new Map<string, number>();
  for (const statement of monthStatements) {
    if (statement.kind === "expense" || statement.kind === "income") {
      counts.set(statement.category, (counts.get(statement.category) ?? 0) + 1);
    }
  }

  page.append(
    el(
      "div",
      "cat-grid",
      categoryGroup("Расходы", "expense", expenseCategories, counts),
      categoryGroup("Доходы", "income", incomeCategories, counts),
    ),
    hintLine("Нажмите на категорию, чтобы увидеть её историю за всё время."),
  );
  return page;
}

function categoryGroup(
  title: string,
  kind: "expense" | "income",
  categories: CategoryStatement[],
  counts: Map<string, number>,
): HTMLElement {
  const group = el("section", "category-group");
  group.append(
    el(
      "div",
      "group-head",
      el("span", `group-icon ${kind}`, icon(kind === "income" ? "arrow-up" : "arrow-down", 14)),
      el("span", "group-title", title),
      el("span", "group-count", String(categories.length)),
    ),
  );
  if (categories.length === 0) {
    group.append(el("p", "muted-line", "Пока нет категорий."));
    return group;
  }
  const list = el("ul", "chips");
  for (const category of categories) {
    const count = counts.get(category.name);
    const button = el(
      "button",
      "chip-link",
      el("span", "chip-name", category.name),
      count ? el("span", "chip-count", String(count)) : null,
    );
    button.type = "button";
    button.title = `История категории «${category.name}»`;
    button.addEventListener("click", () => {
      openCategory(category.name);
    });
    list.append(el("li", "chip", button));
  }
  group.append(list);
  return group;
}

function recurringScreen(
  dir: string,
  loaded: Ledger,
  monthStatements: Statement[],
): HTMLElement {
  const page = el("div", "page");
  const recurrings = loaded.statements
    .flatMap((item) => (item.statement.kind === "recurring" ? [item.statement] : []))
    .sort((left, right) => left.day - right.day);
  const posted = recurrings.filter((recurring) => alreadyPosted(monthStatements, recurring)).length;

  const composer = composerPanel({
    title: "Новый повтор",
    hint: "Аренда, подписка или другой регулярный платёж",
    open: recurrings.length === 0,
    content: recurringForm(dir),
  });

  page.append(
    pageHead({
      eyebrow: "Регулярные платежи",
      title: "Повторы",
      sub:
        recurrings.length === 0
          ? "Пока ни одного повтора"
          : `${monthLabel(selectedMonth)} · проведено ${posted} из ${recurrings.length}`,
      actions: [monthNav(), primaryButton("Повтор", "plus", () => openComposer(composer))],
    }),
    composer,
  );

  if (recurrings.length === 0) {
    page.append(
      emptyState({
        iconName: "repeat",
        title: "Повторов ещё нет",
        text: "Добавьте аренду или подписку — программа напомнит в нужный день и проведёт одной кнопкой.",
        action: primaryButton("Новый повтор", "plus", () => openComposer(composer)),
      }),
    );
    return page;
  }

  const list = el("ul", "rec-list");
  for (const recurring of recurrings) {
    list.append(recurringItem(dir, recurring, monthStatements));
  }
  page.append(
    list,
    hintLine(
      "«Провести» пишет одну строку в файл выбранного месяца. Второй раз в том же месяце повтор ничего не добавит.",
    ),
  );
  return page;
}

function recurringItem(
  dir: string,
  recurring: RecurringStatement,
  monthStatements: Statement[],
): HTMLLIElement {
  const posted = alreadyPosted(monthStatements, recurring);
  const due = !posted && reminderDue(recurring.day, selectedMonth);
  const categoryKind = firstCategories(
    interpretFiles(lastFiles ?? []).statements.map((item) => item.statement),
  ).find((category) => category.name === recurring.category)?.categoryKind;

  const card = el("li", "rec-card");
  card.append(
    el(
      "span",
      "op-badge recurring",
      icon(categoryKind === "income" ? "arrow-up" : "repeat", 16),
    ),
    el(
      "div",
      "rec-body",
      el("span", "rec-title", recurring.name),
      el(
        "span",
        "op-meta",
        `${recurring.account} · ${recurring.category} · каждое ${recurring.day}-е число`,
      ),
    ),
    el(
      "div",
      "rec-side",
      el(
        "span",
        "rec-amount",
        formatAmount(recurring.amount),
        el("span", "cur", recurring.currency),
      ),
      posted
        ? el("span", "pill done", "Проведено")
        : due
          ? el("span", "pill due", "Пора провести")
          : el("span", "pill waiting", "Ожидает"),
    ),
  );

  const actions = el("div", "rec-actions");
  if (!posted) {
    const conduct = el(
      "button",
      due ? "btn primary small" : "btn small",
      icon("check", 14),
      el("span", undefined, "Провести"),
    );
    conduct.type = "button";
    conduct.addEventListener("click", () => {
      conduct.disabled = true;
      void conductRecurring(dir, recurring, conduct).finally(() => {
        conduct.disabled = false;
      });
    });
    actions.append(conduct);
  }
  const remove = iconButton("trash", "Удалить повтор", "danger");
  remove.addEventListener("click", () => {
    remove.disabled = true;
    void deleteRecurring(dir, recurring, remove);
  });
  actions.append(remove);
  card.append(actions);
  return card;
}

function journal(dir: string, movements: Operation[]): HTMLElement {
  const wrap = el("div", "journal");
  const groups = new Map<string, Operation[]>();
  const sorted = [...movements].sort((left, right) => right.date.localeCompare(left.date));
  for (const movement of sorted) {
    const items = groups.get(movement.date) ?? [];
    items.push(movement);
    groups.set(movement.date, items);
  }

  for (const [date, items] of groups) {
    const list = el("ul", "ops");
    for (const movement of items) {
      list.append(movementItem(dir, `transactions/${selectedMonth}.md`, movement));
    }
    wrap.append(
      el(
        "section",
        "day",
        el(
          "div",
          "day-head",
          el("span", "day-title", dayLabel(date)),
          el("span", "day-weekday", weekdayLabel(date)),
          el("span", "day-meta", formatCount(items.length, OPERATION_FORMS)),
        ),
        list,
      ),
    );
  }
  return wrap;
}

type Operation = ExpenseStatement | IncomeStatement | TransferStatement | ExchangeStatement;

function isOperation(statement: Statement): statement is Operation {
  return (
    statement.kind === "expense" ||
    statement.kind === "income" ||
    statement.kind === "transfer" ||
    statement.kind === "exchange"
  );
}

function movementItem(
  dir: string,
  file: string,
  statement: Operation,
  options: { date?: boolean; chip?: boolean } = {},
): HTMLLIElement {
  const item = el("li", "op");
  item.dataset.kind = statement.kind;

  const titleLine = el("div", "op-title-line", el("span", "op-title", operationTitle(statement)));
  const category = options.chip === false ? undefined : operationCategory(statement);
  if (category) {
    const chip = el("button", "op-chip is-link", category);
    chip.type = "button";
    chip.title = `История категории «${category}»`;
    chip.addEventListener("click", () => {
      openCategory(category);
    });
    titleLine.append(chip);
  }

  const amount = el(
    "span",
    "op-amount",
    el("span", "num", operationAmount(statement)),
    el("span", "cur", operationCurrency(statement)),
  );
  const sub = operationSub(statement);
  const amountBox = el(
    "div",
    "op-amount-box",
    amount,
    sub ? el("span", "op-sub", sub) : null,
  );

  const actions = el("div", "op-actions");
  if (statement.kind === "expense" || statement.kind === "income") {
    const edit = iconButton("pencil", "Изменить");
    edit.addEventListener("click", () => {
      const openForm = item.querySelector("form");
      if (openForm) {
        openForm.remove();
        item.classList.remove("is-editing");
        return;
      }
      const close = (): void => {
        form.remove();
        item.classList.remove("is-editing");
      };
      const form = editForm(dir, file, statement, close);
      item.append(form);
      item.classList.add("is-editing");
      form.querySelector("input")?.focus();
    });
    actions.append(edit);
  }
  const remove = iconButton("trash", "Удалить", "danger");
  remove.addEventListener("click", () => {
    void deleteMovement(dir, file, statement, remove);
  });
  actions.append(remove);

  item.append(
    el(
      "div",
      "op-row",
      el("span", "op-badge", icon(operationIcon(statement), 16)),
      el("div", "op-body", titleLine, el("div", "op-meta", operationMeta(statement, options.date))),
      amountBox,
      actions,
    ),
  );
  return item;
}

function operationTitle(statement: Operation): string {
  if (statement.kind === "transfer") {
    return "Перевод";
  }
  if (statement.kind === "exchange") {
    return "Обмен валюты";
  }
  return statement.title?.trim() || statement.category;
}

function operationCategory(statement: Operation): string | undefined {
  if (statement.kind !== "expense" && statement.kind !== "income") {
    return undefined;
  }
  const title = statement.title?.trim();
  return title && title !== statement.category ? statement.category : undefined;
}

function operationMeta(statement: Operation, withDate = false): string {
  const description = visibleDescription(statement.description);
  const parts: string[] = [];
  if (withDate) {
    parts.push(dayLabel(statement.date));
  }
  if (statement.kind === "transfer" || statement.kind === "exchange") {
    parts.push(`${statement.from} → ${statement.to}`);
  } else {
    parts.push(statement.account);
  }
  if (description) {
    parts.push(description);
  }
  return parts.join(" · ");
}

/** Пометка «повтор r1» служебная: в списке её не показываем. */
function visibleDescription(description: string | undefined): string | undefined {
  if (!description || /^повтор\s+\S+$/.test(description)) {
    return undefined;
  }
  return description;
}

function operationIcon(statement: Operation): IconName {
  if (statement.kind === "expense") {
    return "arrow-down";
  }
  if (statement.kind === "income") {
    return "arrow-up";
  }
  return statement.kind === "transfer" ? "swap" : "exchange";
}

function operationAmount(statement: Operation): string {
  if (statement.kind === "expense") {
    return signedAmount(statement.amount, "−");
  }
  if (statement.kind === "income") {
    return signedAmount(statement.amount, "+");
  }
  return formatAmount(statement.amount);
}

function operationCurrency(statement: Operation): string {
  return statement.currency;
}

function operationSub(statement: Operation): string | undefined {
  if (statement.kind === "transfer") {
    return "перевод";
  }
  if (statement.kind === "exchange") {
    return `→ ${formatAmount(statement.toAmount)} ${statement.toCurrency}`;
  }
  return undefined;
}

function summaryStrip(stats: CurrencyStats[]): HTMLElement {
  const strip = el("div", "summary-strip");
  for (const stat of stats) {
    const total = difference(stat.income, stat.expense);
    const tone = total.startsWith("+") ? "income" : total.startsWith("−") ? "expense" : "neutral";
    const card = el(
      "div",
      "summary-card",
      el("span", "currency-mark", stat.currency),
      el(
        "div",
        "summary-metrics",
        summaryMetric("Расход", signedAmount(stat.expense, "−"), stat.currency, "expense"),
        summaryMetric("Доход", signedAmount(stat.income, "+"), stat.currency, "income"),
        summaryMetric("Итог", total, stat.currency, tone),
      ),
    );
    strip.append(card);
  }
  return strip;
}

function summaryMetric(
  label: string,
  value: string,
  currency: string,
  tone: string,
): HTMLElement {
  const metric = el(
    "div",
    "metric",
    el("span", "metric-label", label),
    el("span", "metric-value", value, el("span", "metric-cur", currency)),
  );
  metric.dataset.tone = tone;
  return metric;
}

function pageHead(options: {
  eyebrow: string;
  title: string;
  sub?: string;
  actions?: (HTMLElement | null)[];
}): HTMLElement {
  const text = el(
    "div",
    "page-head-text",
    el("p", "eyebrow", options.eyebrow),
    el("h1", undefined, options.title),
  );
  if (options.sub) {
    text.append(el("p", "page-sub", options.sub));
  }
  const actions = el("div", "page-actions");
  for (const action of options.actions ?? []) {
    if (action) {
      actions.append(action);
    }
  }
  return el("header", "page-head", text, actions);
}

function monthNav(): HTMLElement {
  const earlier = iconButton("chevron-left", "Предыдущий месяц");
  earlier.addEventListener("click", () => {
    chooseMonth(shiftMonth(selectedMonth, -1));
  });
  const later = iconButton("chevron-right", "Следующий месяц");
  later.addEventListener("click", () => {
    chooseMonth(shiftMonth(selectedMonth, 1));
  });
  return el("div", "month-nav", earlier, later);
}

function composerPanel(options: {
  title: string;
  hint: string;
  open: boolean;
  content: HTMLElement;
}): HTMLDetailsElement {
  const details = el("details", "composer");
  details.open = options.open;
  details.append(
    el(
      "summary",
      "composer-summary",
      el("span", "composer-icon", icon("plus", 15)),
      el(
        "span",
        "composer-text",
        el("span", "composer-title", options.title),
        el("span", "composer-hint", options.hint),
      ),
      el("span", "composer-chevron", icon("chevron-down", 16)),
    ),
    el("div", "composer-body", options.content),
  );
  return details;
}

function openComposer(details: HTMLDetailsElement): void {
  details.open = true;
  details.scrollIntoView({ behavior: "smooth", block: "center" });
  const focusable = details.querySelector<HTMLInputElement>("input, select");
  window.setTimeout(() => {
    focusable?.focus({ preventScroll: true });
  }, 80);
}

function dueCallout(due: RecurringStatement[]): HTMLElement {
  const button = el("button", "btn subtle small");
  button.type = "button";
  button.textContent = "К повторам";
  button.addEventListener("click", () => {
    chooseScreen("recurring");
  });
  return el(
    "div",
    "callout due",
    el("span", "callout-icon", icon("calendar", 16)),
    el(
      "div",
      "callout-body",
      el("strong", "callout-title", "Пора провести"),
      el("span", "callout-text", due.map((recurring) => recurring.name).join(", ")),
    ),
    button,
  );
}

function plansCallout(plans: Plan[], totals: { currency: string; amount: string }[]): HTMLElement {
  const button = el("button", "btn subtle small", el("span", undefined, "К планам"));
  button.type = "button";
  button.addEventListener("click", () => {
    chooseScreen("plans");
  });
  const sum = totals
    .map((total) => `${formatAmount(total.amount)} ${total.currency}`)
    .join(" · ");
  return el(
    "div",
    "callout plans",
    el("span", "callout-icon", icon("plan", 16)),
    el(
      "div",
      "callout-body",
      el("strong", "callout-title", "Запланировано"),
      el(
        "span",
        "callout-text",
        `${formatCount(plans.length, ["покупка", "покупки", "покупок"])} на ${sum}`,
      ),
    ),
    button,
  );
}

function emptyState(options: {
  iconName: IconName;
  title: string;
  text: string;
  action?: HTMLElement;
}): HTMLElement {
  const box = el(
    "div",
    "empty",
    el("span", "empty-art", icon(options.iconName, 22)),
    el("h2", "empty-title", options.title),
    el("p", "empty-text", options.text),
  );
  if (options.action) {
    box.append(el("div", "empty-actions", options.action));
  }
  return box;
}

function hintLine(text: string): HTMLElement {
  return el("p", "hint-line", icon("info", 14), el("span", undefined, text));
}

function errorsCallout(loaded: Ledger): HTMLElement {
  const list = el("ul", "error-list");
  for (const item of loaded.errors) {
    list.append(
      el(
        "li",
        undefined,
        el("span", "error-loc", `${item.file}:${item.line}`),
        el("span", undefined, item.message),
      ),
    );
  }
  const body = el(
    "div",
    "callout-body",
    el(
      "strong",
      "callout-title",
      `Ошибки в файлах · ${formatCount(loaded.errors.length, ["строка", "строки", "строк"])}`,
    ),
    el(
      "span",
      "callout-text",
      "Эти строки не участвуют в расчётах. Исправьте их в markdown-файле — экран обновится сам.",
    ),
    list,
  );
  return el(
    "div",
    "callout danger",
    el("span", "callout-icon", icon("alert", 16)),
    body,
  );
}

function sourcePanel(loaded: Ledger): HTMLDetailsElement {
  const details = el("details", "source-panel");
  details.append(
    el(
      "summary",
      undefined,
      icon("file", 14),
      el("span", undefined, "Исходные строки"),
      el("span", "source-count", String(loaded.statements.length)),
    ),
  );
  if (loaded.statements.length === 0) {
    details.append(el("p", "source-empty", "В файлах пока нет строк."));
    return details;
  }
  const list = el("ul", "source-list");
  for (const item of loaded.statements) {
    list.append(
      el(
        "li",
        undefined,
        el("span", "line-loc", `${item.file}:${item.statement.line}`),
        el("span", "line-text", lineText(item.statement)),
      ),
    );
  }
  details.append(list);
  return details;
}

function accountForm(dir: string): HTMLFormElement {
  const form = el("form", "form form-grid form-account");

  const name = inputField("Имя", { placeholder: "Наличные", required: true });
  const type = selectField("Тип", [
    { value: "cash", label: "Наличные" },
    { value: "bank", label: "Банк" },
  ]);
  const currency = inputField("Валюта", { value: "BYN", required: true, className: "field-short" });
  currency.input.maxLength = 4;
  const opening = inputField("Начальный остаток", {
    value: "0.00",
    required: true,
    inputMode: "decimal",
    className: "field-amount",
  });

  const submit = primaryButton("Добавить счёт", "check");
  submit.type = "submit";
  const error = formError();

  form.append(
    name.label,
    type.label,
    currency.label,
    opening.label,
    error,
    el("div", "form-actions", submit),
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit.disabled = true;
    void submitAccount(
      dir,
      {
        name: name.input.value,
        accountType: type.select.value,
        currency: currency.input.value,
        opening: opening.input.value,
      },
      error,
    ).finally(() => {
      submit.disabled = false;
    });
  });
  return form;
}

async function submitAccount(
  dir: string,
  input: { name: string; accountType: string; currency: string; opening: string },
  error: HTMLParagraphElement,
): Promise<void> {
  const account = normalizeAccount(input);
  if (typeof account === "string") {
    showFormError(error, account);
    return;
  }
  try {
    const path = await join(dir, "accounts.md");
    const source = await readTextFile(path);
    const names = parseFinance(source).statements.flatMap((statement) =>
      statement.kind === "account" ? [statement.name] : [],
    );
    if (names.includes(account.name)) {
      showFormError(error, `Счёт «${account.name}» уже есть`);
      return;
    }
    await writeTextFile(path, appendStatement(source, accountLine(account)));
    error.hidden = true;
    await reload();
    toast("Счёт добавлен");
  } catch (caught) {
    showFormError(error, message(caught));
  }
}

function categoryForm(dir: string): HTMLFormElement {
  const form = el("form", "form form-grid form-category");

  const name = inputField("Имя", { placeholder: "Продукты", required: true });
  const kind = segmented(
    [
      { value: "expense", label: "Расход" },
      { value: "income", label: "Доход" },
    ],
    "expense",
  );
  const submit = primaryButton("Добавить категорию", "check");
  submit.type = "submit";
  const error = formError();

  form.append(
    name.label,
    el("div", "field", el("span", "field-label", "Вид"), kind.element),
    error,
    el("div", "form-actions", submit),
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit.disabled = true;
    void submitCategory(
      dir,
      { name: name.input.value, categoryKind: kind.get() },
      error,
    ).finally(() => {
      submit.disabled = false;
    });
  });
  return form;
}

async function submitCategory(
  dir: string,
  input: { name: string; categoryKind: string },
  error: HTMLParagraphElement,
): Promise<void> {
  const category = normalizeCategory(input);
  if (typeof category === "string") {
    showFormError(error, category);
    return;
  }
  try {
    const path = await join(dir, "categories.md");
    const source = await readTextFile(path);
    const names = parseFinance(source).statements.flatMap((statement) =>
      statement.kind === "category" ? [statement.name] : [],
    );
    if (names.includes(category.name)) {
      showFormError(error, `Категория «${category.name}» уже есть`);
      return;
    }
    await writeTextFile(path, appendStatement(source, categoryLine(category)));
    error.hidden = true;
    await reload();
    toast("Категория добавлена");
  } catch (caught) {
    showFormError(error, message(caught));
  }
}

function movementForm(dir: string): HTMLFormElement {
  const form = el("form", "form form-grid form-movement");
  const statements = interpretFiles(lastFiles ?? []).statements.map((item) => item.statement);
  const accounts = firstAccounts(statements);
  const categories = firstCategories(statements);

  const kind = segmented(
    [
      { value: "expense", label: "Расход" },
      { value: "income", label: "Доход" },
    ],
    "expense",
    () => {
      syncAvailability();
    },
  );

  const date = inputField("Дата", { type: "date", required: true, value: todayDate() });
  const dateNote = el("p", "form-hint");
  const syncDateNote = (): void => {
    const month = date.input.value.slice(0, 7);
    const valid = /^\d{4}-\d{2}$/.test(month);
    dateNote.hidden = !valid || month === selectedMonth;
    if (!dateNote.hidden) {
      dateNote.textContent = `Операция попадёт в «${monthLabel(month)}»`;
    }
  };
  date.input.addEventListener("input", syncDateNote);
  syncDateNote();

  const amount = inputField("Сумма", {
    value: "0.00",
    required: true,
    inputMode: "decimal",
    className: "field-amount",
  });
  const account = selectField(
    "Счёт",
    accounts.map((item) => ({ value: item.name, label: `${item.name} · ${item.currency}` })),
  );
  const category = selectField("Категория", []);
  const title = inputField("Заголовок", { placeholder: "телевизор" });
  const description = inputField("Описание", {
    placeholder: "устал тащить его домой",
    className: "field-wide",
  });

  const submit = primaryButton("Записать", "check");
  submit.type = "submit";
  const error = formError();
  const hint = el("p", "form-hint");

  const syncAvailability = (): void => {
    const available = categories.filter((item) => item.categoryKind === kind.get());
    category.select.replaceChildren(...available.map((item) => option(item.name, item.name)));
    category.select.disabled = available.length === 0;
    if (accounts.length === 0) {
      hint.textContent = "Сначала добавьте счёт в разделе «Счета».";
    } else if (available.length === 0) {
      hint.textContent =
        kind.get() === "expense"
          ? "Нет категорий расхода. Добавьте их в разделе «Категории»."
          : "Нет категорий дохода. Добавьте их в разделе «Категории».";
    }
    hint.hidden = accounts.length > 0 && available.length > 0;
    hint.classList.toggle("warn", !hint.hidden);
    submit.disabled = !hint.hidden;
  };
  syncAvailability();

  form.append(
    el("div", "span-all", kind.element),
    date.label,
    amount.label,
    account.label,
    category.label,
    title.label,
    description.label,
    dateNote,
    hint,
    error,
    el("div", "form-actions", submit),
  );

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (submit.disabled) {
      return;
    }
    submit.disabled = true;
    void submitMovement(
      dir,
      {
        kind: kind.get(),
        date: date.input.value,
        amount: amount.input.value,
        account: account.select.value,
        category: category.select.value,
        title: title.input.value,
        description: description.input.value,
      },
      error,
    ).finally(() => {
      syncAvailability();
    });
  });
  return form;
}

async function submitMovement(
  dir: string,
  input: {
    kind: string;
    date: string;
    amount: string;
    account: string;
    category: string;
    title: string;
    description: string;
  },
  error: HTMLParagraphElement,
): Promise<void> {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
      showFormError(error, "Укажите дату операции");
      return;
    }
    const month = input.date.slice(0, 7);
    const files = await readDataFolder(dir);
    const loaded = interpretFiles(files);
    const fresh = loaded.statements.map((item) => item.statement);
    const movement = prepareMovement({
      ...input,
      month,
      accounts: firstAccounts(fresh),
      categories: firstCategories(fresh),
      ids: [
        ...fresh.flatMap((statement) =>
          "id" in statement && statement.id ? [statement.id] : [],
        ),
        ...files.flatMap((file) => retiredIds(file.source)),
      ],
    });
    if (typeof movement === "string") {
      showFormError(error, movement);
      return;
    }
    const fileName = `transactions/${month}.md`;
    const path = await join(dir, "transactions", `${month}.md`);
    let source = files.find((file) => file.file === fileName)?.source;
    if (source === undefined) {
      try {
        source = await readTextFile(path);
      } catch {
        source = "```finance\n```\n";
      }
    }
    await writeTextFile(path, appendStatement(source, movementLine(movement)));
    error.hidden = true;
    const switched = month !== selectedMonth;
    selectedMonth = month;
    await reload();
    toast(switched ? `Операция записана в «${monthLabel(month)}»` : "Операция записана");
  } catch (caught) {
    showFormError(error, message(caught));
  }
}

function editForm(
  dir: string,
  file: string,
  statement: ExpenseStatement | IncomeStatement,
  onClose: () => void,
): HTMLFormElement {
  const form = el("form", "form form-grid form-edit");
  const statements = interpretFiles(lastFiles ?? []).statements.map((item) => item.statement);
  const accounts = firstAccounts(statements);
  const categories = firstCategories(statements).filter(
    (item) => item.categoryKind === statement.kind,
  );

  const amount = inputField("Сумма", {
    value: statement.amount,
    required: true,
    inputMode: "decimal",
    className: "field-amount",
  });
  const account = selectField(
    "Счёт",
    accounts.map((item) => ({ value: item.name, label: `${item.name} · ${item.currency}` })),
  );
  account.select.value = statement.account;
  const category = selectField(
    "Категория",
    categories.map((item) => ({ value: item.name, label: item.name })),
  );
  category.select.value = statement.category;
  const title = inputField("Заголовок", { value: statement.title ?? "" });
  const description = inputField("Описание", {
    value: statement.description ?? "",
    className: "field-wide",
  });

  const submit = primaryButton("Сохранить", "check");
  submit.type = "submit";
  const cancel = el("button", "btn ghost", el("span", undefined, "Отмена"));
  cancel.type = "button";
  cancel.addEventListener("click", onClose);
  const error = formError();

  form.append(
    amount.label,
    account.label,
    category.label,
    title.label,
    description.label,
    error,
    el("div", "form-actions", cancel, submit),
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submit.disabled = true;
    void saveMovement(
      dir,
      file,
      statement,
      {
        amount: amount.input.value,
        account: account.select.value,
        category: category.select.value,
        title: title.input.value,
        description: description.input.value,
      },
      error,
    ).finally(() => {
      submit.disabled = false;
    });
  });
  return form;
}

async function saveMovement(
  dir: string,
  file: string,
  statement: ExpenseStatement | IncomeStatement,
  input: { amount: string; account: string; category: string; title: string; description: string },
  error: HTMLParagraphElement,
): Promise<void> {
  const month = monthOf(file);
  if (!month) {
    showFormError(error, "Это не файл месяца");
    return;
  }
  try {
    const files = await readDataFolder(dir);
    const loaded = interpretFiles(files);
    const fresh = loaded.statements.map((item) => item.statement);
    const source = files.find((item) => item.file === file)?.source;
    if (source === undefined) {
      showFormError(error, "Строка не найдена");
      return;
    }
    const line = findStatementLine(source, month, {
      line: statement.line,
      id: statement.id,
      kind: statement.kind,
      date: statement.date,
    });
    if (line === null) {
      showFormError(error, "Строка не найдена");
      return;
    }
    const movement = prepareEdit({
      kind: statement.kind,
      id: statement.id,
      date: statement.date,
      month,
      accounts: firstAccounts(fresh),
      categories: firstCategories(fresh),
      ...input,
    });
    if (typeof movement === "string") {
      showFormError(error, movement);
      return;
    }
    const next = replaceStatement(source, line, movementLine(movement));
    if (next === null) {
      showFormError(error, "Строка не найдена");
      return;
    }
    await writeTextFile(await join(dir, ...file.split("/")), next);
    error.hidden = true;
    await reload();
    toast("Операция обновлена");
  } catch (caught) {
    showFormError(error, message(caught));
  }
}

async function deleteMovement(
  dir: string,
  file: string,
  statement: Operation,
  button: HTMLButtonElement,
): Promise<void> {
  const confirmed = await confirmAction({
    title: "Удалить операцию?",
    text: `«${operationTitle(statement)}» (${formatAmount(statement.amount)} ${statement.currency}) исчезнет из файла ${file}. Вернуть её можно только правкой файла.`,
    confirmLabel: "Удалить",
  });
  if (!confirmed) {
    return;
  }
  const month = monthOf(file);
  if (!month) {
    return;
  }
  button.disabled = true;
  try {
    const path = await join(dir, ...file.split("/"));
    const source = await readTextFile(path);
    const line = findStatementLine(source, month, {
      line: statement.line,
      id: statement.id,
      kind: statement.kind,
      date: statement.date,
    });
    if (line === null) {
      toast("Строка уже изменилась. Проверьте файл.", "error");
      return;
    }
    const next = retireStatement(source, line, statement.id);
    if (next === null) {
      toast("Строка уже изменилась. Проверьте файл.", "error");
      return;
    }
    await writeTextFile(path, next);
    await reload();
    toast("Операция удалена");
  } catch (caught) {
    toast(message(caught), "error");
  } finally {
    button.disabled = false;
  }
}

function recurringForm(dir: string): HTMLFormElement {
  const form = el("form", "form form-grid form-recurring");
  const statements = interpretFiles(lastFiles ?? []).statements.map((item) => item.statement);
  const accounts = firstAccounts(statements);
  const categories = firstCategories(statements);

  const name = inputField("Имя", { placeholder: "Аренда", required: true });
  const account = selectField(
    "Счёт",
    accounts.map((item) => ({ value: item.name, label: `${item.name} · ${item.currency}` })),
  );
  const category = selectField(
    "Категория",
    categories.map((item) => ({
      value: item.name,
      label: `${item.name} · ${item.categoryKind === "income" ? "доход" : "расход"}`,
    })),
  );
  const amount = inputField("Сумма", {
    value: "0.00",
    required: true,
    inputMode: "decimal",
    className: "field-amount",
  });
  const day = inputField("День месяца", { value: "1", required: true, inputMode: "numeric" });

  const submit = primaryButton("Добавить повтор", "check");
  submit.type = "submit";
  const error = formError();
  const hint = el(
    "p",
    "form-hint",
    "Для повтора нужны хотя бы один счёт и одна категория.",
  );
  const available = accounts.length > 0 && categories.length > 0;
  hint.hidden = available;
  hint.classList.toggle("warn", !available);
  if (!available) {
    submit.disabled = true;
  }

  form.append(
    name.label,
    account.label,
    category.label,
    amount.label,
    day.label,
    hint,
    error,
    el("div", "form-actions", submit),
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (submit.disabled) {
      return;
    }
    submit.disabled = true;
    void submitRecurring(
      dir,
      {
        name: name.input.value,
        account: account.select.value,
        category: category.select.value,
        amount: amount.input.value,
        day: day.input.value,
      },
      error,
    ).finally(() => {
      submit.disabled = !available;
    });
  });
  return form;
}

async function submitRecurring(
  dir: string,
  input: { name: string; account: string; category: string; amount: string; day: string },
  error: HTMLParagraphElement,
): Promise<void> {
  try {
    const files = await readDataFolder(dir);
    const loaded = interpretFiles(files);
    const fresh = loaded.statements.map((item) => item.statement);
    const recurring = prepareRecurring({
      ...input,
      accounts: firstAccounts(fresh),
      categories: firstCategories(fresh),
      ids: usedIds(fresh, files),
    });
    if (typeof recurring === "string") {
      showFormError(error, recurring);
      return;
    }
    const path = await join(dir, "recurring.md");
    const source = files.find((file) => file.file === "recurring.md")?.source ?? "```finance\n```\n";
    await writeTextFile(path, appendStatement(source, recurringLine(recurring)));
    error.hidden = true;
    await reload();
    toast("Повтор добавлен");
  } catch (caught) {
    showFormError(error, message(caught));
  }
}

async function conductRecurring(
  dir: string,
  recurring: RecurringStatement,
  button: HTMLButtonElement,
): Promise<void> {
  const month = selectedMonth;
  button.disabled = true;
  try {
    const files = await readDataFolder(dir);
    const loaded = interpretFiles(files);
    const fresh = loaded.statements.map((item) => item.statement);
    const monthStatements = loaded.statements.flatMap((item) =>
      item.file === `transactions/${month}.md` ? [item.statement] : [],
    );
    const current =
      fresh.find((item) => item.kind === "recurring" && item.id === recurring.id) ?? recurring;
    if (current.kind !== "recurring") {
      return;
    }
    const movement = postRecurring({
      recurring: current,
      month,
      monthStatements,
      accounts: firstAccounts(fresh),
      categories: firstCategories(fresh),
      ids: usedIds(fresh, files),
    });
    if (typeof movement === "string") {
      toast(movement, "error");
      return;
    }
    const fileName = `transactions/${month}.md`;
    const path = await join(dir, "transactions", `${month}.md`);
    let source = files.find((file) => file.file === fileName)?.source;
    if (source === undefined) {
      try {
        source = await readTextFile(path);
      } catch {
        source = "```finance\n```\n";
      }
    }
    await writeTextFile(path, appendStatement(source, movementLine(movement)));
    await reload();
    toast("Повтор проведён");
  } catch (caught) {
    toast(message(caught), "error");
  } finally {
    button.disabled = false;
  }
}

async function deleteRecurring(
  dir: string,
  recurring: RecurringStatement,
  button: HTMLButtonElement,
): Promise<void> {
  const confirmed = await confirmAction({
    title: "Удалить повтор?",
    text: `«${recurring.name}» больше не будет напоминать о себе. Уже проведённые операции останутся в файлах.`,
    confirmLabel: "Удалить",
  });
  if (!confirmed) {
    button.disabled = false;
    return;
  }
  try {
    const path = await join(dir, "recurring.md");
    const source = await readTextFile(path);
    const line = findRecurringLine(source, {
      id: recurring.id,
      line: recurring.line,
      name: recurring.name,
    });
    if (line === null) {
      toast("Строка уже изменилась. Проверьте файл.", "error");
      return;
    }
    const next = retireStatement(source, line, recurring.id);
    if (next === null) {
      toast("Строка уже изменилась. Проверьте файл.", "error");
      return;
    }
    await writeTextFile(path, next);
    await reload();
    toast("Повтор удалён");
  } catch (caught) {
    toast(message(caught), "error");
  } finally {
    button.disabled = false;
  }
}

function usedIds(statements: Statement[], files: LoadedFile[]): string[] {
  return [
    ...statements.flatMap((statement) =>
      "id" in statement && statement.id ? [statement.id] : [],
    ),
    ...files.flatMap((file) => retiredIds(file.source)),
  ];
}

function transferForm(dir: string): HTMLFormElement {
  const form = el("form", "form form-grid form-transfer");
  const accounts = firstAccounts(
    interpretFiles(lastFiles ?? []).statements.map((item) => item.statement),
  );

  const date = inputField("Дата", { type: "date", required: true, value: todayDate() });
  const dateNote = el("p", "form-hint");
  const syncDateNote = (): void => {
    const month = date.input.value.slice(0, 7);
    const valid = /^\d{4}-\d{2}$/.test(month);
    dateNote.hidden = !valid || month === selectedMonth;
    if (!dateNote.hidden) {
      dateNote.textContent = `Перевод попадёт в «${monthLabel(month)}»`;
    }
  };
  date.input.addEventListener("input", syncDateNote);
  syncDateNote();

  const from = selectField(
    "Откуда",
    accounts.map((item) => ({ value: item.name, label: `${item.name} · ${item.currency}` })),
  );
  const to = selectField(
    "Куда",
    accounts.map((item) => ({ value: item.name, label: `${item.name} · ${item.currency}` })),
  );
  if (accounts.length > 1) {
    to.select.value = accounts[1].name;
  }
  const amount = inputField("Сумма", {
    value: "0.00",
    required: true,
    inputMode: "decimal",
    className: "field-amount",
  });
  const received = inputField("Зачисление", {
    required: false,
    inputMode: "decimal",
    className: "field-amount",
  });
  const description = inputField("Описание", { placeholder: "в банке", className: "field-wide" });

  const submit = primaryButton("Перевести", "swap");
  submit.type = "submit";
  const error = formError();
  const hint = el("p", "form-hint", "Для перевода нужно хотя бы два счёта.");
  hint.hidden = accounts.length >= 2;
  hint.classList.toggle("warn", accounts.length < 2);
  if (accounts.length < 2) {
    submit.disabled = true;
  }

  const syncCurrencies = (): void => {
    const source = accounts.find((item) => item.name === from.select.value);
    const target = accounts.find((item) => item.name === to.select.value);
    amount.caption.textContent = source ? `Сумма, ${source.currency}` : "Сумма";
    const different = Boolean(
      source && target && source.currency !== target.currency,
    );
    received.label.hidden = !different;
    received.input.required = different;
    if (target) {
      received.caption.textContent = `Зачисление, ${target.currency}`;
    }
  };
  from.select.addEventListener("change", syncCurrencies);
  to.select.addEventListener("change", syncCurrencies);
  syncCurrencies();

  form.append(
    date.label,
    from.label,
    to.label,
    amount.label,
    received.label,
    description.label,
    dateNote,
    hint,
    error,
    el("div", "form-actions", submit),
  );
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (submit.disabled) {
      return;
    }
    submit.disabled = true;
    void submitTransfer(
      dir,
      {
        date: date.input.value,
        amount: amount.input.value,
        toAmount: received.label.hidden ? "" : received.input.value,
        from: from.select.value,
        to: to.select.value,
        description: description.input.value,
      },
      error,
    ).finally(() => {
      submit.disabled = accounts.length < 2;
    });
  });
  return form;
}

async function submitTransfer(
  dir: string,
  input: {
    date: string;
    amount: string;
    toAmount: string;
    from: string;
    to: string;
    description: string;
  },
  error: HTMLParagraphElement,
): Promise<void> {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
      showFormError(error, "Укажите дату перевода");
      return;
    }
    const month = input.date.slice(0, 7);
    const files = await readDataFolder(dir);
    const loaded = interpretFiles(files);
    const fresh = loaded.statements.map((item) => item.statement);
    const transfer = prepareTransfer({
      ...input,
      month,
      accounts: firstAccounts(fresh),
      ids: [
        ...fresh.flatMap((statement) =>
          "id" in statement && statement.id ? [statement.id] : [],
        ),
        ...files.flatMap((file) => retiredIds(file.source)),
      ],
    });
    if (typeof transfer === "string") {
      showFormError(error, transfer);
      return;
    }
    const fileName = `transactions/${month}.md`;
    const path = await join(dir, "transactions", `${month}.md`);
    let source = files.find((file) => file.file === fileName)?.source;
    if (source === undefined) {
      try {
        source = await readTextFile(path);
      } catch {
        source = "```finance\n```\n";
      }
    }
    await writeTextFile(path, appendStatement(source, transferLine(transfer)));
    error.hidden = true;
    const switched = month !== selectedMonth;
    selectedMonth = month;
    await reload();
    toast(switched ? `Перевод записан в «${monthLabel(month)}»` : "Перевод записан");
  } catch (caught) {
    showFormError(error, message(caught));
  }
}

function chooseScreen(next: Screen): void {
  screen = next;
  if (currentDir && lastFiles) {
    render(currentDir, lastFiles, null);
  }
}

function chooseMonth(month: string): void {
  selectedMonth = month;
  if (currentDir && lastFiles) {
    render(currentDir, lastFiles, null);
  }
}

function lineText(statement: Statement): string {
  switch (statement.kind) {
    case "account":
      return `${statement.name} · ${statement.accountType === "bank" ? "банк" : "наличные"} · ${statement.currency} · начало ${statement.opening}`;
    case "category":
      return `${statement.name} · ${statement.categoryKind}`;
    case "expense":
    case "income":
      return `${statement.kind} · ${statement.amount} ${statement.currency} · ${statement.account} · ${statement.category}${statement.title ? ` · ${statement.title}` : ""}${statement.description ? ` · ${statement.description}` : ""}`;
    case "transfer":
      return `transfer · ${statement.amount} ${statement.currency} · ${statement.from} → ${statement.to}${statement.description ? ` · ${statement.description}` : ""}`;
    case "exchange":
      return `exchange · ${statement.amount} ${statement.currency} → ${statement.toAmount} ${statement.toCurrency} · ${statement.from} → ${statement.to}${statement.description ? ` · ${statement.description}` : ""}`;
    case "recurring":
      return `recurring · ${statement.name} · ${statement.amount} ${statement.currency} · ${statement.account} · ${statement.category} · день ${statement.day}`;
    case "debt":
      return `debt · ${statement.person} · ${statement.amount} ${statement.currency} · ${statement.direction === "to" ? "взял" : "дал"} · ${statement.account}`;
    case "debt-pay":
      return `debt-pay · ${statement.debt} · ${statement.amount} ${statement.currency} · ${statement.direction} · ${statement.account}`;
    case "debt-agreed":
      return `debt-agreed · ${statement.debt} · ${statement.amount}`;
    case "debt-forgive":
      return `debt-forgive · ${statement.debt}`;
    case "plan":
      return `plan · ${statement.title} · ${statement.amount} ${statement.currency}${statement.due ? ` · до ${statement.due}` : ""}`;
    case "plan-done":
      return `plan-done · ${statement.plan} · ${statement.date}`;
  }
}

function firstAccounts(statements: Statement[]): AccountStatement[] {
  const accounts: AccountStatement[] = [];
  const seen = new Set<string>();
  for (const statement of statements) {
    if (statement.kind === "account" && !seen.has(statement.name)) {
      accounts.push(statement);
      seen.add(statement.name);
    }
  }
  return accounts;
}

function firstCategories(statements: Statement[]): CategoryStatement[] {
  const categories: CategoryStatement[] = [];
  const seen = new Set<string>();
  for (const statement of statements) {
    if (statement.kind === "category" && !seen.has(statement.name)) {
      categories.push(statement);
      seen.add(statement.name);
    }
  }
  return categories;
}

function uniqueCategories(statements: Statement[]): CategoryStatement[] {
  return firstCategories(statements);
}

function showFormError(error: HTMLParagraphElement, text: string): void {
  error.hidden = false;
  error.textContent = text;
}

function formError(): HTMLParagraphElement {
  const error = el("p", "form-error");
  error.hidden = true;
  return error;
}

// ————————————————————————————— helpers —————————————————————————————

type Field = {
  label: HTMLLabelElement;
  caption: HTMLSpanElement;
  input: HTMLInputElement;
};

function inputField(
  text: string,
  options: {
    value?: string;
    placeholder?: string;
    type?: string;
    required?: boolean;
    inputMode?: "decimal" | "numeric" | "text";
    className?: string;
  } = {},
): Field {
  const input = document.createElement("input");
  input.className = "input";
  input.type = options.type ?? "text";
  input.autocomplete = "off";
  if (options.value !== undefined) {
    input.value = options.value;
  }
  if (options.placeholder) {
    input.placeholder = options.placeholder;
  }
  if (options.required) {
    input.required = true;
  }
  if (options.inputMode) {
    input.inputMode = options.inputMode;
  }
  const field = labelFor(text, input, options.className);
  return { ...field, input };
}

function selectField(
  text: string,
  options: { value: string; label: string }[],
  className?: string,
): { label: HTMLLabelElement; caption: HTMLSpanElement; select: HTMLSelectElement } {
  const select = el("select", "input select");
  for (const item of options) {
    select.append(option(item.value, item.label));
  }
  const field = labelFor(text, select, className);
  return { ...field, select };
}

function labelFor(
  text: string,
  control: HTMLElement,
  className?: string,
): { label: HTMLLabelElement; caption: HTMLSpanElement } {
  const caption = el("span", "field-label", text);
  const label = el("label", className ? `field ${className}` : "field", caption, control);
  return { label, caption };
}

function segmented(
  options: { value: string; label: string }[],
  initial: string,
  onChange?: (value: string) => void,
): { element: HTMLElement; get: () => string } {
  let value = initial;
  const group = el("div", "segmented");
  group.setAttribute("role", "group");
  const buttons = options.map((item) => {
    const button = el("button", "segmented-item", el("span", undefined, item.label));
    button.type = "button";
    button.dataset.value = item.value;
    button.addEventListener("click", () => {
      if (value === item.value) {
        return;
      }
      value = item.value;
      sync();
      onChange?.(value);
    });
    return button;
  });
  const sync = (): void => {
    for (const button of buttons) {
      const active = button.dataset.value === value;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  };
  group.append(...buttons);
  sync();
  return { element: group, get: () => value };
}

function option(value: string, text: string): HTMLOptionElement {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = text;
  return element;
}

function primaryButton(
  label: string,
  iconName: IconName | null,
  onClick?: () => void,
): HTMLButtonElement {
  const button = el("button", "btn primary");
  button.type = "button";
  if (iconName) {
    button.append(icon(iconName, 15));
  }
  button.append(el("span", undefined, label));
  if (onClick) {
    button.addEventListener("click", onClick);
  }
  return button;
}

function iconButton(name: IconName, label: string, variant?: "danger"): HTMLButtonElement {
  const button = el("button", variant ? `icon-btn ${variant}` : "icon-btn");
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.append(icon(name, 16));
  return button;
}

function sideHeading(text: string): HTMLElement {
  return el("div", "side-head", el("h2", undefined, text));
}

function compactPath(dir: string): string {
  const parts = dir.split(/[\\/]+/).filter(Boolean);
  if (parts.length <= 2) {
    return dir;
  }
  return `…/${parts.slice(-2).join("/")}`;
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

function toCents(amount: string): number {
  const negative = amount.trim().startsWith("-");
  const [whole = "0", fraction = ""] = amount.trim().replace(/^[-+]/, "").split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
  return negative ? -cents : cents;
}

function fromCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

function parseBalanceCents(raw: string): number | null {
  const trimmed = raw.trim().replace(/[\s\u00A0]/g, "").replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(trimmed)) {
    return null;
  }
  return toCents(trimmed);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
