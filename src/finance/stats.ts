import type {
  CategoryStatement,
  ExpenseStatement,
  IncomeStatement,
  Statement,
} from "./parse";

export type CategoryTotal = {
  name: string;
  amount: string;
};

export type CurrencyStats = {
  currency: string;
  income: string;
  expense: string;
  incomeCategories: CategoryTotal[];
  expenseCategories: CategoryTotal[];
};

export type MoneyTotal = {
  currency: string;
  amount: string;
};

/** Строка операции вместе с месяцем файла, из которого она прочитана. */
export type DatedStatement = {
  month: string;
  statement: Statement;
};

export type CategoryHistory = {
  kind: "expense" | "income";
  operations: number;
  months: number;
  totals: MoneyTotal[];
  /** Средняя сумма за месяц, в котором были операции. */
  perMonth: MoneyTotal[];
  averageCheck: MoneyTotal[];
  monthly: { month: string; operations: number; totals: MoneyTotal[] }[];
  biggest: { date: string; amount: string; currency: string; title?: string } | null;
};

export type MonthInsight = {
  currency: string;
  operations: number;
  days: number;
  averageCheck: string;
  top: CategoryTotal | null;
  biggest: { date: string; title: string; amount: string } | null;
};

export type AmountDelta = {
  current: string;
  previous: string;
  deltaCents: number;
  /** Изменение в процентах; null, если в прошлом месяце было ноль. */
  percent: number | null;
};

export type CategoryDelta = AmountDelta & {
  name: string;
};

export type MonthComparison = {
  currency: string;
  expense: AmountDelta;
  income: AmountDelta;
  categories: CategoryDelta[];
};

export function monthStats(statements: Statement[]): CurrencyStats[] {
  const expense = new Map<string, Map<string, number>>();
  const income = new Map<string, Map<string, number>>();

  for (const statement of statements) {
    if (statement.kind !== "expense" && statement.kind !== "income") {
      continue;
    }
    const groups = statement.kind === "expense" ? expense : income;
    const categories = groups.get(statement.currency) ?? new Map<string, number>();
    categories.set(
      statement.category,
      (categories.get(statement.category) ?? 0) + toCents(statement.amount),
    );
    groups.set(statement.currency, categories);
  }

  const currencies = new Set([...expense.keys(), ...income.keys()]);
  return [...currencies].sort().map((currency) => ({
    currency,
    income: fromCents(sum(income.get(currency))),
    expense: fromCents(sum(expense.get(currency))),
    incomeCategories: totals(income.get(currency)),
    expenseCategories: totals(expense.get(currency)),
  }));
}

/** Вся история одной категории: суммы, месяцы, средние и крупнейшая операция. */
export function categoryHistory(
  entries: DatedStatement[],
  category: CategoryStatement,
): CategoryHistory {
  const movements: { month: string; statement: ExpenseStatement | IncomeStatement }[] = [];
  for (const entry of entries) {
    const statement = entry.statement;
    if (statement.kind !== "expense" && statement.kind !== "income") {
      continue;
    }
    if (statement.category !== category.name || statement.kind !== category.categoryKind) {
      continue;
    }
    movements.push({ month: entry.month, statement });
  }

  const totalsByCurrency = new Map<string, number>();
  const monthly = new Map<string, { count: number; totals: Map<string, number> }>();
  let biggest: { date: string; cents: number; currency: string; title?: string } | undefined;

  for (const movement of movements) {
    const { statement } = movement;
    const cents = toCents(statement.amount);
    totalsByCurrency.set(statement.currency, (totalsByCurrency.get(statement.currency) ?? 0) + cents);

    const bucket = monthly.get(movement.month) ?? { count: 0, totals: new Map<string, number>() };
    bucket.count += 1;
    bucket.totals.set(statement.currency, (bucket.totals.get(statement.currency) ?? 0) + cents);
    monthly.set(movement.month, bucket);

    if (!biggest || cents > biggest.cents) {
      biggest = {
        date: statement.date,
        cents,
        currency: statement.currency,
        ...(statement.title ? { title: statement.title } : {}),
      };
    }
  }

  const monthRows = [...monthly.entries()]
    .sort((left, right) => right[0].localeCompare(left[0]))
    .map(([month, bucket]) => ({
      month,
      operations: bucket.count,
      totals: moneyTotals(bucket.totals),
    }));

  return {
    kind: category.categoryKind,
    operations: movements.length,
    months: monthRows.length,
    totals: moneyTotals(totalsByCurrency),
    perMonth: divide(totalsByCurrency, monthRows.length),
    averageCheck: divide(totalsByCurrency, movements.length),
    monthly: monthRows,
    biggest: biggest
      ? {
          date: biggest.date,
          amount: fromCents(biggest.cents),
          currency: biggest.currency,
          ...(biggest.title ? { title: biggest.title } : {}),
        }
      : null,
  };
}

/** Операции, дни с тратами, средний чек и крайние значения месяца. */
export function monthInsights(statements: Statement[]): MonthInsight[] {
  const groups = new Map<
    string,
    {
      count: number;
      days: Set<string>;
      categories: Map<string, number>;
      biggest: { date: string; title: string; cents: number } | undefined;
    }
  >();

  for (const statement of statements) {
    if (statement.kind !== "expense") {
      continue;
    }
    const group =
      groups.get(statement.currency) ??
      { count: 0, days: new Set<string>(), categories: new Map<string, number>(), biggest: undefined };
    group.count += 1;
    group.days.add(statement.date);
    group.categories.set(
      statement.category,
      (group.categories.get(statement.category) ?? 0) + toCents(statement.amount),
    );
    const cents = toCents(statement.amount);
    if (!group.biggest || cents > group.biggest.cents) {
      group.biggest = {
        date: statement.date,
        title: statement.title?.trim() || statement.category,
        cents,
      };
    }
    groups.set(statement.currency, group);
  }

  return [...groups.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([currency, group]) => ({
      currency,
      operations: group.count,
      days: group.days.size,
      averageCheck: fromCents(Math.round(sumCents(group.categories) / group.count)),
      top: topCategory(group.categories),
      biggest: group.biggest
        ? {
            date: group.biggest.date,
            title: group.biggest.title,
            amount: fromCents(group.biggest.cents),
          }
        : null,
    }));
}

/** Сравнение месяца с предыдущим: итоги и изменения по категориям. */
export function monthComparison(
  current: CurrencyStats[],
  previous: CurrencyStats[],
): MonthComparison[] {
  const currencies = new Set([
    ...current.map((stat) => stat.currency),
    ...previous.map((stat) => stat.currency),
  ]);

  return [...currencies].sort().map((currency) => {
    const now = current.find((stat) => stat.currency === currency);
    const before = previous.find((stat) => stat.currency === currency);
    return {
      currency,
      expense: amountDelta(now?.expense ?? "0.00", before?.expense ?? "0.00"),
      income: amountDelta(now?.income ?? "0.00", before?.income ?? "0.00"),
      categories: categoryDeltas(
        now?.expenseCategories ?? [],
        before?.expenseCategories ?? [],
      ),
    };
  });
}

function amountDelta(current: string, previous: string): AmountDelta {
  const currentCents = toCents(current);
  const previousCents = toCents(previous);
  const diff = currentCents - previousCents;
  return {
    current: fromCents(currentCents),
    previous: fromCents(previousCents),
    deltaCents: diff,
    percent: previousCents > 0 ? Math.round((diff / previousCents) * 1000) / 10 : null,
  };
}

function categoryDeltas(current: CategoryTotal[], previous: CategoryTotal[]): CategoryDelta[] {
  const names = new Set([...current.map((row) => row.name), ...previous.map((row) => row.name)]);
  const rows: CategoryDelta[] = [];
  for (const name of names) {
    const now = current.find((row) => row.name === name)?.amount ?? "0.00";
    const before = previous.find((row) => row.name === name)?.amount ?? "0.00";
    const delta = amountDelta(now, before);
    if (delta.deltaCents !== 0) {
      rows.push({ name, ...delta });
    }
  }
  return rows.sort(
    (left, right) =>
      Math.abs(right.deltaCents) - Math.abs(left.deltaCents) ||
      left.name.localeCompare(right.name, "ru"),
  );
}

function topCategory(categories: Map<string, number>): CategoryTotal | null {
  let best: CategoryTotal | null = null;
  let bestCents = 0;
  for (const [name, cents] of categories) {
    if (best === null || cents > bestCents) {
      best = { name, amount: fromCents(cents) };
      bestCents = cents;
    }
  }
  return best;
}

function moneyTotals(categories: Map<string, number>): MoneyTotal[] {
  return [...categories.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([currency, cents]) => ({ currency, amount: fromCents(cents) }));
}

function divide(categories: Map<string, number>, count: number): MoneyTotal[] {
  if (count <= 0) {
    return [];
  }
  return [...categories.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([currency, cents]) => ({
      currency,
      amount: fromCents(Math.round(cents / count)),
    }));
}

function totals(categories: Map<string, number> | undefined): CategoryTotal[] {
  if (!categories) {
    return [];
  }
  return [...categories.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "ru"))
    .map(([name, cents]) => ({ name, amount: fromCents(cents) }));
}

function sum(categories: Map<string, number> | undefined): number {
  let total = 0;
  for (const cents of categories?.values() ?? []) {
    total += cents;
  }
  return total;
}

function sumCents(categories: Map<string, number>): number {
  let total = 0;
  for (const cents of categories.values()) {
    total += cents;
  }
  return total;
}

function toCents(amount: string): number {
  const [whole, fraction = ""] = amount.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
}

function fromCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  const whole = Math.floor(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, "0");
  return `${sign}${whole}.${fraction}`;
}
