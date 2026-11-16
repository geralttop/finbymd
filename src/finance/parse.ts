export type AccountType = "cash" | "bank";
export type CategoryKind = "expense" | "income";

export type AccountStatement = {
  kind: "account";
  line: number;
  name: string;
  accountType: AccountType;
  currency: string;
  opening: string;
};

export type CategoryStatement = {
  kind: "category";
  line: number;
  name: string;
  categoryKind: CategoryKind;
};

export type EntryBase = {
  line: number;
  id?: string;
  description?: string;
};

export type ExpenseStatement = EntryBase & {
  kind: "expense";
  date: string;
  amount: string;
  currency: string;
  account: string;
  category: string;
  title?: string;
};

export type IncomeStatement = EntryBase & {
  kind: "income";
  date: string;
  amount: string;
  currency: string;
  account: string;
  category: string;
  title?: string;
};

export type TransferStatement = EntryBase & {
  kind: "transfer";
  date: string;
  amount: string;
  currency: string;
  from: string;
  to: string;
};

export type ExchangeStatement = EntryBase & {
  kind: "exchange";
  date: string;
  amount: string;
  currency: string;
  from: string;
  to: string;
  toAmount: string;
  toCurrency: string;
};

export type RecurringStatement = EntryBase & {
  kind: "recurring";
  name: string;
  account: string;
  category: string;
  amount: string;
  currency: string;
  day: number;
};

/** Куда идут деньги: from — со счёта, to — на счёт. */
export type MoneyDirection = "from" | "to";

/**
 * Запись о долге. `direction: "to"` — деньги пришли на счёт, значит я должен;
 * `direction: "from"` — деньги ушли со счёта, значит должны мне.
 */
export type DebtStatement = EntryBase & {
  kind: "debt";
  date: string;
  person: string;
  amount: string;
  currency: string;
  direction: MoneyDirection;
  account: string;
};

export type DebtPaymentStatement = EntryBase & {
  kind: "debt-pay";
  date: string;
  debt: string;
  amount: string;
  currency: string;
  direction: MoneyDirection;
  account: string;
};

export type DebtAgreedStatement = EntryBase & {
  kind: "debt-agreed";
  date: string;
  debt: string;
  amount: string;
};

export type DebtForgiveStatement = EntryBase & {
  kind: "debt-forgive";
  date: string;
  debt: string;
};

export type PlanStatement = EntryBase & {
  kind: "plan";
  title: string;
  amount: string;
  currency: string;
  due?: string;
  priority?: number;
};

export type PlanDoneStatement = EntryBase & {
  kind: "plan-done";
  date: string;
  plan: string;
};

export type Statement =
  | AccountStatement
  | CategoryStatement
  | ExpenseStatement
  | IncomeStatement
  | TransferStatement
  | ExchangeStatement
  | RecurringStatement
  | DebtStatement
  | DebtPaymentStatement
  | DebtAgreedStatement
  | DebtForgiveStatement
  | PlanStatement
  | PlanDoneStatement;

export type ParseError = {
  line: number;
  message: string;
};

export type ParseResult = {
  statements: Statement[];
  errors: ParseError[];
};

export type ParseOptions = {
  /** Если задан, дата операции должна попадать в этот месяц, например `2026-10`. */
  month?: string;
};

type Token = {
  text: string;
  quoted: boolean;
};

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
const ID_SHAPE = /^[A-Za-z][A-Za-z0-9_-]*$/;
const AMOUNT_SHAPE = /^\d+\.\d{2}$/;
const CURRENCY_SHAPE = /^[A-Z]{3,4}$/;

export function parseFinance(source: string, options: ParseOptions = {}): ParseResult {
  const statements: Statement[] = [];
  const errors: ParseError[] = [];
  const lines = source.split(/\r?\n/);
  let blockStart: number | null = null;

  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const raw = lines[index];
    const trimmed = raw.trim();

    if (blockStart === null) {
      if (trimmed === "```finance") {
        blockStart = lineNumber;
      }
      continue;
    }

    if (trimmed === "```") {
      blockStart = null;
      continue;
    }

    if (trimmed === "```finance") {
      errors.push({ line: lineNumber, message: "Блок finance уже открыт" });
      continue;
    }

    if (trimmed === "" || trimmed.startsWith("//")) {
      continue;
    }

    const parsed = parseLine(raw, lineNumber, options);
    if ("error" in parsed) {
      errors.push({ line: lineNumber, message: parsed.error });
    } else {
      statements.push(parsed.statement);
    }
  }

  if (blockStart !== null) {
    errors.push({ line: blockStart, message: "Блок finance не закрыт" });
  }

  return { statements, errors };
}

export function validateLedger(statements: Statement[]): ParseError[] {
  const errors: ParseError[] = [];
  const accounts = new Map<string, AccountStatement>();
  const categories = new Map<string, CategoryStatement>();
  const debts = new Map<string, DebtStatement>();
  const plans = new Map<string, PlanStatement>();

  for (const statement of statements) {
    if (statement.kind === "account") {
      if (accounts.has(statement.name)) {
        errors.push({ line: statement.line, message: `Счёт «${statement.name}» уже есть` });
      } else {
        accounts.set(statement.name, statement);
      }
    }
    if (statement.kind === "category") {
      if (categories.has(statement.name)) {
        errors.push({
          line: statement.line,
          message: `Категория «${statement.name}» уже есть`,
        });
      } else {
        categories.set(statement.name, statement);
      }
    }
    if (statement.kind === "debt" && statement.id) {
      if (debts.has(statement.id)) {
        errors.push({ line: statement.line, message: `Долг ${statement.id} уже есть` });
      } else {
        debts.set(statement.id, statement);
      }
    }
    if (statement.kind === "plan" && statement.id) {
      if (plans.has(statement.id)) {
        errors.push({ line: statement.line, message: `План ${statement.id} уже есть` });
      } else {
        plans.set(statement.id, statement);
      }
    }
  }

  for (const statement of statements) {
    if (statement.kind === "expense" || statement.kind === "income") {
      const account = requireAccount(accounts, statement.account, statement.line, errors);
      requireCategory(categories, statement.category, statement.kind, statement.line, errors);
      if (account && account.currency !== statement.currency) {
        errors.push({
          line: statement.line,
          message: currencyMismatch(statement.currency, account),
        });
      }
    }

    if (statement.kind === "transfer" || statement.kind === "exchange") {
      if (statement.from === statement.to) {
        errors.push({
          line: statement.line,
          message: `Перевод на тот же счёт «${statement.from}»`,
        });
        continue;
      }
      const from = requireAccount(accounts, statement.from, statement.line, errors);
      const to = requireAccount(accounts, statement.to, statement.line, errors);
      if (from && from.currency !== statement.currency) {
        errors.push({
          line: statement.line,
          message: currencyMismatch(statement.currency, from),
        });
      }
      if (statement.kind === "transfer" && to && from && to.currency !== from.currency) {
        errors.push({
          line: statement.line,
          message: `Счета «${from.name}» и «${to.name}» в разных валютах, нужен exchange`,
        });
      }
      if (statement.kind === "exchange" && to && to.currency !== statement.toCurrency) {
        errors.push({
          line: statement.line,
          message: currencyMismatch(statement.toCurrency, to),
        });
      }
    }

    if (statement.kind === "recurring") {
      const account = requireAccount(accounts, statement.account, statement.line, errors);
      const category = categories.get(statement.category);
      if (!category) {
        errors.push({
          line: statement.line,
          message: `Категория «${statement.category}» не найдена`,
        });
      }
      if (account && account.currency !== statement.currency) {
        errors.push({
          line: statement.line,
          message: currencyMismatch(statement.currency, account),
        });
      }
    }

    if (statement.kind === "debt") {
      const account = requireAccount(accounts, statement.account, statement.line, errors);
      if (account && account.currency !== statement.currency) {
        errors.push({
          line: statement.line,
          message: currencyMismatch(statement.currency, account),
        });
      }
    }

    if (statement.kind === "debt-pay") {
      const debt = debts.get(statement.debt);
      if (!debt) {
        errors.push({
          line: statement.line,
          message: `Долг «${statement.debt}» не найден`,
        });
      }
      const account = requireAccount(accounts, statement.account, statement.line, errors);
      if (account && account.currency !== statement.currency) {
        errors.push({
          line: statement.line,
          message: currencyMismatch(statement.currency, account),
        });
      }
      if (debt) {
        if (debt.currency !== statement.currency) {
          errors.push({
            line: statement.line,
            message: `Возврат должен быть в ${debt.currency}, а не в ${statement.currency}`,
          });
        }
        const expected = debt.direction === "to" ? "from" : "to";
        if (statement.direction !== expected) {
          errors.push({
            line: statement.line,
            message:
              debt.direction === "to"
                ? "По этому долгу деньги возвращают со счёта: from"
                : "По этому долгу деньги получают на счёт: to",
          });
        }
      }
    }

    if (statement.kind === "debt-agreed" || statement.kind === "debt-forgive") {
      if (!debts.has(statement.debt)) {
        errors.push({
          line: statement.line,
          message: `Долг «${statement.debt}» не найден`,
        });
      }
    }

    if (statement.kind === "plan-done") {
      if (!plans.has(statement.plan)) {
        errors.push({
          line: statement.line,
          message: `План «${statement.plan}» не найден`,
        });
      }
    }
  }

  return errors;
}

function requireAccount(
  accounts: Map<string, AccountStatement>,
  name: string,
  line: number,
  errors: ParseError[],
): AccountStatement | undefined {
  const account = accounts.get(name);
  if (!account) {
    errors.push({ line, message: `Счёт «${name}» не найден` });
  }
  return account;
}

function requireCategory(
  categories: Map<string, CategoryStatement>,
  name: string,
  expected: CategoryKind,
  line: number,
  errors: ParseError[],
): void {
  const category = categories.get(name);
  if (!category) {
    errors.push({ line, message: `Категория «${name}» не найдена` });
    return;
  }
  if (category.categoryKind !== expected) {
    const purpose = category.categoryKind === "expense" ? "расхода" : "дохода";
    errors.push({
      line,
      message: `Категория «${name}» предназначена для ${purpose}`,
    });
  }
}

function currencyMismatch(currency: string, account: AccountStatement): string {
  return `Валюта ${currency} не совпадает с валютой счёта «${account.name}» (${account.currency})`;
}

function parseLine(
  raw: string,
  line: number,
  options: ParseOptions,
): { statement: Statement } | { error: string } {
  const split = splitDescription(raw);
  if (split.error) {
    return { error: split.error };
  }

  const tokens = tokenize(split.code);
  if (typeof tokens === "string") {
    return { error: tokens };
  }
  if (tokens.length === 0) {
    return { error: "Пустая строка" };
  }

  const keyword = tokens[0];
  if (keyword.quoted) {
    return { error: "Строка должна начинаться с ключевого слова" };
  }

  const parser = new TokenParser(tokens.slice(1), line);
  let statement: Statement;
  switch (keyword.text) {
    case "account":
      statement = parser.account();
      break;
    case "category":
      statement = parser.category();
      break;
    case "expense":
      statement = parser.movement("expense", options);
      break;
    case "income":
      statement = parser.movement("income", options);
      break;
    case "transfer":
      statement = parser.transfer(options);
      break;
    case "exchange":
      statement = parser.exchange(options);
      break;
    case "recurring":
      statement = parser.recurring();
      break;
    case "debt":
      statement = parser.debt(options);
      break;
    case "debt-pay":
      statement = parser.debtPay(options);
      break;
    case "debt-agreed":
      statement = parser.debtAgreed(options);
      break;
    case "debt-forgive":
      statement = parser.debtForgive(options);
      break;
    case "plan":
      statement = parser.plan();
      break;
    case "plan-done":
      statement = parser.planDone(options);
      break;
    default:
      return { error: `Неизвестное слово «${keyword.text}»` };
  }

  if (parser.error) {
    return { error: parser.error };
  }
  if (!parser.done) {
    return { error: "В строке есть лишние слова" };
  }
  if (split.description) {
    if (statement.kind === "account" || statement.kind === "category") {
      return { error: "У этой строки не бывает описания" };
    }
    statement.description = split.description;
  }
  return { statement };
}

function splitDescription(raw: string): { code: string; description?: string; error?: string } {
  let inQuote = false;
  for (let index = 0; index < raw.length; index++) {
    if (raw[index] === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && raw[index] === ":" && raw[index + 1] === ":") {
      const description = raw.slice(index + 2).trim();
      return {
        code: raw.slice(0, index).trim(),
        description: description || undefined,
      };
    }
  }
  if (inQuote) {
    return { code: raw, error: "Не закрыта кавычка" };
  }
  return { code: raw.trim() };
}

function tokenize(code: string): Token[] | string {
  const tokens: Token[] = [];
  let index = 0;
  while (index < code.length) {
    const char = code[index];
    if (char === " " || char === "\t") {
      index++;
      continue;
    }
    if (char === '"') {
      const end = code.indexOf('"', index + 1);
      if (end === -1) {
        return "Не закрыта кавычка";
      }
      tokens.push({ text: code.slice(index + 1, end), quoted: true });
      index = end + 1;
      continue;
    }
    let end = index;
    while (end < code.length && code[end] !== " " && code[end] !== "\t" && code[end] !== '"') {
      end++;
    }
    tokens.push({ text: code.slice(index, end), quoted: false });
    index = end;
  }
  return tokens;
}

class TokenParser {
  error: string | null = null;
  private index = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly line: number,
  ) {}

  get done(): boolean {
    return this.index >= this.tokens.length;
  }

  account(): AccountStatement {
    const name = this.quoted("Имя счёта");
    const accountType = this.word();
    const currency = this.currency();
    this.expect("opening");
    const opening = this.amount();
    if (accountType !== "cash" && accountType !== "bank") {
      this.fail("Тип счёта должен быть cash или bank");
    }
    return {
      kind: "account",
      line: this.line,
      name,
      accountType: accountType === "bank" ? "bank" : "cash",
      currency,
      opening,
    };
  }

  category(): CategoryStatement {
    const name = this.quoted("Имя категории");
    const categoryKind = this.word();
    if (categoryKind !== "expense" && categoryKind !== "income") {
      this.fail("Вид категории должен быть expense или income");
    }
    return {
      kind: "category",
      line: this.line,
      name,
      categoryKind: categoryKind === "income" ? "income" : "expense",
    };
  }

  movement(kind: "expense" | "income", options: ParseOptions): ExpenseStatement | IncomeStatement {
    const id = this.optionalId();
    const date = this.date(options);
    const amount = this.amount();
    const currency = this.currency();
    this.expect(kind === "expense" ? "from" : "to");
    const account = this.quoted("Имя счёта");
    this.expect("category");
    const category = this.quoted("Имя категории");
    const title = this.optionalQuoted();
    const statement: ExpenseStatement | IncomeStatement = {
      kind,
      line: this.line,
      date,
      amount,
      currency,
      account,
      category,
    };
    if (id) {
      statement.id = id;
    }
    if (title) {
      statement.title = title;
    }
    return statement;
  }

  transfer(options: ParseOptions): TransferStatement {
    const id = this.optionalId();
    const date = this.date(options);
    const amount = this.amount();
    const currency = this.currency();
    this.expect("from");
    const from = this.quoted("Имя счёта");
    this.expect("to");
    const to = this.quoted("Имя счёта");
    const statement: TransferStatement = {
      kind: "transfer",
      line: this.line,
      date,
      amount,
      currency,
      from,
      to,
    };
    if (id) {
      statement.id = id;
    }
    return statement;
  }

  exchange(options: ParseOptions): ExchangeStatement {
    const id = this.optionalId();
    const date = this.date(options);
    const amount = this.amount();
    const currency = this.currency();
    this.expect("from");
    const from = this.quoted("Имя счёта");
    this.expect("to");
    const to = this.quoted("Имя счёта");
    if (this.done) {
      this.fail("В обмене нет второй суммы");
      return {
        kind: "exchange",
        line: this.line,
        id,
        date,
        amount,
        currency,
        from,
        to,
        toAmount: "",
        toCurrency: "",
      };
    }
    const toAmount = this.amount();
    const toCurrency = this.currency();
    const statement: ExchangeStatement = {
      kind: "exchange",
      line: this.line,
      date,
      amount,
      currency,
      from,
      to,
      toAmount,
      toCurrency,
    };
    if (id) {
      statement.id = id;
    }
    return statement;
  }

  recurring(): RecurringStatement {
    const id = this.optionalId();
    const name = this.quoted("Имя повтора");
    this.expect("from");
    const account = this.quoted("Имя счёта");
    this.expect("category");
    const category = this.quoted("Имя категории");
    const amount = this.amount();
    const currency = this.currency();
    this.expect("day");
    const day = this.day();
    const statement: RecurringStatement = {
      kind: "recurring",
      line: this.line,
      name,
      account,
      category,
      amount,
      currency,
      day,
    };
    if (id) {
      statement.id = id;
    }
    return statement;
  }

  debt(options: ParseOptions): DebtStatement {
    const id = this.optionalId();
    if (!id) {
      this.fail("У долга должен быть идентификатор, например d1");
    }
    const date = this.date(options);
    const person = this.quoted("Имя человека");
    const amount = this.amount();
    const currency = this.currency();
    const direction = this.moneyDirection();
    const account = this.quoted("Имя счёта");
    const statement: DebtStatement = {
      kind: "debt",
      line: this.line,
      date,
      person,
      amount,
      currency,
      direction,
      account,
    };
    if (id) {
      statement.id = id;
    }
    return statement;
  }

  debtPay(options: ParseOptions): DebtPaymentStatement {
    const debt = this.reference();
    const date = this.date(options);
    const amount = this.amount();
    const currency = this.currency();
    const direction = this.moneyDirection();
    const account = this.quoted("Имя счёта");
    return {
      kind: "debt-pay",
      line: this.line,
      debt,
      date,
      amount,
      currency,
      direction,
      account,
    };
  }

  debtAgreed(options: ParseOptions): DebtAgreedStatement {
    const debt = this.reference();
    const date = this.date(options);
    const amount = this.amount();
    return { kind: "debt-agreed", line: this.line, debt, date, amount };
  }

  debtForgive(options: ParseOptions): DebtForgiveStatement {
    const debt = this.reference();
    const date = this.date(options);
    return { kind: "debt-forgive", line: this.line, debt, date };
  }

  plan(): PlanStatement {
    const id = this.optionalId();
    if (!id) {
      this.fail("У плана должен быть идентификатор, например p1");
    }
    const title = this.quoted("Название плана");
    const amount = this.amount();
    const currency = this.currency();
    const statement: PlanStatement = {
      kind: "plan",
      line: this.line,
      title,
      amount,
      currency,
    };
    if (id) {
      statement.id = id;
    }
    while (!this.done && !this.error) {
      const key = this.word();
      if (key === "due") {
        if (statement.due) {
          this.fail("Срок уже указан");
          break;
        }
        statement.due = this.date({});
      } else if (key === "priority") {
        const token = this.take();
        if (!token || token.quoted || !/^[1-3]$/.test(token.text)) {
          this.fail("Приоритет должен быть 1, 2 или 3");
          break;
        }
        statement.priority = Number(token.text);
      } else {
        this.fail(`Неизвестное поле «${key}»`);
        break;
      }
    }
    return statement;
  }

  planDone(options: ParseOptions): PlanDoneStatement {
    const plan = this.reference();
    const date = this.date(options);
    return { kind: "plan-done", line: this.line, plan, date };
  }

  private reference(): string {
    const token = this.take();
    if (!token || token.quoted || !ID_SHAPE.test(token.text)) {
      this.fail("Ожидался идентификатор");
      return "";
    }
    return token.text;
  }

  private moneyDirection(): MoneyDirection {
    const token = this.take();
    if (!token || token.quoted || (token.text !== "from" && token.text !== "to")) {
      this.fail("Ожидалось from или to");
      return "from";
    }
    return token.text;
  }

  private optionalId(): string | undefined {
    const token = this.tokens[this.index];
    if (!token || token.quoted || DATE_SHAPE.test(token.text)) {
      return undefined;
    }
    if (!ID_SHAPE.test(token.text)) {
      this.fail(`Непонятный идентификатор «${token.text}»`);
      this.index++;
      return undefined;
    }
    this.index++;
    return token.text;
  }

  private optionalQuoted(): string | undefined {
    const token = this.tokens[this.index];
    if (!token?.quoted) {
      return undefined;
    }
    this.index++;
    if (token.text.length === 0) {
      this.fail("Заголовок пустой");
      return undefined;
    }
    return token.text;
  }

  private quoted(label: string): string {
    const token = this.take();
    if (!token || !token.quoted) {
      this.fail(`${label} должно быть в кавычках`);
      return "";
    }
    if (token.text.length === 0) {
      this.fail(`${label} пустое`);
    }
    return token.text;
  }

  private word(): string {
    const token = this.take();
    if (!token || token.quoted) {
      this.fail("Ожидалось слово");
      return "";
    }
    return token.text;
  }

  private expect(word: string): void {
    const token = this.take();
    if (!token || token.quoted || token.text !== word) {
      this.fail(`Ожидалось ${word}`);
    }
  }

  private date(options: ParseOptions): string {
    const token = this.take();
    if (!token || token.quoted || !parseDate(token.text)) {
      this.fail(token ? `Дата «${token.text}» не существует` : "Ожидалась дата");
      return "";
    }
    if (options.month && !token.text.startsWith(`${options.month}-`)) {
      this.fail(`Дата ${token.text} не относится к месяцу ${options.month}`);
    }
    return token.text;
  }

  private amount(): string {
    const token = this.take();
    if (!token || token.quoted || !AMOUNT_SHAPE.test(token.text)) {
      this.fail(
        token
          ? `Сумма «${token.text}» должна быть с двумя знаками после точки`
          : "Ожидалась сумма",
      );
      return "";
    }
    return token.text;
  }

  private currency(): string {
    const token = this.take();
    if (!token || token.quoted || !CURRENCY_SHAPE.test(token.text)) {
      this.fail(
        token
          ? `Валюта «${token.text}» должна быть из 3 или 4 заглавных латинских букв`
          : "Ожидалась валюта",
      );
      return "";
    }
    return token.text;
  }

  private day(): number {
    const token = this.take();
    if (!token || token.quoted || !/^\d{1,2}$/.test(token.text)) {
      this.fail("Ожидался день месяца");
      return 0;
    }
    const day = Number(token.text);
    if (day < 1 || day > 31) {
      this.fail("День месяца должен быть от 1 до 31");
    }
    return day;
  }

  private take(): Token | undefined {
    if (this.error) {
      return undefined;
    }
    return this.tokens[this.index++];
  }

  private fail(message: string): void {
    if (!this.error) {
      this.error = message;
    }
  }
}

function parseDate(value: string): boolean {
  if (!DATE_SHAPE.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
