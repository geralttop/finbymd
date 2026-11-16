import { ItemView, Notice, Platform, WorkspaceLeaf, setIcon } from "obsidian";
import { balances } from "../src/finance/balance";
import { currentMonth, monthLabel, shiftMonth, todayDate } from "../src/finance/entry-file";
import { categoryHistory, monthInsights } from "../src/finance/stats";
import type {
  ExchangeStatement,
  ExpenseStatement,
  IncomeStatement,
  Statement,
  TransferStatement,
} from "../src/finance/parse";
import { dayLabel, formatAmount, formatCount, weekdayLabel } from "../src/ui/format";
import { ChatModal } from "./chat/modal";
import { ChatPanel } from "./chat/panel";
import type FinbymdPlugin from "./main";
import { OperationModal } from "./modal";
import { loadBook, type Book } from "./storage";

export const VIEW_TYPE = "finbymd-view";

type Screen = "operations" | "stats" | "accounts" | "categories" | "category";
type Operation = ExpenseStatement | IncomeStatement | TransferStatement | ExchangeStatement;
type Row = { file: string; statement: Operation };

const SCREENS: { id: Screen; label: string; icon: string }[] = [
  { id: "operations", label: "Операции", icon: "list" },
  { id: "stats", label: "Статистика", icon: "bar-chart-2" },
  { id: "accounts", label: "Счета", icon: "credit-card" },
  { id: "categories", label: "Категории", icon: "tag" },
];

export class FinbymdView extends ItemView {
  private screen: Screen = "operations";
  private month = currentMonth();
  private selectedCategory: string | null = null;
  private book: Book | null = null;
  private loading = false;
  private timer: number | null = null;
  private chatOpen = false;
  private chat: ChatPanel | null = null;
  private chatModal: ChatModal | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private plugin: FinbymdPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return "finbymd";
  }

  getIcon(): string {
    return "wallet";
  }

  async onOpen(): Promise<void> {
    this.contentEl.addClass("finbymd-view");
    const schedule = (): void => {
      if (this.timer !== null) {
        window.clearTimeout(this.timer);
      }
      this.timer = window.setTimeout(() => void this.refresh(), 150);
    };
    this.registerEvent(this.app.vault.on("modify", schedule));
    this.registerEvent(this.app.vault.on("create", schedule));
    this.registerEvent(this.app.vault.on("delete", schedule));
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (this.loading) {
      return;
    }
    this.loading = true;
    try {
      this.book = await loadBook(this.app, this.plugin.settings.folder);
    } finally {
      this.loading = false;
    }
    if (this.chatModal?.isOpen()) {
      this.chatModal.refresh(this.chatContext());
    }
    this.render();
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    const book = this.book;
    if (!book) {
      root.createEl("p", { text: "Загрузка…", cls: "finbymd-muted" });
      return;
    }

    const shell = root.createDiv({ cls: "finbymd-shell" });
    shell.append(this.sidebar(book));
    const main = shell.createDiv({ cls: "finbymd-main" });
    this.topbar(main);
    this.mobileNav(main);

    const content = main.createDiv({ cls: "finbymd-content" });
    this.renderWarnings(content, book);

    if (book.files.length === 0) {
      this.emptyState(content, book);
    } else if (this.screen === "operations") {
      this.screenOperations(content, book);
    } else if (this.screen === "stats") {
      this.screenStats(content, book);
    } else if (this.screen === "accounts") {
      this.screenAccounts(content, book);
    } else if (this.screen === "category") {
      this.screenCategory(content, book);
    } else {
      this.screenCategories(content, book);
    }

    if (this.chatOpen) {
      const host = shell.createDiv({ cls: "finbymd-chat-host" });
      this.renderChat(host, book);
    }
  }

  private sidebar(book: Book): HTMLElement {
    const side = document.createElement("div");
    side.className = "finbymd-side";
    const brand = side.createDiv({ cls: "finbymd-brand" });
    const logo = brand.createSpan({ cls: "finbymd-logo", text: "f" });
    logo.setAttribute("aria-hidden", "true");
    const names = brand.createDiv({ cls: "finbymd-brand-text" });
    names.createEl("strong", { text: "finbymd" });
    names.createEl("span", { text: "учёт денег", cls: "finbymd-muted" });

    const nav = side.createDiv({ cls: "finbymd-nav-list" });
    for (const item of SCREENS) {
      const button = nav.createEl("button", {
        cls: `finbymd-nav-item${this.isActive(item.id) ? " is-active" : ""}`,
      });
      const icon = button.createSpan({ cls: "finbymd-nav-icon" });
      setIcon(icon, item.icon);
      button.createSpan({ text: item.label });
      button.addEventListener("click", () => {
        this.screen = item.id;
        this.render();
      });
    }

    const accountList = balances(book.statements.map((item) => item.statement));
    if (accountList.length > 0) {
      side.createEl("h3", { text: "Счета", cls: "finbymd-side-head" });
      for (const account of accountList) {
        const row = side.createDiv({ cls: "finbymd-side-row" });
        row.createSpan({ text: account.name });
        row.createSpan({
          text: `${formatAmount(account.amount)} ${account.currency}`,
          cls: "finbymd-muted finbymd-num",
        });
      }
    }

    const months = this.months(book);
    if (months.length > 0) {
      const head = side.createDiv({ cls: "finbymd-side-head-row" });
      head.createEl("h3", { text: "Месяцы", cls: "finbymd-side-head" });
      const prev = head.createEl("button", { cls: "finbymd-side-arrow", text: "‹" });
      prev.addEventListener("click", () => {
        this.month = shiftMonth(this.month, -1);
        this.render();
      });
      const next = head.createEl("button", { cls: "finbymd-side-arrow", text: "›" });
      next.addEventListener("click", () => {
        this.month = shiftMonth(this.month, 1);
        this.render();
      });
      for (const month of months) {
        const row = side.createEl("button", {
          cls: `finbymd-side-month${month === this.month ? " is-active" : ""}`,
        });
        row.createSpan({ text: monthLabel(month) });
        row.createSpan({
          text: String(this.monthCount(book, month)),
          cls: "finbymd-muted finbymd-num",
        });
        row.addEventListener("click", () => {
          this.month = month;
          this.screen = "operations";
          this.render();
        });
      }
    }

    const footer = side.createDiv({ cls: "finbymd-side-footer" });
    footer.setText(book.folder);
    return side;
  }

  private topbar(main: HTMLElement): void {
    const book = this.book;
    const bar = main.createDiv({ cls: "finbymd-top" });
    const status = bar.createDiv({ cls: "finbymd-status" });
    status.createSpan({ cls: "finbymd-dot" });
    status.createEl("span", { text: "локальные файлы" });
    status.createEl("span", { text: book?.folder ?? "", cls: "finbymd-muted finbymd-path" });

    const actions = bar.createDiv({ cls: "finbymd-top-actions" });
    const refresh = actions.createEl("button", { cls: "finbymd-icon-btn" });
    setIcon(refresh, "refresh-cw");
    refresh.setAttribute("aria-label", "Обновить");
    refresh.addEventListener("click", () => void this.refresh());

    const chat = actions.createEl("button", {
      cls: `finbymd-icon-btn${this.chatOpen ? " is-active" : ""}`,
    });
    setIcon(chat, "message-square");
    chat.setAttribute("aria-label", "Чат");
    chat.addEventListener("click", () => this.openChat());
  }

  private mobileNav(main: HTMLElement): void {
    const bar = main.createDiv({ cls: "finbymd-mobile-nav" });
    for (const item of SCREENS) {
      const button = bar.createEl("button", {
        text: item.label,
        cls: `finbymd-mobile-tab${this.isActive(item.id) ? " is-active" : ""}`,
      });
      button.addEventListener("click", () => {
        this.screen = item.id;
        this.render();
      });
    }
  }

  private screenOperations(content: HTMLElement, book: Book): void {
    const head = content.createDiv({ cls: "finbymd-screen-head" });
    const text = head.createDiv();
    text.createEl("span", { text: "Журнал", cls: "finbymd-kicker" });
    text.createEl("h1", { text: monthLabel(this.month) });
    const rows = this.rows(book);
    text.createEl("p", {
      text: `${formatCount(rows.length, ["операция", "операции", "операций"])} · ${formatCount(
        book.accounts.length,
        ["счёт", "счёта", "счетов"],
      )}`,
      cls: "finbymd-muted",
    });

    const tools = head.createDiv({ cls: "finbymd-head-actions" });
    const nav = tools.createDiv({ cls: "finbymd-month-nav" });
    const prev = nav.createEl("button", { cls: "finbymd-icon-btn", text: "‹" });
    prev.addEventListener("click", () => {
      this.month = shiftMonth(this.month, -1);
      this.render();
    });
    const next = nav.createEl("button", { cls: "finbymd-icon-btn", text: "›" });
    next.addEventListener("click", () => {
      this.month = shiftMonth(this.month, 1);
      this.render();
    });
    const add = tools.createEl("button", { text: "+ Операция", cls: "finbymd-primary" });
    add.addEventListener("click", () => this.openOperation(book));

    this.summary(content, book);
    this.journal(content, rows, book);
  }

  private summary(content: HTMLElement, book: Book): void {
    const totals = this.totals(book);
    if (totals.size === 0) {
      return;
    }
    const card = content.createDiv({ cls: "finbymd-card finbymd-summary" });
    for (const [currency, value] of totals) {
      const column = card.createDiv({ cls: "finbymd-summary-col" });
      column.createEl("span", { text: "Расход", cls: "finbymd-kicker" });
      column.createEl("strong", {
        text: `−${formatAmount((value.expense / 100).toFixed(2))} ${currency}`,
        cls: "finbymd-minus",
      });
      if (value.income > 0) {
        column.createEl("span", { text: "Доход", cls: "finbymd-kicker" });
        column.createEl("strong", {
          text: `+${formatAmount((value.income / 100).toFixed(2))} ${currency}`,
          cls: "finbymd-plus",
        });
      }
    }
  }

  private journal(content: HTMLElement, rows: Row[], book: Book): void {
    const visible = rows.filter(
      (row): row is { file: string; statement: ExpenseStatement | IncomeStatement } =>
        row.statement.kind === "expense" || row.statement.kind === "income",
    );
    if (visible.length === 0) {
      content.createEl("p", { text: "В этом месяце операций нет.", cls: "finbymd-muted" });
      return;
    }
    let currentDate = "";
    for (const row of visible) {
      const statement = row.statement;
      if (statement.date !== currentDate) {
        currentDate = statement.date;
        const head = content.createDiv({ cls: "finbymd-day" });
        head.createEl("span", { text: dayLabel(statement.date) });
        head.createEl("span", { text: weekdayLabel(statement.date), cls: "finbymd-muted" });
      }
      this.operationRow(content, book, row, statement);
    }
  }

  private operationRow(
    content: HTMLElement,
    book: Book,
    row: Row,
    statement: ExpenseStatement | IncomeStatement,
    options: { date?: boolean; category?: boolean } = {},
  ): void {
    const button = content.createEl("button", { cls: "finbymd-row" });
    const badge = button.createSpan({
      cls: `finbymd-row-badge ${statement.kind === "expense" ? "is-expense" : "is-income"}`,
    });
    setIcon(badge, statement.kind === "expense" ? "arrow-down-left" : "arrow-up-right");
    const left = button.createSpan({ cls: "finbymd-row-main" });
    left.createEl("span", { text: statement.title ?? statement.category, cls: "finbymd-row-title" });
    const meta: string[] = [];
    if (options.date) {
      meta.push(dayLabel(statement.date));
    }
    meta.push(statement.account);
    if (statement.title && options.category !== false) {
      meta.push(statement.category);
    }
    if (statement.description) {
      meta.push(statement.description);
    }
    left.createEl("span", { text: meta.join(" · "), cls: "finbymd-row-meta" });
    button.createEl("span", {
      text: `${statement.kind === "expense" ? "−" : "+"}${formatAmount(statement.amount)}`,
      cls: statement.kind === "expense" ? "finbymd-minus finbymd-num" : "finbymd-plus finbymd-num",
    });
    button.createEl("span", { text: statement.currency, cls: "finbymd-muted finbymd-row-cur" });
    button.addEventListener("click", () => {
      new OperationModal(this.app, {
        book,
        month: monthFromFile(row.file) ?? this.month,
        date: statement.date,
        file: row.file,
        statement,
        onSaved: () => void this.refresh(),
      }).open();
    });
  }

  private screenStats(content: HTMLElement, book: Book): void {
    const head = content.createDiv({ cls: "finbymd-screen-head" });
    const text = head.createDiv();
    text.createEl("span", { text: "Статистика", cls: "finbymd-kicker" });
    text.createEl("h1", { text: monthLabel(this.month) });
    text.createEl("p", { text: "Расходы, доходы и категории за месяц", cls: "finbymd-muted" });

    const totals = this.totals(book);
    if (totals.size === 0) {
      content.createEl("p", { text: "За этот месяц считать нечего.", cls: "finbymd-muted" });
      return;
    }
    const card = content.createDiv({ cls: "finbymd-card finbymd-summary" });
    for (const [currency, value] of totals) {
      const diff = (value.income - value.expense) / 100;
      const column = card.createDiv({ cls: "finbymd-summary-col" });
      column.createEl("span", { text: `Итог, ${currency}`, cls: "finbymd-kicker" });
      column.createEl("strong", {
        text: `${diff < 0 ? "−" : "+"}${formatAmount(Math.abs(diff).toFixed(2))} ${currency}`,
        cls: diff < 0 ? "finbymd-minus" : "finbymd-plus",
      });
      column.createEl("span", {
        text: `расход ${formatAmount((value.expense / 100).toFixed(2))} · доход ${formatAmount((value.income / 100).toFixed(2))}`,
        cls: "finbymd-muted",
      });
    }

    const rows = this.rows(book);
    const insights = monthInsights(rows.map((row) => row.statement));
    const byCurrency = new Map<string, Map<string, number>>();
    for (const row of rows) {
      const statement = row.statement;
      if (statement.kind !== "expense") {
        continue;
      }
      const categories = byCurrency.get(statement.currency) ?? new Map<string, number>();
      categories.set(
        statement.category,
        (categories.get(statement.category) ?? 0) + Math.round(Number(statement.amount) * 100),
      );
      byCurrency.set(statement.currency, categories);
    }

    for (const [currency, categories] of [...byCurrency.entries()].sort()) {
      const sorted = [...categories.entries()].sort((left, right) => right[1] - left[1]);
      content.createEl("h3", {
        text: `Расходы по категориям, ${currency}`,
        cls: "finbymd-section",
      });
      this.donutChart(content, sorted, currency);
      const insight = insights.find((item) => item.currency === currency);
      if (insight) {
        const biggest = insight.biggest
          ? ` · крупнейшая ${formatAmount(insight.biggest.amount)} (${insight.biggest.title})`
          : "";
        content.createEl("p", {
          text: `Средний чек ${formatAmount(insight.averageCheck)} ${currency} · дней с тратами ${insight.days}${biggest}`,
          cls: "finbymd-muted finbymd-insight",
        });
      }
      const max = sorted[0]?.[1] ?? 1;
      for (const [category, cents] of sorted) {
        const row = content.createDiv({ cls: "finbymd-stat-row" });
        const top = row.createDiv({ cls: "finbymd-stat-top" });
        top.createSpan({ text: category });
        top.createSpan({
          text: `${formatAmount((cents / 100).toFixed(2))} ${currency}`,
          cls: "finbymd-num",
        });
        const bar = row.createDiv({ cls: "finbymd-bar" });
        const fill = bar.createDiv({ cls: "finbymd-bar-fill" });
        fill.style.width = `${Math.max(4, Math.round((cents / max) * 100))}%`;
      }
    }
  }

  private donutChart(
    content: HTMLElement,
    entries: [string, number][],
    currency: string,
  ): void {
    const total = entries.reduce((sum, [, cents]) => sum + cents, 0);
    if (total <= 0) {
      return;
    }
    const wrap = content.createDiv({ cls: "finbymd-donut-wrap" });
    const box = wrap.createDiv({ cls: "finbymd-donut" });
    const size = 150;
    const radius = 56;
    const circumference = 2 * Math.PI * radius;
    const gap = entries.length > 1 ? 2.6 : 0;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
    svg.setAttribute("class", "finbymd-donut-svg");
    let offset = 0;
    entries.forEach(([name, cents], index) => {
      const share = cents / total;
      const length = Math.max(share * circumference - gap, entries.length > 1 ? 0.8 : circumference);
      const slice = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      slice.setAttribute("cx", String(size / 2));
      slice.setAttribute("cy", String(size / 2));
      slice.setAttribute("r", String(radius));
      slice.setAttribute("fill", "none");
      slice.setAttribute("stroke", `var(--fin-chart-${(index % 10) + 1})`);
      slice.setAttribute("stroke-width", "15");
      slice.setAttribute("stroke-dasharray", `${length} ${circumference - length}`);
      slice.setAttribute("stroke-dashoffset", String(-offset));
      slice.setAttribute("transform", `rotate(-90 ${size / 2} ${size / 2})`);
      slice.setAttribute("class", "finbymd-donut-slice");
      const hint = document.createElementNS("http://www.w3.org/2000/svg", "title");
      hint.textContent = `${name}: ${formatAmount((cents / 100).toFixed(2))} ${currency} · ${Math.round(share * 100)}%`;
      slice.append(hint);
      slice.addEventListener("click", () => {
        this.openCategory(name);
      });
      svg.append(slice);
      offset += share * circumference;
    });
    box.appendChild(svg);
    const center = box.createDiv({ cls: "finbymd-donut-center" });
    center.createEl("strong", { text: formatAmount((total / 100).toFixed(2)) });
    center.createEl("span", { text: currency, cls: "finbymd-muted" });

    const legend = wrap.createDiv({ cls: "finbymd-legend" });
    entries.forEach(([name, cents], index) => {
      const row = legend.createEl("button", { cls: "finbymd-legend-row" });
      const dot = row.createSpan({ cls: "finbymd-legend-dot" });
      dot.style.background = `var(--fin-chart-${(index % 10) + 1})`;
      row.createSpan({ text: name, cls: "finbymd-legend-name" });
      row.createSpan({
        text: `${Math.round((cents / total) * 100)}%`,
        cls: "finbymd-muted finbymd-num",
      });
      row.createSpan({
        text: formatAmount((cents / 100).toFixed(2)),
        cls: "finbymd-num",
      });
      row.addEventListener("click", () => {
        this.openCategory(name);
      });
    });
  }

  private openCategory(name: string): void {
    this.selectedCategory = name;
    this.screen = "category";
    this.render();
  }

  private screenCategory(content: HTMLElement, book: Book): void {
    const head = content.createDiv({ cls: "finbymd-screen-head" });
    const text = head.createDiv();
    const category = book.categories.find((item) => item.name === this.selectedCategory);
    const tools = head.createDiv({ cls: "finbymd-head-actions" });
    const back = tools.createEl("button", { text: "‹ Категории", cls: "finbymd-back" });
    back.setAttribute("aria-label", "Все категории");
    back.addEventListener("click", () => {
      this.screen = "categories";
      this.render();
    });

    if (!category) {
      text.createEl("h1", { text: "Категория" });
      content.createEl("p", {
        text: "Категория не найдена. Возможно, её переименовали в markdown-файле.",
        cls: "finbymd-muted",
      });
      return;
    }

    const entries = book.statements
      .flatMap((item) => {
        const month = monthFromFile(item.file);
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
      entries.map(({ month, statement }) => ({ month, statement })),
      category,
    );
    const kindLabel = category.categoryKind === "income" ? "Доход" : "Расход";

    text.createEl("span", { text: "Категория", cls: "finbymd-kicker" });
    text.createEl("h1", { text: category.name });
    text.createEl("p", {
      text:
        history.operations === 0
          ? "Пока без операций"
          : `${kindLabel} · ${formatCount(history.operations, ["операция", "операции", "операций"])} · ${formatCount(history.months, ["месяц", "месяца", "месяцев"])}`,
      cls: "finbymd-muted",
    });

    if (history.operations === 0) {
      content.createEl("p", {
        text: "У этой категории ещё нет операций. Они появятся здесь, как только вы их запишете.",
        cls: "finbymd-muted",
      });
      return;
    }

    const card = content.createDiv({ cls: "finbymd-card finbymd-summary" });
    for (const total of history.totals) {
      const perMonth = history.perMonth.find((item) => item.currency === total.currency)?.amount;
      const check = history.averageCheck.find((item) => item.currency === total.currency)?.amount;
      const column = card.createDiv({ cls: "finbymd-summary-col" });
      column.createEl("span", { text: `Всего, ${total.currency}`, cls: "finbymd-kicker" });
      column.createEl("strong", { text: formatAmount(total.amount) });
      if (perMonth && check) {
        column.createEl("span", {
          text: `в месяц ${formatAmount(perMonth)} · чек ${formatAmount(check)}`,
          cls: "finbymd-muted",
        });
      }
    }

    if (history.biggest) {
      const biggest = history.biggest;
      content.createEl("p", {
        text: `Крупнейшая операция — ${formatAmount(biggest.amount)} ${biggest.currency}${biggest.title ? `, «${biggest.title}»` : ""}, ${dayLabel(biggest.date)}.`,
        cls: "finbymd-muted finbymd-insight",
      });
    }

    if (history.monthly.length > 1) {
      content.createEl("h3", { text: "По месяцам", cls: "finbymd-section" });
      const primary = history.totals[0]?.currency;
      const points = [...history.monthly].reverse().map((row) => ({
        month: row.month,
        operations: row.operations,
        cents: Math.round(
          Number(row.totals.find((item) => item.currency === primary)?.amount ?? "0") * 100,
        ),
      }));
      const max = Math.max(...points.map((point) => point.cents), 1);
      for (const point of points) {
        const row = content.createDiv({ cls: "finbymd-stat-row" });
        const top = row.createDiv({ cls: "finbymd-stat-top" });
        top.createSpan({ text: shortMonth(point.month) });
        top.createSpan({
          text: `${formatAmount((point.cents / 100).toFixed(2))} · ${point.operations} оп.`,
          cls: "finbymd-num finbymd-muted",
        });
        const bar = row.createDiv({ cls: "finbymd-bar" });
        const fill = bar.createDiv({ cls: "finbymd-bar-fill" });
        fill.style.width = `${Math.max(4, Math.round((point.cents / max) * 100))}%`;
      }
    }

    content.createEl("h3", { text: "История", cls: "finbymd-section" });
    for (const monthRow of history.monthly) {
      const items = entries.filter((row) => row.month === monthRow.month);
      const day = content.createDiv({ cls: "finbymd-day" });
      day.createSpan({ text: monthLabel(monthRow.month) });
      day.createSpan({
        text: `${items.length} ${items.length === 1 ? "операция" : items.length < 5 ? "операции" : "операций"}`,
        cls: "finbymd-muted",
      });
      day.createSpan({
        text: monthRow.totals
          .map((item) => `${formatAmount(item.amount)} ${item.currency}`)
          .join(" · "),
        cls: "finbymd-muted finbymd-num finbymd-day-total",
      });
      for (const row of items) {
        this.operationRow(content, book, row, row.statement, { date: true, category: false });
      }
    }
  }

  private screenAccounts(content: HTMLElement, book: Book): void {
    const head = content.createDiv({ cls: "finbymd-screen-head" });
    head.createEl("h1", { text: "Счета" });
    head.createEl("p", {
      text: `${formatCount(book.accounts.length, ["счёт", "счёта", "счетов"])} и остатки по всем операциям`,
      cls: "finbymd-muted",
    });
    const list = balances(book.statements.map((item) => item.statement));
    for (const account of list) {
      const source = book.accounts.find((item) => item.name === account.name);
      const card = content.createDiv({ cls: "finbymd-card finbymd-account-card" });
      const left = card.createDiv();
      left.createEl("strong", { text: account.name });
      left.createEl("span", {
        text: `${source?.accountType === "bank" ? "карта" : "наличные"} · ${source?.currency ?? account.currency}`,
        cls: "finbymd-muted",
      });
      const right = card.createDiv({ cls: "finbymd-account-right" });
      right.createEl("strong", { text: `${formatAmount(account.amount)} ${account.currency}` });
      if (source) {
        right.createEl("span", { text: `начальный ${formatAmount(source.opening)}`, cls: "finbymd-muted" });
      }
    }
  }

  private screenCategories(content: HTMLElement, book: Book): void {
    const head = content.createDiv({ cls: "finbymd-screen-head" });
    head.createEl("h1", { text: "Категории" });
    head.createEl("p", {
      text: formatCount(book.categories.length, ["категория", "категории", "категорий"]),
      cls: "finbymd-muted",
    });
    const usage = new Map<string, number>();
    for (const item of book.statements) {
      const statement = item.statement;
      if (statement.kind === "expense" || statement.kind === "income") {
        usage.set(statement.category, (usage.get(statement.category) ?? 0) + 1);
      }
    }
    for (const category of book.categories) {
      const row = content.createEl("button", {
        cls: "finbymd-card finbymd-category-row finbymd-category-link",
      });
      row.createSpan({ text: category.name });
      row.createSpan({
        text: category.categoryKind === "expense" ? "расход" : "доход",
        cls: "finbymd-chip",
      });
      row.createSpan({
        text: String(usage.get(category.name) ?? 0),
        cls: "finbymd-muted finbymd-num",
      });
      const chevron = row.createSpan({ cls: "finbymd-chevron" });
      setIcon(chevron, "chevron-right");
      row.addEventListener("click", () => {
        this.openCategory(category.name);
      });
    }
  }

  private emptyState(content: HTMLElement, book: Book): void {
    const box = content.createDiv({ cls: "finbymd-empty" });
    box.createEl("h2", { text: "Папка пустая" });
    box.createEl("p", { text: `Плагин смотрит в ${book.folder}.` });
    box.createEl("p", {
      text: "Нужны accounts.md, categories.md и папка transactions. Или укажи другую папку в настройках плагина.",
      cls: "finbymd-muted",
    });
  }

  private renderWarnings(content: HTMLElement, book: Book): void {
    if (book.conflicts.length > 0) {
      const banner = content.createDiv({ cls: "finbymd-banner finbymd-banner-bad" });
      banner.createEl("strong", { text: "Конфликт git" });
      banner.createEl("span", { text: `Файлы не учтены: ${book.conflicts.join(", ")}` });
    }
    if (book.errors.length > 0) {
      const banner = content.createDiv({ cls: "finbymd-banner" });
      banner.createEl("strong", { text: `Ошибки в файлах: ${book.errors.length}` });
      for (const error of book.errors.slice(0, 3)) {
        banner.createEl("span", { text: `${error.file}:${error.line} — ${error.message}` });
      }
      if (book.errors.length > 3) {
        banner.createEl("span", { text: `и ещё ${book.errors.length - 3}`, cls: "finbymd-muted" });
      }
    }
  }

  private chatContext(): { book: Book; month: string; reload: () => Promise<void> } {
    return {
      book: this.book as Book,
      month: this.month,
      reload: () => this.refresh(),
    };
  }

  private openChat(): void {
    if (!this.book) {
      return;
    }
    if (Platform.isMobile) {
      if (!this.chat) {
        this.chat = new ChatPanel(this.app, this.plugin, this.chatContext(), () =>
          this.chatModal?.close(),
        );
      }
      this.chat.setContext(this.chatContext());
      if (!this.chatModal) {
        this.chatModal = new ChatModal(this.app, this.chat);
      }
      this.chatModal.open();
      return;
    }
    this.chatOpen = !this.chatOpen;
    this.render();
  }

  private renderChat(host: HTMLElement, book: Book): void {
    if (!this.chat) {
      this.chat = new ChatPanel(
        this.app,
        this.plugin,
        {
          book,
          month: this.month,
          reload: () => this.refresh(),
        },
        () => {
          this.chatOpen = false;
          this.render();
        },
      );
    }
    this.chat.setContext({ book, month: this.month, reload: () => this.refresh() });
    this.chat.render(host);
  }

  private isActive(id: Screen): boolean {
    return id === this.screen || (this.screen === "category" && id === "categories");
  }

  private rows(book: Book): Row[] {
    const rows: Row[] = [];
    for (const item of book.statements) {
      if (!isOperation(item.statement) || !item.statement.date.startsWith(this.month)) {
        continue;
      }
      rows.push({ file: item.file, statement: item.statement });
    }
    rows.sort(
      (a, b) => b.statement.date.localeCompare(a.statement.date) || a.statement.line - b.statement.line,
    );
    return rows;
  }

  private months(book: Book): string[] {
    const months = new Set<string>([this.month]);
    for (const file of book.files) {
      const match = /^transactions\/(\d{4}-\d{2})\.md$/.exec(file.file);
      if (match && match[1]) {
        months.add(match[1]);
      }
    }
    return [...months].sort().reverse();
  }

  private monthCount(book: Book, month: string): number {
    return book.statements.filter(
      (item) => isOperation(item.statement) && item.statement.date.startsWith(month),
    ).length;
  }

  private totals(book: Book): Map<string, { expense: number; income: number }> {
    const totals = new Map<string, { expense: number; income: number }>();
    for (const row of this.rows(book)) {
      const statement = row.statement;
      if (statement.kind !== "expense" && statement.kind !== "income") {
        continue;
      }
      const bucket = totals.get(statement.currency) ?? { expense: 0, income: 0 };
      const cents = Math.round(Number(statement.amount) * 100);
      if (statement.kind === "expense") {
        bucket.expense += cents;
      } else {
        bucket.income += cents;
      }
      totals.set(statement.currency, bucket);
    }
    return totals;
  }

  private openOperation(book: Book): void {
    if (book.accounts.length === 0 || book.categories.length === 0) {
      new Notice("Сначала нужны счета и категории в accounts.md и categories.md");
      return;
    }
    new OperationModal(this.app, {
      book,
      month: this.month,
      date: todayDate(),
      onSaved: (month) => {
        if (month) {
          this.month = month;
        }
        void this.refresh();
      },
    }).open();
  }
}

function isOperation(statement: Statement): statement is Operation {
  return (
    statement.kind === "expense" ||
    statement.kind === "income" ||
    statement.kind === "transfer" ||
    statement.kind === "exchange"
  );
}

function monthFromFile(file: string): string | undefined {
  return /^transactions\/(\d{4}-\d{2})\.md$/.exec(file)?.[1];
}

function shortMonth(month: string): string {
  const [name = month, year = ""] = monthLabel(month).split(" ");
  return `${name.slice(0, 3)} ${year.slice(2)}`;
}
