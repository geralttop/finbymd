import type { ChatSnapshot } from "../../src/chat/context";
import { balances } from "../../src/finance/balance";
import type { Book } from "../storage";

export function buildSnapshot(book: Book, month: string, today: string): ChatSnapshot {
  const types = new Map<string, "cash" | "bank">();
  for (const account of book.accounts) {
    if (!types.has(account.name)) {
      types.set(account.name, account.accountType);
    }
  }
  const accounts = balances(book.statements.map((item) => item.statement)).map((item) => ({
    name: item.name,
    type: types.get(item.name) ?? "cash",
    currency: item.currency,
    balance: item.amount,
  }));

  const operations: ChatSnapshot["operations"] = [];
  for (const item of book.statements) {
    if (item.file !== `transactions/${month}.md`) {
      continue;
    }
    const statement = item.statement;
    if (statement.kind !== "expense" && statement.kind !== "income") {
      continue;
    }
    operations.push({
      id: statement.id,
      kind: statement.kind,
      date: statement.date,
      amount: statement.amount,
      currency: statement.currency,
      account: statement.account,
      category: statement.category,
      title: statement.title,
      description: statement.description,
    });
  }
  operations.sort((left, right) => right.date.localeCompare(left.date));

  return {
    today,
    month,
    accounts,
    categories: book.categories.map((item) => ({ name: item.name, kind: item.categoryKind })),
    recurring: [],
    operations: operations.slice(0, 80),
    operationsTotal: operations.length,
  };
}

export function todayKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
