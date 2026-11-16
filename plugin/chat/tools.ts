import type { App } from "obsidian";
import type { ToolDefinition } from "../../src/chat/protocol";
import type { Statement } from "../../src/finance/parse";
import type { Book } from "../storage";
import { addOperation, deleteOperation } from "../storage";

export const CHAT_TOOLS: ToolDefinition[] = [
  {
    name: "list_accounts",
    description: "Список счетов с валютами и остатками.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "list_categories",
    description: "Список категорий с видом: expense или income.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "list_operations",
    description: "Операции выбранного месяца.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "add_expense",
    description: "Записать расход в выбранном месяце.",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "Дата YYYY-MM-DD" },
        amount: { type: "string", description: "Сумма числом, две цифры после точки" },
        account: { type: "string" },
        category: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
      },
      required: ["date", "amount", "account", "category"],
    },
  },
  {
    name: "add_income",
    description: "Записать доход в выбранном месяце.",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "Дата YYYY-MM-DD" },
        amount: { type: "string", description: "Сумма числом, две цифры после точки" },
        account: { type: "string" },
        category: { type: "string" },
        title: { type: "string" },
        description: { type: "string" },
      },
      required: ["date", "amount", "account", "category"],
    },
  },
  {
    name: "delete_operation",
    description: "Удалить операцию по id. Только по явной просьбе человека.",
    parameters: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
];

export async function executeTool(
  app: App,
  book: Book,
  month: string,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const text = (key: string): string => (typeof args[key] === "string" ? (args[key] as string) : "");
  switch (name) {
    case "list_accounts":
      return JSON.stringify(book.accounts.map((item) => ({
        name: item.name,
        type: item.accountType,
        currency: item.currency,
      })));
    case "list_categories":
      return JSON.stringify(book.categories.map((item) => ({
        name: item.name,
        kind: item.categoryKind,
      })));
    case "list_operations": {
      const rows = book.statements
        .filter((item) => item.file === `transactions/${month}.md`)
        .flatMap((item) =>
          item.statement.kind === "expense" || item.statement.kind === "income"
            ? [item.statement]
            : [],
        )
        .map((item) => ({
          id: item.id,
          kind: item.kind,
          date: item.date,
          amount: item.amount,
          currency: item.currency,
          account: item.account,
          category: item.category,
          title: item.title,
        }));
      return JSON.stringify(rows);
    }
    case "add_expense":
    case "add_income": {
      const error = await addOperation(app, book.folder, month, {
        kind: name === "add_expense" ? "expense" : "income",
        date: text("date"),
        amount: text("amount"),
        account: text("account"),
        category: text("category"),
        title: text("title"),
        description: text("description"),
      });
      return error ? JSON.stringify({ ok: false, error }) : JSON.stringify({ ok: true });
    }
    case "delete_operation": {
      const id = text("id");
      let target: { file: string; statement: Operation } | null = null;
      for (const item of book.statements) {
        if (isOperation(item.statement) && item.statement.id === id) {
          target = { file: item.file, statement: item.statement };
          break;
        }
      }
      if (!target) {
        return JSON.stringify({ ok: false, error: `Операция ${id} не найдена` });
      }
      const error = await deleteOperation(app, book.folder, month, {
        file: target.file,
        kind: target.statement.kind as "expense" | "income" | "transfer" | "exchange",
        date: target.statement.date,
        line: target.statement.line,
        id,
      });
      return error ? JSON.stringify({ ok: false, error }) : JSON.stringify({ ok: true });
    }
    default:
      return JSON.stringify({ ok: false, error: `Неизвестный инструмент ${name}` });
  }
}

type Operation = Extract<Statement, { date: string }>;

function isOperation(statement: Statement): statement is Operation {
  return (
    statement.kind === "expense" ||
    statement.kind === "income" ||
    statement.kind === "transfer" ||
    statement.kind === "exchange"
  );
}
