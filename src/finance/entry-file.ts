import {
  parseFinance,
  validateLedger,
  type AccountStatement,
  type CategoryStatement,
  type Statement,
} from "./parse";

export type MovementKind = "expense" | "income";

export type NewMovement = {
  kind: MovementKind;
  id?: string;
  date: string;
  amount: string;
  currency: string;
  account: string;
  category: string;
  title?: string;
  description?: string;
};

export function nextTransactionId(ids: Iterable<string>): string {
  let max = 0;
  for (const id of ids) {
    const match = /^t(\d+)$/.exec(id);
    if (!match) {
      continue;
    }
    max = Math.max(max, Number(match[1]));
  }
  return `t${max + 1}`;
}

export function movementLine(movement: NewMovement): string {
  const id = movement.id ? `${movement.id} ` : "";
  const direction = movement.kind === "expense" ? "from" : "to";
  const title = movement.title ? ` "${movement.title}"` : "";
  const description = movement.description ? ` :: ${movement.description}` : "";
  return `${movement.kind} ${id}${movement.date} ${movement.amount} ${movement.currency} ${direction} "${movement.account}" category "${movement.category}"${title}${description}`;
}

export function prepareMovement(input: {
  kind: string;
  date: string;
  amount: string;
  account: string;
  category: string;
  title: string;
  description: string;
  month: string;
  accounts: AccountStatement[];
  categories: CategoryStatement[];
  ids: Iterable<string>;
}): NewMovement | string {
  const fields = movementFields(input);
  if (typeof fields === "string") {
    return fields;
  }
  return commitMovement({
    ...fields,
    kind: input.kind === "income" ? "income" : "expense",
    id: nextTransactionId(input.ids),
    date: input.date.trim(),
  }, input.month, input.accounts, input.categories);
}

export function prepareEdit(input: {
  kind: MovementKind;
  id?: string;
  date: string;
  amount: string;
  account: string;
  category: string;
  title: string;
  description: string;
  month: string;
  accounts: AccountStatement[];
  categories: CategoryStatement[];
}): NewMovement | string {
  const fields = movementFields(input);
  if (typeof fields === "string") {
    return fields;
  }
  const movement: NewMovement = {
    ...fields,
    kind: input.kind,
    date: input.date,
  };
  if (input.id) {
    movement.id = input.id;
  }
  return commitMovement(movement, input.month, input.accounts, input.categories);
}

function movementFields(input: {
  kind: string;
  amount: string;
  account: string;
  category: string;
  title: string;
  description: string;
  accounts: AccountStatement[];
  categories: CategoryStatement[];
}): Pick<NewMovement, "amount" | "currency" | "account" | "category" | "title" | "description"> | string {
  if (input.kind !== "expense" && input.kind !== "income") {
    return "Вид операции должен быть расход или доход";
  }
  const title = input.title.trim();
  if (title.includes('"')) {
    return "В заголовке нельзя использовать кавычки";
  }
  const description = input.description.trim();
  if (/[\r\n]/.test(description)) {
    return "Описание должно быть в одну строку";
  }
  const amount = normalizeAmount(input.amount);
  if (amount === null) {
    return "Сумму запишите числом, не больше двух знаков после точки";
  }
  const account = input.accounts.find((item) => item.name === input.account);
  if (!account) {
    return "Выберите счёт";
  }
  const category = input.categories.find((item) => item.name === input.category);
  if (!category) {
    return "Выберите категорию";
  }
  const fields: Pick<NewMovement, "amount" | "currency" | "account" | "category" | "title" | "description"> = {
    amount,
    currency: account.currency,
    account: account.name,
    category: category.name,
  };
  if (title) {
    fields.title = title;
  }
  if (description) {
    fields.description = description;
  }
  return fields;
}

function commitMovement(
  movement: NewMovement,
  month: string,
  accounts: AccountStatement[],
  categories: CategoryStatement[],
): NewMovement | string {
  const parsed = parseFinance(`\`\`\`finance\n${movementLine(movement)}\n\`\`\`\n`, { month });
  if (parsed.errors.length > 0) {
    return parsed.errors[0].message;
  }
  const ledger: Statement[] = [...accounts, ...categories, parsed.statements[0]];
  const errors = validateLedger(ledger);
  if (errors.length > 0) {
    return errors[0].message;
  }
  return movement;
}

export function currentMonth(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

const MONTHS = [
  "Январь",
  "Февраль",
  "Март",
  "Апрель",
  "Май",
  "Июнь",
  "Июль",
  "Август",
  "Сентябрь",
  "Октябрь",
  "Ноябрь",
  "Декабрь",
];

export function monthLabel(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return `${MONTHS[monthNumber - 1] ?? month} ${year}`;
}

export function todayDate(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function defaultDate(month: string, now = new Date()): string {
  const today = todayDate(now);
  if (today.startsWith(`${month}-`)) {
    return today;
  }
  return `${month}-01`;
}

export function normalizeAmount(raw: string): string | null {
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
