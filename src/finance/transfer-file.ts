import { nextTransactionId } from "./entry-file";
import {
  parseFinance,
  validateLedger,
  type AccountStatement,
  type Statement,
} from "./parse";

export type NewTransfer = {
  kind: "transfer" | "exchange";
  id?: string;
  date: string;
  amount: string;
  currency: string;
  from: string;
  to: string;
  toAmount?: string;
  toCurrency?: string;
  description?: string;
};

export function transferLine(transfer: NewTransfer): string {
  const id = transfer.id ? `${transfer.id} ` : "";
  const description = transfer.description ? ` :: ${transfer.description}` : "";
  const head = `${transfer.kind} ${id}${transfer.date} ${transfer.amount} ${transfer.currency} from "${transfer.from}" to "${transfer.to}"`;
  if (transfer.kind === "exchange") {
    return `${head} ${transfer.toAmount} ${transfer.toCurrency}${description}`;
  }
  return `${head}${description}`;
}

export function prepareTransfer(input: {
  date: string;
  amount: string;
  toAmount: string;
  from: string;
  to: string;
  description: string;
  month: string;
  accounts: AccountStatement[];
  ids: Iterable<string>;
}): NewTransfer | string {
  const description = input.description.trim();
  if (/[\r\n]/.test(description)) {
    return "Описание должно быть в одну строку";
  }
  const from = input.accounts.find((account) => account.name === input.from);
  const to = input.accounts.find((account) => account.name === input.to);
  if (!from || !to) {
    return "Выберите счёт";
  }
  if (from.name === to.name) {
    return `Перевод на тот же счёт «${from.name}»`;
  }
  const amount = normalizeAmount(input.amount);
  if (amount === null) {
    return "Сумму запишите числом, не больше двух знаков после точки";
  }
  const exchange = from.currency !== to.currency;
  const second = exchange ? normalizeAmount(input.toAmount) : null;
  if (exchange && second === null) {
    return "Вторую сумму запишите числом, не больше двух знаков после точки";
  }

  const transfer: NewTransfer = {
    kind: exchange ? "exchange" : "transfer",
    id: nextTransactionId(input.ids),
    date: input.date.trim(),
    amount,
    currency: from.currency,
    from: from.name,
    to: to.name,
  };
  if (exchange && second) {
    transfer.toAmount = second;
    transfer.toCurrency = to.currency;
  }
  if (description) {
    transfer.description = description;
  }

  const parsed = parseFinance(`\`\`\`finance\n${transferLine(transfer)}\n\`\`\`\n`, {
    month: input.month,
  });
  if (parsed.errors.length > 0) {
    return parsed.errors[0].message;
  }
  const ledger: Statement[] = [...input.accounts, parsed.statements[0]];
  const errors = validateLedger(ledger);
  if (errors.length > 0) {
    return errors[0].message;
  }
  return transfer;
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
