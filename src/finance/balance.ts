import type { AccountStatement, Statement } from "./parse";

export type Balance = {
  name: string;
  currency: string;
  amount: string;
};

export function balances(statements: Statement[]): Balance[] {
  const accounts: AccountStatement[] = [];
  const seen = new Set<string>();
  for (const statement of statements) {
    if (statement.kind === "account" && !seen.has(statement.name)) {
      accounts.push(statement);
      seen.add(statement.name);
    }
  }

  const cents = new Map<string, number>();
  for (const account of accounts) {
    cents.set(account.name, toCents(account.opening));
  }

  for (const statement of statements) {
    if (statement.kind === "expense") {
      add(cents, accounts, statement.account, statement.currency, -toCents(statement.amount));
    }
    if (statement.kind === "income") {
      add(cents, accounts, statement.account, statement.currency, toCents(statement.amount));
    }
    if (statement.kind === "transfer") {
      add(cents, accounts, statement.from, statement.currency, -toCents(statement.amount));
      add(cents, accounts, statement.to, statement.currency, toCents(statement.amount));
    }
    if (statement.kind === "exchange") {
      add(cents, accounts, statement.from, statement.currency, -toCents(statement.amount));
      add(cents, accounts, statement.to, statement.toCurrency, toCents(statement.toAmount));
    }
    if (statement.kind === "debt") {
      add(
        cents,
        accounts,
        statement.account,
        statement.currency,
        statement.direction === "to" ? toCents(statement.amount) : -toCents(statement.amount),
      );
    }
    if (statement.kind === "debt-pay") {
      add(
        cents,
        accounts,
        statement.account,
        statement.currency,
        statement.direction === "to" ? toCents(statement.amount) : -toCents(statement.amount),
      );
    }
  }

  return accounts.map((account) => ({
    name: account.name,
    currency: account.currency,
    amount: fromCents(cents.get(account.name) ?? 0),
  }));
}

function add(
  cents: Map<string, number>,
  accounts: AccountStatement[],
  name: string,
  currency: string,
  delta: number,
): void {
  const account = accounts.find((item) => item.name === name);
  if (!account || account.currency !== currency || !cents.has(name)) {
    return;
  }
  cents.set(name, (cents.get(name) ?? 0) + delta);
}

function toCents(amount: string): number {
  const negative = amount.startsWith("-");
  const [whole, fraction] = amount.replace("-", "").split(".");
  const cents = Number(whole) * 100 + Number(fraction);
  return negative ? -cents : cents;
}

function fromCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  const whole = Math.floor(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, "0");
  return `${sign}${whole}.${fraction}`;
}
