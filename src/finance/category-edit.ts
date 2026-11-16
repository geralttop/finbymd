import { categoryLine, type NewCategory } from "./category-file";
import { retireStatement } from "./edit-line";
import { movementLine } from "./entry-file";
import { parseFinance, type Statement } from "./parse";
import { recurringLine } from "./recurring-file";

export type CategoryUsage = {
  operations: number;
  recurring: number;
  total: number;
};

export function categoryUsage(statements: Statement[], name: string): CategoryUsage {
  let operations = 0;
  let recurring = 0;
  for (const statement of statements) {
    if (statement.kind === "expense" || statement.kind === "income") {
      if (statement.category === name) {
        operations += 1;
      }
      continue;
    }
    if (statement.kind === "recurring" && statement.category === name) {
      recurring += 1;
    }
  }
  return { operations, recurring, total: operations + recurring };
}

export function replaceCategoryLine(
  source: string,
  line: number,
  category: NewCategory,
): string | null {
  const lines = source.split(/\r?\n/);
  const index = line - 1;
  if (index < 0 || index >= lines.length) {
    return null;
  }
  if (!lines[index].trim().startsWith("category ")) {
    return null;
  }
  lines[index] = categoryLine(category);
  return lines.join(newlineOf(source));
}

export function rewriteCategoryReferences(
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
    if (!referencesCategory(statement, oldName)) {
      continue;
    }
    const line = rewriteStatement(statement, newName);
    if (line === null) {
      continue;
    }
    lines[statement.line - 1] = line;
    changed = true;
  }
  return { source: lines.join(newlineOf(source)), changed };
}

export function removeStatementLine(source: string, line: number): string | null {
  return retireStatement(source, line, undefined);
}

function referencesCategory(statement: Statement, name: string): boolean {
  return (
    (statement.kind === "expense" ||
      statement.kind === "income" ||
      statement.kind === "recurring") &&
    statement.category === name
  );
}

function rewriteStatement(statement: Statement, newName: string): string | null {
  if (statement.kind === "expense" || statement.kind === "income") {
    return movementLine({
      kind: statement.kind,
      id: statement.id,
      date: statement.date,
      amount: statement.amount,
      currency: statement.currency,
      account: statement.account,
      category: newName,
      title: statement.title,
      description: statement.description,
    });
  }
  if (statement.kind === "recurring") {
    return recurringLine({
      id: statement.id,
      name: statement.name,
      account: statement.account,
      category: newName,
      amount: statement.amount,
      currency: statement.currency,
      day: statement.day,
    });
  }
  return null;
}

function newlineOf(source: string): string {
  return source.includes("\r\n") ? "\r\n" : "\n";
}
