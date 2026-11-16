import { normalizeAmount } from "./entry-file";
import type {
  AccountStatement,
  DebtStatement,
  MoneyDirection,
  Statement,
} from "./parse";

export type DebtDirection = "owe" | "owed";

export type DebtEvent = {
  kind: "open" | "agreed" | "pay" | "forgive";
  date: string;
  line: number;
  amount: string;
  account?: string;
  direction?: MoneyDirection;
  /** Сколько прощено этим событием (для agreed и forgive). */
  forgiven?: string;
  description?: string;
};

export type Debt = {
  id: string;
  person: string;
  currency: string;
  /** owe — я должен, owed — мне должны. */
  direction: DebtDirection;
  opened: string;
  account: string;
  principal: string;
  /** Сумма, о которой договорились сейчас. */
  agreed: string;
  paid: string;
  forgiven: string;
  remaining: string;
  status: "open" | "closed";
  description?: string;
  events: DebtEvent[];
};

export type DebtTotal = {
  currency: string;
  owe: string;
  owed: string;
};

export type DebtFlow = {
  currency: string;
  borrowed: string;
  repaid: string;
  lent: string;
  collected: string;
  forgiven: string;
  /** На сколько изменились счета из-за долгов за месяц. */
  cash: string;
};

export type NewDebt = {
  id: string;
  date: string;
  person: string;
  amount: string;
  currency: string;
  direction: MoneyDirection;
  account: string;
  description?: string;
};

export function nextDebtId(ids: Iterable<string>): string {
  let max = 0;
  for (const id of ids) {
    const match = /^d(\d+)$/.exec(id);
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  }
  return `d${max + 1}`;
}

export function prepareDebt(input: {
  person: string;
  amount: string;
  currency: string;
  direction: string;
  account: string;
  date: string;
  description: string;
  ids: Iterable<string>;
}): NewDebt | string {
  const person = input.person.trim();
  if (person.length === 0) {
    return "Введите имя человека";
  }
  if (person.includes('"') || /[\r\n]/.test(person)) {
    return "Имя должно быть в одну строку и без кавычек";
  }
  if (input.direction !== "from" && input.direction !== "to") {
    return "Направление долга должно быть from или to";
  }
  const amount = normalizeAmount(input.amount);
  if (amount === null) {
    return "Сумму запишите числом, не больше двух знаков после точки";
  }
  if (!isDate(input.date)) {
    return "Укажите дату долга";
  }
  const description = input.description.trim();
  if (/[\r\n]/.test(description)) {
    return "Описание должно быть в одну строку";
  }
  return {
    id: nextDebtId(input.ids),
    date: input.date,
    person,
    amount,
    currency: input.currency,
    direction: input.direction,
    account: input.account,
    ...(description ? { description } : {}),
  };
}

export function debtLine(debt: NewDebt): string {
  const description = debt.description ? ` :: ${debt.description}` : "";
  return `debt ${debt.id} ${debt.date} "${debt.person}" ${debt.amount} ${debt.currency} ${debt.direction} "${debt.account}"${description}`;
}

export function debtPaymentLine(input: {
  debt: string;
  date: string;
  amount: string;
  currency: string;
  direction: MoneyDirection;
  account: string;
  description?: string;
}): string {
  const description = input.description ? ` :: ${input.description}` : "";
  return `debt-pay ${input.debt} ${input.date} ${input.amount} ${input.currency} ${input.direction} "${input.account}"${description}`;
}

export function debtAgreedLine(input: {
  debt: string;
  date: string;
  amount: string;
  description?: string;
}): string {
  const description = input.description ? ` :: ${input.description}` : "";
  return `debt-agreed ${input.debt} ${input.date} ${input.amount}${description}`;
}

export function debtForgiveLine(input: {
  debt: string;
  date: string;
  description?: string;
}): string {
  const description = input.description ? ` :: ${input.description}` : "";
  return `debt-forgive ${input.debt} ${input.date}${description}`;
}

export function settleDirection(debt: Debt): MoneyDirection {
  return debt.direction === "owe" ? "from" : "to";
}

export function preparePayment(
  debt: Debt,
  input: { amount: string; date: string; account: AccountStatement; description: string },
): { amount: string; date: string; account: string; description?: string } | string {
  if (debt.status === "closed") {
    return "Долг уже закрыт";
  }
  const amount = normalizeAmount(input.amount);
  if (amount === null) {
    return "Сумму запишите числом, не больше двух знаков после точки";
  }
  if (Number(amount) <= 0) {
    return "Сумма должна быть больше нуля";
  }
  if (!isDate(input.date)) {
    return "Укажите дату";
  }
  if (input.account.currency !== debt.currency) {
    return `Долг в ${debt.currency}, а счёт в ${input.account.currency}`;
  }
  const description = input.description.trim();
  if (/[\r\n]/.test(description)) {
    return "Описание должно быть в одну строку";
  }
  return {
    amount,
    date: input.date,
    account: input.account.name,
    ...(description ? { description } : {}),
  };
}

export function prepareAgreed(
  debt: Debt,
  input: { amount: string; date: string; description: string },
): { amount: string; date: string; description?: string } | string {
  const amount = normalizeAmount(input.amount);
  if (amount === null) {
    return "Сумму запишите числом, не больше двух знаков после точки";
  }
  if (Number(amount) < Number(debt.paid)) {
    return `Уже возвращено ${formatCents(toCents(debt.paid))}, меньше этой суммы поставить нельзя`;
  }
  if (!isDate(input.date)) {
    return "Укажите дату";
  }
  const description = input.description.trim();
  if (/[\r\n]/.test(description)) {
    return "Описание должно быть в одну строку";
  }
  return {
    amount,
    date: input.date,
    ...(description ? { description } : {}),
  };
}

export function buildDebts(statements: Statement[]): Debt[] {
  type Draft = {
    id: string;
    person: string;
    currency: string;
    direction: DebtDirection;
    opened: string;
    account: string;
    principalCents: number;
    agreedCents: number;
    paidCents: number;
    forgivenCents: number;
    closedByForgive: boolean;
    description?: string;
    events: DebtEvent[];
  };

  const drafts = new Map<string, Draft>();
  for (const statement of statements) {
    if (statement.kind !== "debt") {
      continue;
    }
    drafts.set(statement.id ?? `d${statement.line}`, {
      id: statement.id ?? `d${statement.line}`,
      person: statement.person,
      currency: statement.currency,
      direction: statement.direction === "to" ? "owe" : "owed",
      opened: statement.date,
      account: statement.account,
      principalCents: toCents(statement.amount),
      agreedCents: toCents(statement.amount),
      paidCents: 0,
      forgivenCents: 0,
      closedByForgive: false,
      ...(statement.description ? { description: statement.description } : {}),
      events: [],
    });
  }

  const timeline: (
    | DebtStatement
    | Extract<Statement, { kind: "debt-pay" }>
    | Extract<Statement, { kind: "debt-agreed" }>
    | Extract<Statement, { kind: "debt-forgive" }>
  )[] = [];
  for (const statement of statements) {
    if (
      statement.kind === "debt" ||
      statement.kind === "debt-pay" ||
      statement.kind === "debt-agreed" ||
      statement.kind === "debt-forgive"
    ) {
      timeline.push(statement);
    }
  }
  timeline.sort(
    (left, right) => left.date.localeCompare(right.date) || left.line - right.line,
  );

  for (const statement of timeline) {
    const draft =
      statement.kind === "debt"
        ? drafts.get(statement.id ?? `d${statement.line}`)
        : drafts.get(statement.debt);
    if (!draft) {
      continue;
    }
    if (statement.kind === "debt") {
      draft.events.push({
        kind: "open",
        date: statement.date,
        line: statement.line,
        amount: statement.amount,
        account: statement.account,
        direction: statement.direction,
        ...(statement.description ? { description: statement.description } : {}),
      });
      continue;
    }
    if (statement.kind === "debt-pay") {
      const expected = draft.direction === "owe" ? "from" : "to";
      if (statement.direction !== expected) {
        continue;
      }
      const cents = toCents(statement.amount);
      draft.paidCents += cents;
      draft.events.push({
        kind: "pay",
        date: statement.date,
        line: statement.line,
        amount: statement.amount,
        account: statement.account,
        direction: statement.direction,
        ...(statement.description ? { description: statement.description } : {}),
      });
      continue;
    }
    if (statement.kind === "debt-agreed") {
      const next = toCents(statement.amount);
      const discount = Math.max(draft.agreedCents - next, 0);
      draft.agreedCents = next;
      draft.forgivenCents += discount;
      draft.events.push({
        kind: "agreed",
        date: statement.date,
        line: statement.line,
        amount: statement.amount,
        ...(discount > 0 ? { forgiven: fromCents(discount) } : {}),
        ...(statement.description ? { description: statement.description } : {}),
      });
      continue;
    }
    const discount = Math.max(draft.agreedCents - draft.paidCents, 0);
    draft.closedByForgive = true;
    draft.forgivenCents += discount;
    draft.events.push({
      kind: "forgive",
      date: statement.date,
      line: statement.line,
      amount: fromCents(discount),
      forgiven: fromCents(discount),
      ...(statement.description ? { description: statement.description } : {}),
    });
  }

  const debts: Debt[] = [];
  for (const draft of drafts.values()) {
    const remainingCents = draft.closedByForgive
      ? 0
      : Math.max(draft.agreedCents - draft.paidCents, 0);
    const forgivenCents = Math.max(
      draft.principalCents - draft.paidCents - remainingCents,
      draft.forgivenCents,
    );
    debts.push({
      id: draft.id,
      person: draft.person,
      currency: draft.currency,
      direction: draft.direction,
      opened: draft.opened,
      account: draft.account,
      principal: fromCents(draft.principalCents),
      agreed: fromCents(draft.agreedCents),
      paid: fromCents(draft.paidCents),
      forgiven: fromCents(forgivenCents),
      remaining: fromCents(remainingCents),
      status: remainingCents === 0 ? "closed" : "open",
      ...(draft.description ? { description: draft.description } : {}),
      events: draft.events,
    });
  }
  return debts.sort(
    (left, right) =>
      Number(left.status === "closed") - Number(right.status === "closed") ||
      right.opened.localeCompare(left.opened) ||
      left.person.localeCompare(right.person, "ru"),
  );
}

export function debtTotals(debts: Debt[]): DebtTotal[] {
  const totals = new Map<string, { owe: number; owed: number }>();
  for (const debt of debts) {
    if (debt.status === "closed") {
      continue;
    }
    const bucket = totals.get(debt.currency) ?? { owe: 0, owed: 0 };
    if (debt.direction === "owe") {
      bucket.owe += toCents(debt.remaining);
    } else {
      bucket.owed += toCents(debt.remaining);
    }
    totals.set(debt.currency, bucket);
  }
  return [...totals.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([currency, bucket]) => ({
      currency,
      owe: fromCents(bucket.owe),
      owed: fromCents(bucket.owed),
    }));
}

export function debtMonthFlow(debts: Debt[], month: string): DebtFlow[] {
  const flows = new Map<
    string,
    { borrowed: number; repaid: number; lent: number; collected: number; forgiven: number }
  >();
  for (const debt of debts) {
    const bucket = flows.get(debt.currency) ?? {
      borrowed: 0,
      repaid: 0,
      lent: 0,
      collected: 0,
      forgiven: 0,
    };
    for (const event of debt.events) {
      if (!event.date.startsWith(`${month}-`)) {
        continue;
      }
      if (event.kind === "open") {
        if (debt.direction === "owe") {
          bucket.borrowed += toCents(event.amount);
        } else {
          bucket.lent += toCents(event.amount);
        }
      }
      if (event.kind === "pay") {
        if (debt.direction === "owe") {
          bucket.repaid += toCents(event.amount);
        } else {
          bucket.collected += toCents(event.amount);
        }
      }
      if (event.forgiven) {
        bucket.forgiven += toCents(event.forgiven);
      }
    }
    flows.set(debt.currency, bucket);
  }
  return [...flows.entries()]
    .filter(([, bucket]) => Object.values(bucket).some((cents) => cents !== 0))
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([currency, bucket]) => ({
      currency,
      borrowed: fromCents(bucket.borrowed),
      repaid: fromCents(bucket.repaid),
      lent: fromCents(bucket.lent),
      collected: fromCents(bucket.collected),
      forgiven: fromCents(bucket.forgiven),
      cash: fromCents(bucket.borrowed + bucket.collected - bucket.repaid - bucket.lent),
    }));
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
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

function toCents(amount: string): number {
  const [whole, fraction = ""] = amount.split(".");
  return Math.round(Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2)));
}

function fromCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

function formatCents(cents: number): string {
  return fromCents(cents);
}
