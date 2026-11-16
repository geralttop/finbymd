import { accountLine, type NewAccount } from "./account-file";
import { debtLine, debtPaymentLine } from "./debt";
import { movementLine } from "./entry-file";
import { parseFinance, type Statement } from "./parse";
import { recurringLine } from "./recurring-file";
import { transferLine } from "./transfer-file";

export type AccountUsage = {
  operations: number;
  recurring: number;
  total: number;
};

/** Сколько строк ссылается на счёт. */
export function accountUsage(statements: Statement[], name: string): AccountUsage {
  let operations = 0;
  let recurring = 0;
  for (const statement of statements) {
    if (statement.kind === "expense" || statement.kind === "income") {
      if (statement.account === name) {
        operations += 1;
      }
      continue;
    }
    if (statement.kind === "transfer" || statement.kind === "exchange") {
      if (statement.from === name || statement.to === name) {
        operations += 1;
      }
      continue;
    }
    if (statement.kind === "recurring" && statement.account === name) {
      recurring += 1;
      continue;
    }
    if (
      (statement.kind === "debt" || statement.kind === "debt-pay") &&
      statement.account === name
    ) {
      operations += 1;
    }
  }
  return { operations, recurring, total: operations + recurring };
}

/** Заменяет строку счёта в accounts.md, сохраняя переносы строк. */
export function replaceAccountLine(
  source: string,
  line: number,
  account: NewAccount,
): string | null {
  const lines = source.split(/\r?\n/);
  const index = line - 1;
  if (index < 0 || index >= lines.length) {
    return null;
  }
  if (!lines[index].trim().startsWith("account ")) {
    return null;
  }
  lines[index] = accountLine(account);
  return lines.join(newlineOf(source));
}

/**
 * Переименовывает счёт во всех строках файла: расходы, доходы, переводы,
 * обмены и повторы. Заголовки и описания операций не трогаются.
 */
export function rewriteAccountReferences(
  source: string,
  oldName: string,
  newName: string,
): { source: string; changed: boolean } {
  if (oldName === newName) {
    return { source, changed: false };
  }
  const statements = parseFinance(source).statements;
  const lines = source.split(/\r?\n/);
  let changed = false;
  for (const statement of statements) {
    if (!referencesAccount(statement, oldName)) {
      continue;
    }
    const line = rewriteStatement(statement, oldName, newName);
    if (line === null) {
      continue;
    }
    lines[statement.line - 1] = line;
    changed = true;
  }
  return { source: lines.join(newlineOf(source)), changed };
}

function referencesAccount(statement: Statement, name: string): boolean {
  if (statement.kind === "expense" || statement.kind === "income") {
    return statement.account === name;
  }
  if (statement.kind === "transfer" || statement.kind === "exchange") {
    return statement.from === name || statement.to === name;
  }
  if (statement.kind === "recurring" || statement.kind === "debt" || statement.kind === "debt-pay") {
    return statement.account === name;
  }
  return false;
}

function rewriteStatement(statement: Statement, oldName: string, newName: string): string | null {
  if (statement.kind === "expense" || statement.kind === "income") {
    return movementLine({
      kind: statement.kind,
      id: statement.id,
      date: statement.date,
      amount: statement.amount,
      currency: statement.currency,
      account: newName,
      category: statement.category,
      title: statement.title,
      description: statement.description,
    });
  }
  if (statement.kind === "transfer" || statement.kind === "exchange") {
    return transferLine({
      kind: statement.kind,
      id: statement.id,
      date: statement.date,
      amount: statement.amount,
      currency: statement.currency,
      from: statement.from === oldName ? newName : statement.from,
      to: statement.to === oldName ? newName : statement.to,
      toAmount: statement.kind === "exchange" ? statement.toAmount : undefined,
      toCurrency: statement.kind === "exchange" ? statement.toCurrency : undefined,
      description: statement.description,
    });
  }
  if (statement.kind === "recurring") {
    return recurringLine({
      id: statement.id,
      name: statement.name,
      account: newName,
      category: statement.category,
      amount: statement.amount,
      currency: statement.currency,
      day: statement.day,
    });
  }
  if (statement.kind === "debt") {
    return debtLine({
      id: statement.id ?? "",
      date: statement.date,
      person: statement.person,
      amount: statement.amount,
      currency: statement.currency,
      direction: statement.direction,
      account: newName,
      ...(statement.description ? { description: statement.description } : {}),
    });
  }
  if (statement.kind === "debt-pay") {
    return debtPaymentLine({
      debt: statement.debt,
      date: statement.date,
      amount: statement.amount,
      currency: statement.currency,
      direction: statement.direction,
      account: newName,
      ...(statement.description ? { description: statement.description } : {}),
    });
  }
  return null;
}

function newlineOf(source: string): string {
  return source.includes("\r\n") ? "\r\n" : "\n";
}
