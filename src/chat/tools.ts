import {
  addDebt,
  addExpense,
  addIncome,
  addPlan,
  changeDebt,
  completePlan,
  deleteDebt,
  deletePlan,
  forgiveDebt,
  payDebt,
  listDebts,
  listPlans,
  addTransfer,
  createCategory,
  createRecurring,
  deleteCategory,
  deleteOperation,
  deleteRecurring,
  editOperation,
  editDebt,
  editTransfer,
  listAccounts,
  listCategories,
  listOperations,
  listRecurring,
  postRecurringNow,
  renameCategory,
  type ActionContext,
  type ActionResult,
} from "../ledger/actions";
import type { ToolDefinition } from "./protocol";

const AMOUNT = {
  type: "string",
  description: "Amount as a plain number with a dot and up to two decimals, e.g. 1000.00",
} as const;

const ACCOUNT = {
  type: "string",
  description: "Exact account name from list_accounts, e.g. Карта",
} as const;

const CATEGORY = {
  type: "string",
  description: "Exact category name of the right kind, e.g. Продукты",
} as const;

const DEBT_ID = {
  type: "string",
  description: "Debt id from list_debts or the snapshot, e.g. d1",
} as const;

const PLAN_ID = {
  type: "string",
  description: "Plan id from list_plans or the snapshot, e.g. p1",
} as const;

export const CHAT_TOOLS: ToolDefinition[] = [
  {
    name: "list_accounts",
    description: "List accounts with current balances and currencies.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "list_categories",
    description: "List expense and income categories with usage counts.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "list_operations",
    description: "List operations of the selected month. Use ids for edit and delete.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "list_recurring",
    description: "List recurring payments and whether they are already posted this month.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "add_expense",
    description:
      "Write an expense to the selected month. Only call after the account and category are known.",
    parameters: {
      type: "object",
      required: ["amount", "account", "category"],
      properties: {
        amount: AMOUNT,
        account: ACCOUNT,
        category: CATEGORY,
        title: { type: "string", description: "Short purchase title, e.g. телевизор" },
        description: { type: "string", description: "Optional note after ::" },
        date: { type: "string", description: "Optional date YYYY-MM-DD inside the selected month" },
      },
    },
  },
  {
    name: "add_income",
    description: "Write an income to the selected month.",
    parameters: {
      type: "object",
      required: ["amount", "account", "category"],
      properties: {
        amount: AMOUNT,
        account: ACCOUNT,
        category: CATEGORY,
        title: { type: "string", description: "Short income title" },
        description: { type: "string", description: "Optional note after ::" },
        date: { type: "string", description: "Optional date YYYY-MM-DD inside the selected month" },
      },
    },
  },
  {
    name: "add_transfer",
    description:
      "Move money between two accounts. For different currencies also pass toAmount; the second amount is credited to the target account.",
    parameters: {
      type: "object",
      required: ["from", "to", "amount"],
      properties: {
        from: { type: "string", description: "Source account name" },
        to: { type: "string", description: "Target account name" },
        amount: AMOUNT,
        toAmount: { type: "string", description: "Amount credited to target, only for different currencies" },
        description: { type: "string", description: "Optional note after ::" },
        date: { type: "string", description: "Optional date YYYY-MM-DD inside the selected month" },
      },
    },
  },
  {
    name: "edit_operation",
    description:
      "Edit an expense or income by id. Omitted fields stay unchanged. Use list_operations to get ids.",
    parameters: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Operation id, e.g. t7" },
        amount: AMOUNT,
        account: ACCOUNT,
        category: CATEGORY,
        title: { type: "string", description: "New title; empty string removes it" },
        description: { type: "string", description: "New description; empty string removes it" },
      },
    },
  },
  {
    name: "edit_transfer",
    description: "Edit a transfer or exchange by id. Omitted fields stay unchanged.",
    parameters: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Transfer id, e.g. t5" },
        from: { type: "string", description: "Source account name" },
        to: { type: "string", description: "Target account name" },
        amount: AMOUNT,
        toAmount: { type: "string", description: "Credited amount for an exchange" },
        description: { type: "string", description: "New description; empty string removes it" },
      },
    },
  },
  {
    name: "delete_operation",
    description: "Delete an expense, income, transfer or exchange by id.",
    parameters: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string", description: "Operation id" } },
    },
  },
  {
    name: "create_category",
    description: "Create an expense or income category. Check list_categories first.",
    parameters: {
      type: "object",
      required: ["name", "kind"],
      properties: {
        name: { type: "string", description: "Category name" },
        kind: { type: "string", enum: ["expense", "income"], description: "Category kind" },
      },
    },
  },
  {
    name: "rename_category",
    description: "Rename a category. References in operations and recurring payments are updated.",
    parameters: {
      type: "object",
      required: ["name", "newName"],
      properties: {
        name: { type: "string", description: "Current category name" },
        newName: { type: "string", description: "New category name" },
      },
    },
  },
  {
    name: "delete_category",
    description:
      "Delete a category. If operations or recurring payments use it, pass replacement with a category of the same kind.",
    parameters: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", description: "Category to delete" },
        replacement: { type: "string", description: "Category that receives existing operations" },
      },
    },
  },
  {
    name: "create_recurring",
    description: "Create a monthly recurring payment.",
    parameters: {
      type: "object",
      required: ["name", "account", "category", "amount", "day"],
      properties: {
        name: { type: "string", description: "Recurring name, e.g. Аренда" },
        account: ACCOUNT,
        category: CATEGORY,
        amount: AMOUNT,
        day: { type: "integer", minimum: 1, maximum: 31, description: "Day of month" },
      },
    },
  },
  {
    name: "delete_recurring",
    description: "Delete a recurring payment by id. Already posted operations stay.",
    parameters: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string", description: "Recurring id, e.g. r1" } },
    },
  },
  {
    name: "post_recurring",
    description: "Post a recurring payment as a normal operation in the selected month.",
    parameters: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string", description: "Recurring id" } },
    },
  },
  {
    name: "list_debts",
    description:
      "List debts with principal, agreed amount, paid, forgiven, remaining and status. Use ids for debt tools.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "list_plans",
    description: "List spending plans with amounts, due dates, priorities and completion.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "add_debt",
    description:
      "Record a debt and move the principal through an account. direction=to when money came to the account (I owe); direction=from when money left the account (the person owes me).",
    parameters: {
      type: "object",
      required: ["person", "amount", "account", "direction"],
      properties: {
        person: { type: "string", description: "Person name, e.g. Андрей" },
        amount: AMOUNT,
        account: ACCOUNT,
        direction: { type: "string", enum: ["to", "from"], description: "Cash direction of the principal" },
        date: { type: "string", description: "Optional date YYYY-MM-DD; today by default" },
        description: { type: "string", description: "Optional note after ::" },
      },
    },
  },
  {
    name: "edit_debt",
    description:
      "Correct an existing debt's original record: person, principal amount, account, cash direction, date or description. Omitted fields stay unchanged; empty description clears it. Recalculates balances and preserves history. Changing direction also reverses repayments. Currency can change via account only before any history exists. For a new agreement about how much to return use change_debt instead.",
    parameters: {
      type: "object",
      required: ["id"],
      properties: {
        id: DEBT_ID,
        person: { type: "string", description: "Correct person name" },
        amount: AMOUNT,
        account: ACCOUNT,
        direction: { type: "string", enum: ["to", "from"], description: "to = I owe; from = the person owes me" },
        date: { type: "string", description: "Correct opening date YYYY-MM-DD, no later than debt history" },
        description: { type: "string", description: "Correct description; empty string removes it" },
      },
    },
  },
  {
    name: "pay_debt",
    description:
      "Record a repayment or a return on an existing debt. The account is optional: the debt account is used by default.",
    parameters: {
      type: "object",
      required: ["id", "amount"],
      properties: {
        id: DEBT_ID,
        amount: AMOUNT,
        account: { type: "string", description: "Optional account name; must match the debt currency" },
        date: { type: "string", description: "Optional date YYYY-MM-DD; today by default" },
        description: { type: "string", description: "Optional note after ::" },
      },
    },
  },
  {
    name: "change_debt",
    description:
      "Change the agreed amount to return on a debt, keeping the original principal and history. Use this instead of creating a new debt.",
    parameters: {
      type: "object",
      required: ["id", "amount"],
      properties: {
        id: DEBT_ID,
        amount: AMOUNT,
        date: { type: "string", description: "Optional date YYYY-MM-DD; today by default" },
        description: { type: "string", description: "Why the amount changed" },
      },
    },
  },
  {
    name: "forgive_debt",
    description: "Close the rest of a debt without moving money. Only on an explicit request.",
    parameters: {
      type: "object",
      required: ["id"],
      properties: {
        id: DEBT_ID,
        date: { type: "string", description: "Optional date YYYY-MM-DD; today by default" },
        description: { type: "string", description: "Optional note after ::" },
      },
    },
  },
  {
    name: "delete_debt",
    description:
      "Delete a debt and its whole history, including the effect on balances. Ask the human to confirm first.",
    parameters: {
      type: "object",
      required: ["id"],
      properties: { id: DEBT_ID },
    },
  },
  {
    name: "add_plan",
    description: "Add a spending plan. Plans do not move money.",
    parameters: {
      type: "object",
      required: ["title", "amount", "currency"],
      properties: {
        title: { type: "string", description: "What to buy, e.g. Телевизор" },
        amount: AMOUNT,
        currency: { type: "string", description: "Currency code, e.g. BYN" },
        due: { type: "string", description: "Optional deadline YYYY-MM-DD" },
        priority: { type: "string", description: "Optional priority: 1 important, 2 normal, 3 someday" },
        description: { type: "string", description: "Optional note after ::" },
      },
    },
  },
  {
    name: "complete_plan",
    description: "Mark a spending plan as done. Does not create an expense.",
    parameters: {
      type: "object",
      required: ["id"],
      properties: {
        id: PLAN_ID,
        date: { type: "string", description: "Optional completion date YYYY-MM-DD; today by default" },
      },
    },
  },
  {
    name: "delete_plan",
    description: "Delete a spending plan and its completion mark.",
    parameters: {
      type: "object",
      required: ["id"],
      properties: { id: PLAN_ID },
    },
  },
];

const LABELS: Record<string, string> = {
  list_accounts: "смотрю счета",
  list_categories: "смотрю категории",
  list_operations: "смотрю операции",
  list_recurring: "смотрю повторы",
  add_expense: "записываю расход",
  add_income: "записываю доход",
  add_transfer: "делаю перевод",
  edit_operation: "правлю операцию",
  edit_transfer: "правлю перевод",
  delete_operation: "удаляю операцию",
  create_category: "создаю категорию",
  rename_category: "переименовываю категорию",
  delete_category: "удаляю категорию",
  create_recurring: "создаю повтор",
  delete_recurring: "удаляю повтор",
  post_recurring: "провожу повтор",
  list_debts: "смотрю долги",
  list_plans: "смотрю планы",
  add_debt: "записываю долг",
  edit_debt: "правлю долг",
  pay_debt: "записываю возврат",
  change_debt: "меняю сумму долга",
  forgive_debt: "прощаю долг",
  delete_debt: "удаляю долг",
  add_plan: "добавляю план",
  complete_plan: "отмечаю план",
  delete_plan: "удаляю план",
};

export function toolLabel(name: string): string {
  return LABELS[name] ?? name;
}

export async function executeTool(
  name: string,
  rawArguments: Record<string, unknown>,
  ctx: ActionContext,
): Promise<string> {
  try {
    switch (name) {
      case "list_accounts":
        return readResult(await listAccounts(ctx), (items) =>
          items.map((item) => ({
            name: item.name,
            type: item.type,
            currency: item.currency,
            balance: item.balance,
            opening: item.opening,
          })),
        );
      case "list_categories":
        return readResult(await listCategories(ctx), (items) =>
          items.map((item) => ({
            name: item.name,
            kind: item.kind,
            operations_this_month: item.operations,
            recurring: item.recurring,
          })),
        );
      case "list_operations":
        return readResult(await listOperations(ctx), (items) =>
          items.map((item) => ({
            ...item,
            amount: item.amount,
            title: item.title,
            description: item.description,
          })),
        );
      case "list_recurring":
        return readResult(await listRecurring(ctx), (items) => items);

      case "add_expense": {
        const input = movementArgs(rawArguments);
        if (typeof input === "string") {
          return input;
        }
        return writeResult(await addExpense(ctx, input));
      }
      case "add_income": {
        const input = movementArgs(rawArguments);
        if (typeof input === "string") {
          return input;
        }
        return writeResult(await addIncome(ctx, input));
      }
      case "add_transfer": {
        const from = stringArg(rawArguments.from);
        const to = stringArg(rawArguments.to);
        const amount = stringArg(rawArguments.amount);
        if (!from || !to || !amount) {
          return "Ошибка: нужны from, to и amount";
        }
        return writeResult(
          await addTransfer(ctx, {
            from,
            to,
            amount,
            toAmount: optionalString(rawArguments.toAmount),
            description: optionalString(rawArguments.description),
            date: optionalDate(rawArguments.date),
          }),
        );
      }
      case "edit_operation": {
        const id = stringArg(rawArguments.id);
        if (!id) {
          return "Ошибка: нужен id операции";
        }
        const hasChange = ["amount", "account", "category", "title", "description"].some(
          (key) => rawArguments[key] !== undefined,
        );
        if (!hasChange) {
          return "Ошибка: не передано ни одного нового поля";
        }
        return writeResult(
          await editOperation(ctx, {
            id,
            amount: optionalString(rawArguments.amount),
            account: optionalString(rawArguments.account),
            category: optionalString(rawArguments.category),
            title: optionalString(rawArguments.title),
            description: optionalString(rawArguments.description),
          }),
        );
      }
      case "edit_transfer": {
        const id = stringArg(rawArguments.id);
        if (!id) {
          return "Ошибка: нужен id перевода";
        }
        return writeResult(
          await editTransfer(ctx, {
            id,
            from: optionalString(rawArguments.from),
            to: optionalString(rawArguments.to),
            amount: optionalString(rawArguments.amount),
            toAmount: optionalString(rawArguments.toAmount),
            description: optionalString(rawArguments.description),
          }),
        );
      }
      case "delete_operation": {
        const id = stringArg(rawArguments.id);
        if (!id) {
          return "Ошибка: нужен id операции";
        }
        return writeResult(await deleteOperation(ctx, { id }));
      }
      case "create_category": {
        const name = stringArg(rawArguments.name);
        const kind = stringArg(rawArguments.kind);
        if (!name || !kind) {
          return "Ошибка: нужны name и kind";
        }
        return writeResult(await createCategory(ctx, { name, kind }));
      }
      case "rename_category": {
        const name = stringArg(rawArguments.name);
        const newName = stringArg(rawArguments.newName);
        if (!name || !newName) {
          return "Ошибка: нужны name и newName";
        }
        return writeResult(await renameCategory(ctx, { name, newName }));
      }
      case "delete_category": {
        const name = stringArg(rawArguments.name);
        if (!name) {
          return "Ошибка: нужен name категории";
        }
        return writeResult(
          await deleteCategory(ctx, {
            name,
            replacement: optionalString(rawArguments.replacement),
          }),
        );
      }
      case "create_recurring": {
        const name = stringArg(rawArguments.name);
        const account = stringArg(rawArguments.account);
        const category = stringArg(rawArguments.category);
        const amount = stringArg(rawArguments.amount);
        const day = dayArg(rawArguments.day);
        if (!name || !account || !category || !amount || !day) {
          return "Ошибка: нужны name, account, category, amount и day";
        }
        return writeResult(await createRecurring(ctx, { name, account, category, amount, day }));
      }
      case "delete_recurring": {
        const id = stringArg(rawArguments.id);
        if (!id) {
          return "Ошибка: нужен id повтора";
        }
        return writeResult(await deleteRecurring(ctx, { id }));
      }
      case "post_recurring": {
        const id = stringArg(rawArguments.id);
        if (!id) {
          return "Ошибка: нужен id повтора";
        }
        return writeResult(await postRecurringNow(ctx, { id }));
      }

      case "list_debts":
        return readResult(await listDebts(ctx), (items) => items);
      case "list_plans":
        return readResult(await listPlans(ctx), (items) => items);

      case "add_debt": {
        const person = stringArg(rawArguments.person);
        const amount = stringArg(rawArguments.amount);
        const account = stringArg(rawArguments.account);
        const direction = stringArg(rawArguments.direction);
        if (!person || !amount || !account) {
          return "Ошибка: нужны person, amount и account";
        }
        if (direction !== "to" && direction !== "from") {
          return "Ошибка: direction должен быть to или from";
        }
        return writeResult(
          await addDebt(ctx, {
            person,
            amount,
            account,
            direction,
            date: optionalDate(rawArguments.date),
            description: optionalString(rawArguments.description),
          }),
        );
      }
      case "edit_debt": {
        const id = stringArg(rawArguments.id);
        if (!id) {
          return "Ошибка: нужен id долга";
        }
        const fields = ["person", "amount", "account", "direction", "date", "description"] as const;
        const input: Parameters<typeof editDebt>[1] = { id };
        for (const key of fields) {
          if (rawArguments[key] !== undefined) {
            if (typeof rawArguments[key] !== "string") {
              return `Ошибка: ${key} должно быть строкой`;
            }
            input[key] = rawArguments[key];
          }
        }
        return writeResult(await editDebt(ctx, input));
      }
      case "pay_debt": {
        const id = stringArg(rawArguments.id);
        const amount = stringArg(rawArguments.amount);
        if (!id || !amount) {
          return "Ошибка: нужны id и amount";
        }
        return writeResult(
          await payDebt(ctx, {
            id,
            amount,
            account: optionalString(rawArguments.account),
            date: optionalDate(rawArguments.date),
            description: optionalString(rawArguments.description),
          }),
        );
      }
      case "change_debt": {
        const id = stringArg(rawArguments.id);
        const amount = stringArg(rawArguments.amount);
        if (!id || !amount) {
          return "Ошибка: нужны id и amount";
        }
        return writeResult(
          await changeDebt(ctx, {
            id,
            amount,
            date: optionalDate(rawArguments.date),
            description: optionalString(rawArguments.description),
          }),
        );
      }
      case "forgive_debt": {
        const id = stringArg(rawArguments.id);
        if (!id) {
          return "Ошибка: нужен id долга";
        }
        return writeResult(
          await forgiveDebt(ctx, {
            id,
            date: optionalDate(rawArguments.date),
            description: optionalString(rawArguments.description),
          }),
        );
      }
      case "delete_debt": {
        const id = stringArg(rawArguments.id);
        if (!id) {
          return "Ошибка: нужен id долга";
        }
        return writeResult(await deleteDebt(ctx, { id }));
      }
      case "add_plan": {
        const title = stringArg(rawArguments.title);
        const amount = stringArg(rawArguments.amount);
        const currency = stringArg(rawArguments.currency);
        if (!title || !amount || !currency) {
          return "Ошибка: нужны title, amount и currency";
        }
        return writeResult(
          await addPlan(ctx, {
            title,
            amount,
            currency,
            due: optionalDate(rawArguments.due),
            priority: optionalString(rawArguments.priority),
            description: optionalString(rawArguments.description),
          }),
        );
      }
      case "complete_plan": {
        const id = stringArg(rawArguments.id);
        if (!id) {
          return "Ошибка: нужен id плана";
        }
        return writeResult(
          await completePlan(ctx, { id, date: optionalDate(rawArguments.date) }),
        );
      }
      case "delete_plan": {
        const id = stringArg(rawArguments.id);
        if (!id) {
          return "Ошибка: нужен id плана";
        }
        return writeResult(await deletePlan(ctx, { id }));
      }
      default:
        return `Ошибка: неизвестная команда ${name}`;
    }
  } catch (error) {
    return `Ошибка: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function movementArgs(
  args: Record<string, unknown>,
):
  | {
      amount: string;
      account: string;
      category: string;
      title?: string;
      description?: string;
      date?: string;
    }
  | string {
  const amount = stringArg(args.amount);
  const account = stringArg(args.account);
  const category = stringArg(args.category);
  if (!amount || !account || !category) {
    return "Ошибка: нужны amount, account и category";
  }
  return {
    amount,
    account,
    category,
    title: optionalString(args.title),
    description: optionalString(args.description),
    date: optionalDate(args.date),
  };
}

function readResult<T>(
  result: ActionResult<T>,
  format: (data: T) => unknown,
): string {
  if (!result.ok) {
    return `Ошибка: ${result.error}`;
  }
  return `Данные: ${JSON.stringify(format(result.data))}`;
}

function writeResult<T>(result: ActionResult<T>): string {
  if (!result.ok) {
    return `Ошибка: ${result.error}`;
  }
  return `${result.message}. ${JSON.stringify(result.data)}`;
}

function stringArg(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function optionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return String(value);
}

function optionalDate(value: unknown): string | undefined {
  const text = optionalString(value)?.trim();
  return text ? text : undefined;
}

function dayArg(value: unknown): string | null {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 31) {
    return null;
  }
  return String(number);
}
