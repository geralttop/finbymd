import { readDataFolder } from "../data-folder";
import { balances } from "../finance/balance";
import { interpretFiles } from "../finance/load";
import { buildDebts } from "../finance/debt";
import { buildPlans } from "../finance/plans";
import type { Statement } from "../finance/parse";
import { alreadyPosted } from "../finance/recurring-file";
import { operationView, type OperationView } from "../ledger/actions";

export type ChatSnapshot = {
  today: string;
  month: string;
  accounts: {
    name: string;
    type: "cash" | "bank";
    currency: string;
    balance: string;
  }[];
  categories: { name: string; kind: "expense" | "income" }[];
  recurring: {
    id?: string;
    name: string;
    amount: string;
    currency: string;
    account: string;
    category: string;
    day: number;
    posted: boolean;
  }[];
  operations: OperationView[];
  operationsTotal: number;
  debts: {
    id: string;
    person: string;
    direction: "owe" | "owed";
    currency: string;
    principal: string;
    agreed: string;
    paid: string;
    forgiven: string;
    remaining: string;
    status: "open" | "closed";
    account: string;
    opened: string;
    description?: string;
  }[];
  plans: {
    id: string;
    title: string;
    amount: string;
    currency: string;
    due?: string;
    priority?: number;
    done?: string;
    description?: string;
  }[];
};

const MAX_OPERATIONS = 80;
const MAX_DESCRIPTION = 160;

export async function buildSnapshot(dir: string, month: string): Promise<ChatSnapshot> {
  const files = await readDataFolder(dir);
  const loaded = interpretFiles(files);
  const statements = loaded.statements.map((item) => item.statement);
  const accounts = new Map<string, "cash" | "bank">();
  for (const statement of statements) {
    if (statement.kind === "account" && !accounts.has(statement.name)) {
      accounts.set(statement.name, statement.accountType);
    }
  }
  const accountBalances = balances(statements).map((item) => ({
    name: item.name,
    type: accounts.get(item.name) ?? "cash",
    currency: item.currency,
    balance: item.amount,
  }));

  const categories = statements
    .flatMap((statement) =>
      statement.kind === "category"
        ? [{ name: statement.name, kind: statement.categoryKind }]
        : [],
    )
    .filter(
      (category, index, list) =>
        list.findIndex((item) => item.name === category.name) === index,
    );

  const monthFile = `transactions/${month}.md`;
  const monthStatements = loaded.statements
    .filter((item) => item.file === monthFile)
    .map((item) => item.statement);
  const operations = monthStatements
    .flatMap((statement) => {
      const view = operationViewIfPossible(statement);
      if (!view) {
        return [];
      }
      return [
        {
          ...view,
          title: truncate(view.title, MAX_DESCRIPTION),
          description: truncate(view.description, MAX_DESCRIPTION),
        },
      ];
    })
    .sort((left, right) => right.date.localeCompare(left.date));

  const recurring = statements
    .flatMap((statement) =>
      statement.kind === "recurring"
        ? [
            {
              id: statement.id,
              name: statement.name,
              amount: statement.amount,
              currency: statement.currency,
              account: statement.account,
              category: statement.category,
              day: statement.day,
              posted: alreadyPosted(monthStatements, statement),
            },
          ]
        : [],
    )
    .sort((left, right) => left.day - right.day);

  const debts = buildDebts(statements).map((debt) => ({
    id: debt.id,
    person: debt.person,
    direction: debt.direction,
    currency: debt.currency,
    principal: debt.principal,
    agreed: debt.agreed,
    paid: debt.paid,
    forgiven: debt.forgiven,
    remaining: debt.remaining,
    status: debt.status,
    account: debt.account,
    opened: debt.opened,
    ...(debt.description ? { description: truncate(debt.description, MAX_DESCRIPTION) } : {}),
  }));

  const plans = buildPlans(statements).map((plan) => ({
    id: plan.id,
    title: plan.title,
    amount: plan.amount,
    currency: plan.currency,
    ...(plan.due ? { due: plan.due } : {}),
    ...(plan.priority !== undefined ? { priority: plan.priority } : {}),
    ...(plan.done ? { done: plan.done } : {}),
    ...(plan.description ? { description: truncate(plan.description, MAX_DESCRIPTION) } : {}),
  }));

  return {
    today: todayKey(),
    month,
    accounts: accountBalances,
    categories,
    recurring,
    operations: operations.slice(0, MAX_OPERATIONS),
    operationsTotal: operations.length,
    debts,
    plans,
  };
}

function operationViewIfPossible(statement: Statement): OperationView | null {
  if (
    statement.kind === "expense" ||
    statement.kind === "income" ||
    statement.kind === "transfer" ||
    statement.kind === "exchange"
  ) {
    return operationView(statement);
  }
  return null;
}

function truncate(value: string | undefined, limit: number): string | undefined {
  if (!value || value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit - 1)}…`;
}

function todayKey(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}
