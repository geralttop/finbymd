import { prepareMovement, type NewMovement } from "./entry-file";
import { parseFinance, validateLedger, type AccountStatement, type CategoryStatement, type RecurringStatement, type Statement } from "./parse";

export type NewRecurring = {
  id?: string;
  name: string;
  account: string;
  category: string;
  amount: string;
  currency: string;
  day: number;
};

export function nextRecurringId(ids: Iterable<string>): string {
  let max = 0;
  for (const id of ids) {
    const match = /^r(\d+)$/.exec(id);
    if (!match) {
      continue;
    }
    max = Math.max(max, Number(match[1]));
  }
  return `r${max + 1}`;
}

export function recurringLine(recurring: NewRecurring): string {
  const id = recurring.id ? `${recurring.id} ` : "";
  return `recurring ${id}"${recurring.name}" from "${recurring.account}" category "${recurring.category}" ${recurring.amount} ${recurring.currency} day ${recurring.day}`;
}

export function postedMarker(id: string): string {
  return `повтор ${id}`;
}

export function prepareRecurring(input: {
  name: string;
  account: string;
  category: string;
  amount: string;
  day: string;
  accounts: AccountStatement[];
  categories: CategoryStatement[];
  ids: Iterable<string>;
}): NewRecurring | string {
  const name = input.name.trim();
  if (name.length === 0) {
    return "Введите имя повтора";
  }
  if (name.includes('"')) {
    return "В имени повтора нельзя использовать кавычки";
  }
  const account = input.accounts.find((item) => item.name === input.account);
  if (!account) {
    return "Выберите счёт";
  }
  const category = input.categories.find((item) => item.name === input.category);
  if (!category) {
    return "Выберите категорию";
  }
  const amount = normalizeAmount(input.amount);
  if (amount === null) {
    return "Сумму запишите числом, не больше двух знаков после точки";
  }
  const day = normalizeDay(input.day);
  if (day === null) {
    return "День месяца должен быть от 1 до 31";
  }

  const recurring: NewRecurring = {
    id: nextRecurringId(input.ids),
    name,
    account: account.name,
    category: category.name,
    amount,
    currency: account.currency,
    day,
  };
  const parsed = parseFinance(`\`\`\`finance\n${recurringLine(recurring)}\n\`\`\`\n`);
  if (parsed.errors.length > 0) {
    return parsed.errors[0].message;
  }
  const errors = validateLedger([...input.accounts, ...input.categories, parsed.statements[0]]);
  if (errors.length > 0) {
    return errors[0].message;
  }
  return recurring;
}

export function alreadyPosted(statements: Statement[], recurring: RecurringStatement): boolean {
  return statements.some((statement) => {
    if (statement.kind !== "expense" && statement.kind !== "income") {
      return false;
    }
    if (recurring.id && statement.description === postedMarker(recurring.id)) {
      return true;
    }
    return !recurring.id
      && statement.title === recurring.name
      && statement.account === recurring.account
      && statement.category === recurring.category
      && statement.amount === recurring.amount
      && statement.currency === recurring.currency;
  });
}

export function postRecurring(input: {
  recurring: RecurringStatement;
  month: string;
  monthStatements: Statement[];
  accounts: AccountStatement[];
  categories: CategoryStatement[];
  ids: Iterable<string>;
}): NewMovement | string {
  if (alreadyPosted(input.monthStatements, input.recurring)) {
    return "Уже проведено в этом месяце";
  }
  const category = input.categories.find((item) => item.name === input.recurring.category);
  if (!category) {
    return "Выберите категорию";
  }
  return prepareMovement({
    kind: category.categoryKind,
    date: postDate(input.month, input.recurring.day),
    amount: input.recurring.amount,
    account: input.recurring.account,
    category: input.recurring.category,
    title: input.recurring.name,
    description: input.recurring.id ? postedMarker(input.recurring.id) : "",
    month: input.month,
    accounts: input.accounts,
    categories: input.categories,
    ids: input.ids,
  });
}

export function postDate(month: string, day: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const clamped = Math.min(Math.max(day, 1), last);
  return `${month}-${String(clamped).padStart(2, "0")}`;
}

export function reminderDue(day: number, month: string, now = new Date()): boolean {
  const current = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  if (current !== month) {
    return false;
  }
  const due = Number(postDate(month, day).slice(-2));
  return now.getDate() >= due;
}

export function findRecurringLine(
  source: string,
  target: { id?: string; line: number; name: string },
): number | null {
  const found = parseFinance(source).statements.find((statement) => {
    if (statement.kind !== "recurring") {
      return false;
    }
    if (target.id) {
      return statement.id === target.id;
    }
    return statement.line === target.line && statement.name === target.name && !statement.id;
  });
  return found?.line ?? null;
}

function normalizeAmount(raw: string): string | null {
  const trimmed = raw.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return null;
  }
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > 2) {
    return null;
  }
  return `${whole}.${fraction.padEnd(2, "0")}`;
}

function normalizeDay(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d{1,2}$/.test(trimmed)) {
    return null;
  }
  const day = Number(trimmed);
  if (day < 1 || day > 31) {
    return null;
  }
  return day;
}
