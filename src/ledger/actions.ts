import { join } from "@tauri-apps/api/path";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { readDataFolder } from "../data-folder";
import { balances } from "../finance/balance";
import {
  categoryUsage,
  removeStatementLine,
  replaceCategoryLine,
  rewriteCategoryReferences,
} from "../finance/category-edit";
import { categoryLine, normalizeCategory } from "../finance/category-file";
import {
  findStatementLine,
  replaceStatement,
  retireStatement,
  retiredIds,
} from "../finance/edit-line";
import {
  defaultDate,
  movementLine,
  prepareEdit,
  prepareMovement,
  todayDate,
  type NewMovement,
} from "../finance/entry-file";
import { appendStatement } from "../finance/fence";
import { interpretFiles, type LoadedFile } from "../finance/load";
import {
  parseFinance,
  type AccountStatement,
  type CategoryStatement,
  type ExchangeStatement,
  type ExpenseStatement,
  type IncomeStatement,
  type Statement,
  type TransferStatement,
} from "../finance/parse";
import {
  alreadyPosted,
  findRecurringLine,
  postRecurring,
  prepareRecurring,
  recurringLine,
  type NewRecurring,
} from "../finance/recurring-file";
import { prepareTransfer, transferLine, type NewTransfer } from "../finance/transfer-file";
import {
  buildDebts,
  debtAgreedLine,
  debtForgiveLine,
  debtLine,
  debtPaymentLine,
  prepareAgreed,
  prepareDebt,
  preparePayment,
  settleDirection,
  type Debt,
} from "../finance/debt";
import {
  buildPlans,
  planDoneLine,
  planLine,
  preparePlan,
  type Plan,
} from "../finance/plans";

const DEBTS_TEMPLATE = "# Долги\n\n```finance\n```\n";
const PLANS_TEMPLATE = "# Планы\n\n```finance\n```\n";

export type ActionContext = {
  dir: string;
  month: string;
};

export type ActionResult<T = unknown> =
  | { ok: true; message: string; data: T }
  | { ok: false; error: string };

export type AccountView = {
  name: string;
  type: "cash" | "bank";
  currency: string;
  opening: string;
  balance: string;
};

export type CategoryView = {
  name: string;
  kind: "expense" | "income";
  operations: number;
  recurring: number;
};

export type OperationView = {
  id?: string;
  kind: "expense" | "income" | "transfer" | "exchange";
  date: string;
  amount: string;
  currency: string;
  account?: string;
  from?: string;
  to?: string;
  category?: string;
  title?: string;
  description?: string;
  toAmount?: string;
  toCurrency?: string;
};

export type RecurringView = {
  id?: string;
  name: string;
  account: string;
  category: string;
  amount: string;
  currency: string;
  day: number;
  posted: boolean;
};

export type DebtView = {
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
};

export type PlanView = {
  id: string;
  title: string;
  amount: string;
  currency: string;
  due?: string;
  priority?: number;
  done?: string;
  description?: string;
};

type State = {
  files: LoadedFile[];
  statements: Statement[];
  accounts: AccountStatement[];
  categories: CategoryStatement[];
};

/** Все счета с текущими остатками. */
export async function listAccounts(ctx: ActionContext): Promise<ActionResult<AccountView[]>> {
  const state = await readState(ctx.dir);
  const balance = balances(state.statements);
  const types = new Map<string, AccountStatement>();
  for (const statement of state.statements) {
    if (statement.kind === "account" && !types.has(statement.name)) {
      types.set(statement.name, statement);
    }
  }
  const data = balance.map((item) => {
    const account = types.get(item.name);
    return {
      name: item.name,
      type: account?.accountType ?? "cash",
      currency: item.currency,
      opening: account?.opening ?? "0.00",
      balance: item.amount,
    };
  });
  return { ok: true, message: "Счета прочитаны", data };
}

/** Категории с числом операций текущего месяца. */
export async function listCategories(ctx: ActionContext): Promise<ActionResult<CategoryView[]>> {
  const state = await readState(ctx.dir);
  const monthStatements = monthStatementsOf(state.files, ctx.month);
  const data = firstCategories(state.statements).map((category) => {
    const monthUsage = categoryUsage(monthStatements, category.name);
    const allUsage = categoryUsage(state.statements, category.name);
    return {
      name: category.name,
      kind: category.categoryKind,
      operations: monthUsage.operations,
      recurring: allUsage.recurring,
    };
  });
  return { ok: true, message: "Категории прочитаны", data };
}

/** Операции выбранного месяца. */
export async function listOperations(
  ctx: ActionContext,
): Promise<ActionResult<OperationView[]>> {
  const state = await readState(ctx.dir);
  const data = monthStatementsOf(state.files, ctx.month)
    .filter(isOperation)
    .map(operationView);
  return { ok: true, message: "Операции прочитаны", data };
}

/** Повторы и признак, проведены ли они в выбранном месяце. */
export async function listRecurring(
  ctx: ActionContext,
): Promise<ActionResult<RecurringView[]>> {
  const state = await readState(ctx.dir);
  const monthStatements = monthStatementsOf(state.files, ctx.month);
  const data = state.statements
    .flatMap((statement) => (statement.kind === "recurring" ? [statement] : []))
    .map((recurring) => ({
      id: recurring.id,
      name: recurring.name,
      account: recurring.account,
      category: recurring.category,
      amount: recurring.amount,
      currency: recurring.currency,
      day: recurring.day,
      posted: alreadyPosted(monthStatements, recurring),
    }));
  return { ok: true, message: "Повторы прочитаны", data };
}

/** Все долги: открытые и закрытые. */
export async function listDebts(ctx: ActionContext): Promise<ActionResult<DebtView[]>> {
  const state = await readState(ctx.dir);
  const data = buildDebts(state.statements).map(debtView);
  return { ok: true, message: "Долги прочитаны", data };
}

/** Планы трат: открытые и выполненные. */
export async function listPlans(ctx: ActionContext): Promise<ActionResult<PlanView[]>> {
  const state = await readState(ctx.dir);
  const data = buildPlans(state.statements).map(planView);
  return { ok: true, message: "Планы прочитаны", data };
}

export async function addDebt(
  ctx: ActionContext,
  input: {
    person: string;
    amount: string;
    account: string;
    direction: string;
    date?: string;
    description?: string;
  },
): Promise<ActionResult<DebtView>> {
  const state = await readState(ctx.dir);
  const account = state.accounts.find((item) => item.name === input.account);
  if (!account) {
    return { ok: false, error: `Счёт «${input.account}» не найден` };
  }
  const debts = buildDebts(state.statements);
  const debt = prepareDebt({
    person: input.person,
    amount: input.amount,
    currency: account.currency,
    direction: input.direction,
    account: account.name,
    date: input.date ?? todayDate(),
    description: input.description ?? "",
    ids: [
      ...debts.map((item) => item.id),
      ...retiredIds(rootSource(state, "debts.md")),
    ],
  });
  if (typeof debt === "string") {
    return { ok: false, error: debt };
  }
  await appendToRoot(ctx.dir, "debts.md", debtLine(debt), state.files, DEBTS_TEMPLATE);
  return {
    ok: true,
    message:
      debt.direction === "to"
        ? `Долг перед «${debt.person}» записан`
        : `Долг «${debt.person}» записан`,
    data: {
      id: debt.id,
      person: debt.person,
      direction: debt.direction === "to" ? "owe" : "owed",
      currency: debt.currency,
      principal: debt.amount,
      agreed: debt.amount,
      paid: "0.00",
      forgiven: "0.00",
      remaining: debt.amount,
      status: "open",
      account: debt.account,
      opened: debt.date,
      ...(debt.description ? { description: debt.description } : {}),
    },
  };
}

/** Исправление исходной записи, а не новая договорённость о возврате. */
export async function editDebt(
  ctx: ActionContext,
  input: {
    id: string;
    person?: string;
    amount?: string;
    account?: string;
    direction?: string;
    date?: string;
    description?: string;
  },
): Promise<ActionResult<DebtView>> {
  const fields = ["person", "amount", "account", "direction", "date", "description"] as const;
  if (!fields.some((key) => input[key] !== undefined)) {
    return { ok: false, error: "Не передано ни одного нового поля" };
  }
  const state = await readState(ctx.dir);
  const target = interpretFiles(state.files).statements.find(
    (item) => item.statement.kind === "debt" && item.statement.id === input.id,
  );
  if (!target || target.statement.kind !== "debt") {
    return { ok: false, error: `Долг ${input.id} не найден` };
  }
  const original = target.statement;
  const account = state.accounts.find((item) => item.name === (input.account ?? original.account));
  if (!account) {
    return { ok: false, error: `Счёт «${input.account ?? original.account}» не найден` };
  }
  const history = state.statements.filter(
    (item) => (item.kind === "debt-pay" || item.kind === "debt-agreed" || item.kind === "debt-forgive") && item.debt === input.id,
  );
  if (account.currency !== original.currency && history.length > 0) {
    return { ok: false, error: "Нельзя менять валюту долга с историей возвратов или договорённостей" };
  }
  const prepared = prepareDebt({
    person: input.person ?? original.person,
    amount: input.amount ?? original.amount,
    currency: account.currency,
    account: account.name,
    direction: input.direction ?? original.direction,
    date: input.date ?? original.date,
    description: input.description ?? original.description ?? "",
    ids: [],
  });
  if (typeof prepared === "string") {
    return { ok: false, error: prepared };
  }
  prepared.id = input.id;
  if (history.some((item) => "date" in item && item.date < prepared.date)) {
    return { ok: false, error: "Дата долга не может быть позже событий в его истории" };
  }
  const source = state.files.find((item) => item.file === target.file)!.source;
  const next = replaceStatement(source, original.line, debtLine(prepared));
  if (next === null) {
    return { ok: false, error: "Строка долга не найдена" };
  }
  const nextSources = new Map([[target.file, next]]);
  // При исправлении направления долга возвраты тоже меняют направление.
  if (prepared.direction !== original.direction) {
    for (const file of state.files) {
      let rewritten = nextSources.get(file.file) ?? file.source;
      for (const statement of parseFinance(file.source).statements) {
        if (statement.kind === "debt-pay" && statement.debt === input.id) {
          rewritten = replaceStatement(rewritten, statement.line, debtPaymentLine({
            ...statement,
            direction: prepared.direction === "to" ? "from" : "to",
          }))!;
        }
      }
      if (rewritten !== file.source) {
        nextSources.set(file.file, rewritten);
      }
    }
  }
  const error = newParseError(state.files, nextSources);
  if (error) {
    return { ok: false, error };
  }
  const nextFiles = state.files.map((file) => ({ ...file, source: nextSources.get(file.file) ?? file.source }));
  const debt = buildDebts(interpretFiles(nextFiles).statements.map((item) => item.statement))
    .find((item) => item.id === input.id)!;
  await writeFilesSafely(ctx.dir, state.files, nextSources);
  return { ok: true, message: "Долг изменён; остатки на счетах пересчитаны", data: debtView(debt) };
}

export async function payDebt(
  ctx: ActionContext,
  input: {
    id: string;
    amount: string;
    account?: string;
    date?: string;
    description?: string;
  },
): Promise<ActionResult<{ id: string; amount: string; account: string }>> {
  const state = await readState(ctx.dir);
  const debt = findOpenDebt(state.statements, input.id);
  if (typeof debt === "string") {
    return { ok: false, error: debt };
  }
  const account = state.accounts.find(
    (item) => item.name === (input.account ?? debt.account),
  );
  if (!account) {
    return { ok: false, error: `Счёт «${input.account ?? debt.account}» не найден` };
  }
  if (account.currency !== debt.currency) {
    return { ok: false, error: `Долг в ${debt.currency}, а счёт в ${account.currency}` };
  }
  const prepared = preparePayment(debt, {
    amount: input.amount,
    date: input.date ?? todayDate(),
    account,
    description: input.description ?? "",
  });
  if (typeof prepared === "string") {
    return { ok: false, error: prepared };
  }
  await appendToRoot(
    ctx.dir,
    "debts.md",
    debtPaymentLine({
      debt: debt.id,
      date: prepared.date,
      amount: prepared.amount,
      currency: debt.currency,
      direction: settleDirection(debt),
      account: prepared.account,
      ...(prepared.description ? { description: prepared.description } : {}),
    }),
    state.files,
    DEBTS_TEMPLATE,
  );
  return {
    ok: true,
    message: debt.direction === "owe" ? "Возврат записан" : "Получение записано",
    data: { id: debt.id, amount: prepared.amount, account: prepared.account },
  };
}

export async function changeDebt(
  ctx: ActionContext,
  input: { id: string; amount: string; date?: string; description?: string },
): Promise<ActionResult<{ id: string; agreed: string }>> {
  const state = await readState(ctx.dir);
  const debt = findOpenDebt(state.statements, input.id);
  if (typeof debt === "string") {
    return { ok: false, error: debt };
  }
  const prepared = prepareAgreed(debt, {
    amount: input.amount,
    date: input.date ?? todayDate(),
    description: input.description ?? "",
  });
  if (typeof prepared === "string") {
    return { ok: false, error: prepared };
  }
  await appendToRoot(
    ctx.dir,
    "debts.md",
    debtAgreedLine({
      debt: debt.id,
      date: prepared.date,
      amount: prepared.amount,
      ...(prepared.description ? { description: prepared.description } : {}),
    }),
    state.files,
    DEBTS_TEMPLATE,
  );
  return {
    ok: true,
    message: `Сумма долга изменена на ${prepared.amount} ${debt.currency}`,
    data: { id: debt.id, agreed: prepared.amount },
  };
}

export async function forgiveDebt(
  ctx: ActionContext,
  input: { id: string; date?: string; description?: string },
): Promise<ActionResult<{ id: string }>> {
  const state = await readState(ctx.dir);
  const debt = findOpenDebt(state.statements, input.id);
  if (typeof debt === "string") {
    return { ok: false, error: debt };
  }
  await appendToRoot(
    ctx.dir,
    "debts.md",
    debtForgiveLine({
      debt: debt.id,
      date: input.date ?? todayDate(),
      ...(input.description ? { description: input.description } : {}),
    }),
    state.files,
    DEBTS_TEMPLATE,
  );
  return { ok: true, message: `Долг с «${debt.person}» закрыт`, data: { id: debt.id } };
}

export async function deleteDebt(
  ctx: ActionContext,
  input: { id: string },
): Promise<ActionResult<{ id: string }>> {
  const state = await readState(ctx.dir);
  const debt = buildDebts(state.statements).find((item) => item.id === input.id);
  if (!debt) {
    return { ok: false, error: `Долг ${input.id} не найден` };
  }
  const source = rootSource(state, "debts.md");
  const drop = new Set<number>();
  for (const statement of parseFinance(source).statements) {
    if (statement.kind === "debt" && statement.id === input.id) {
      drop.add(statement.line - 1);
    }
    if (
      (statement.kind === "debt-pay" ||
        statement.kind === "debt-agreed" ||
        statement.kind === "debt-forgive") &&
      statement.debt === input.id
    ) {
      drop.add(statement.line - 1);
    }
  }
  if (drop.size === 0) {
    return { ok: false, error: "Строки долга не найдены в debts.md" };
  }
  const next = source
    .split(/\r?\n/)
    .filter((_, index) => !drop.has(index))
    .join(source.includes("\r\n") ? "\r\n" : "\n");
  await writeTextFile(await join(ctx.dir, "debts.md"), next);
  return { ok: true, message: `Долг с «${debt.person}» удалён`, data: { id: debt.id } };
}

export async function addPlan(
  ctx: ActionContext,
  input: {
    title: string;
    amount: string;
    currency: string;
    due?: string;
    priority?: string;
    description?: string;
  },
): Promise<ActionResult<PlanView>> {
  const state = await readState(ctx.dir);
  const plan = preparePlan({
    title: input.title,
    amount: input.amount,
    currency: input.currency,
    due: input.due ?? "",
    priority: input.priority ?? "",
    description: input.description ?? "",
    ids: [
      ...buildPlans(state.statements).map((item) => item.id),
      ...retiredIds(rootSource(state, "plans.md")),
    ],
  });
  if (typeof plan === "string") {
    return { ok: false, error: plan };
  }
  await appendToRoot(ctx.dir, "plans.md", planLine(plan), state.files, PLANS_TEMPLATE);
  return {
    ok: true,
    message: `План «${plan.title}» добавлен`,
    data: {
      id: plan.id,
      title: plan.title,
      amount: plan.amount,
      currency: plan.currency,
      ...(plan.due ? { due: plan.due } : {}),
      ...(plan.priority !== undefined ? { priority: plan.priority } : {}),
      ...(plan.description ? { description: plan.description } : {}),
    },
  };
}

export async function completePlan(
  ctx: ActionContext,
  input: { id: string; date?: string },
): Promise<ActionResult<{ id: string; date: string }>> {
  const state = await readState(ctx.dir);
  const plan = buildPlans(state.statements).find((item) => item.id === input.id);
  if (!plan) {
    return { ok: false, error: `План ${input.id} не найден` };
  }
  if (plan.done !== undefined) {
    return { ok: false, error: `План «${plan.title}» уже выполнен` };
  }
  const date = input.date ?? todayDate();
  await appendToRoot(
    ctx.dir,
    "plans.md",
    planDoneLine(plan.id, date),
    state.files,
    PLANS_TEMPLATE,
  );
  return { ok: true, message: `План «${plan.title}» отмечен выполненным`, data: { id: plan.id, date } };
}

export async function deletePlan(
  ctx: ActionContext,
  input: { id: string },
): Promise<ActionResult<{ id: string }>> {
  const state = await readState(ctx.dir);
  const plan = buildPlans(state.statements).find((item) => item.id === input.id);
  if (!plan) {
    return { ok: false, error: `План ${input.id} не найден` };
  }
  const source = rootSource(state, "plans.md");
  const drop = new Set<number>();
  for (const statement of parseFinance(source).statements) {
    if (statement.kind === "plan" && statement.id === input.id) {
      drop.add(statement.line - 1);
    }
    if (statement.kind === "plan-done" && statement.plan === input.id) {
      drop.add(statement.line - 1);
    }
  }
  if (drop.size === 0) {
    return { ok: false, error: "Строки плана не найдены в plans.md" };
  }
  const next = source
    .split(/\r?\n/)
    .filter((_, index) => !drop.has(index))
    .join(source.includes("\r\n") ? "\r\n" : "\n");
  await writeTextFile(await join(ctx.dir, "plans.md"), next);
  return { ok: true, message: `План «${plan.title}» удалён`, data: { id: plan.id } };
}

function debtView(debt: Debt): DebtView {
  return {
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
    ...(debt.description ? { description: debt.description } : {}),
  };
}

function planView(plan: Plan): PlanView {
  return {
    id: plan.id,
    title: plan.title,
    amount: plan.amount,
    currency: plan.currency,
    ...(plan.due ? { due: plan.due } : {}),
    ...(plan.priority !== undefined ? { priority: plan.priority } : {}),
    ...(plan.done ? { done: plan.done } : {}),
    ...(plan.description ? { description: plan.description } : {}),
  };
}

function findOpenDebt(statements: Statement[], id: string): Debt | string {
  const debt = buildDebts(statements).find((item) => item.id === id);
  if (!debt) {
    return `Долг ${id} не найден`;
  }
  if (debt.status === "closed") {
    return `Долг с «${debt.person}» уже закрыт`;
  }
  return debt;
}

function rootSource(state: State, name: string): string {
  return state.files.find((item) => item.file === name)?.source ?? "```finance\n```\n";
}

async function appendToRoot(
  dir: string,
  name: string,
  line: string,
  files: LoadedFile[],
  fallback: string,
): Promise<void> {
  const source = files.find((item) => item.file === name)?.source ?? fallback;
  await writeTextFile(await join(dir, name), appendStatement(source, line));
}

export async function addExpense(
  ctx: ActionContext,
  input: MovementInput,
): Promise<ActionResult<NewMovement>> {
  return addMovement(ctx, "expense", input);
}

export async function addIncome(
  ctx: ActionContext,
  input: MovementInput,
): Promise<ActionResult<NewMovement>> {
  return addMovement(ctx, "income", input);
}

export type MovementInput = {
  amount: string;
  account: string;
  category: string;
  title?: string;
  description?: string;
  date?: string;
};

async function addMovement(
  ctx: ActionContext,
  kind: "expense" | "income",
  input: MovementInput,
): Promise<ActionResult<NewMovement>> {
  const state = await readState(ctx.dir);
  const movement = prepareMovement({
    kind,
    date: input.date ?? defaultDate(ctx.month),
    amount: input.amount,
    account: input.account,
    category: input.category,
    title: input.title ?? "",
    description: input.description ?? "",
    month: ctx.month,
    accounts: state.accounts,
    categories: state.categories,
    ids: usedIds(state.statements, state.files),
  });
  if (typeof movement === "string") {
    return { ok: false, error: movement };
  }
  await appendToMonth(ctx.dir, ctx.month, state.files, movementLine(movement));
  return {
    ok: true,
    message: `${kind === "expense" ? "Расход" : "Доход"} записан`,
    data: movement,
  };
}

export async function addTransfer(
  ctx: ActionContext,
  input: {
    from: string;
    to: string;
    amount: string;
    toAmount?: string;
    description?: string;
    date?: string;
  },
): Promise<ActionResult<NewTransfer>> {
  const state = await readState(ctx.dir);
  const transfer = prepareTransfer({
    date: input.date ?? defaultDate(ctx.month),
    amount: input.amount,
    toAmount: input.toAmount ?? "",
    from: input.from,
    to: input.to,
    description: input.description ?? "",
    month: ctx.month,
    accounts: state.accounts,
    ids: usedIds(state.statements, state.files),
  });
  if (typeof transfer === "string") {
    return { ok: false, error: transfer };
  }
  await appendToMonth(ctx.dir, ctx.month, state.files, transferLine(transfer));
  return {
    ok: true,
    message: transfer.kind === "exchange" ? "Обмен записан" : "Перевод записан",
    data: transfer,
  };
}

export async function editOperation(
  ctx: ActionContext,
  input: {
    id: string;
    amount?: string;
    account?: string;
    category?: string;
    title?: string;
    description?: string;
  },
): Promise<ActionResult<NewMovement>> {
  const state = await readState(ctx.dir);
  const source = monthSource(state.files, ctx.month);
  if (source === null) {
    return { ok: false, error: "В этом месяце ещё нет операций" };
  }
  const statement = monthStatementsOf(state.files, ctx.month).find(
    (item) =>
      (item.kind === "expense" || item.kind === "income") && item.id === input.id,
  );
  if (!statement || (statement.kind !== "expense" && statement.kind !== "income")) {
    return {
      ok: false,
      error: `Операция ${input.id} не найдена среди расходов и доходов этого месяца`,
    };
  }
  const movement = prepareEdit({
    kind: statement.kind,
    id: statement.id,
    date: statement.date,
    month: ctx.month,
    amount: input.amount ?? statement.amount,
    account: input.account ?? statement.account,
    category: input.category ?? statement.category,
    title: input.title !== undefined ? input.title : (statement.title ?? ""),
    description:
      input.description !== undefined ? input.description : (statement.description ?? ""),
    accounts: state.accounts,
    categories: state.categories,
  });
  if (typeof movement === "string") {
    return { ok: false, error: movement };
  }
  const line = findStatementLine(source, ctx.month, {
    line: statement.line,
    id: statement.id,
    kind: statement.kind,
    date: statement.date,
  });
  if (line === null) {
    return { ok: false, error: "Строка операции не найдена. Файл изменился снаружи." };
  }
  const next = replaceStatement(source, line, movementLine(movement));
  if (next === null) {
    return { ok: false, error: "Строка операции не найдена" };
  }
  await writeTextFile(await monthPath(ctx.dir, ctx.month), next);
  return { ok: true, message: "Операция изменена", data: movement };
}

export async function editTransfer(
  ctx: ActionContext,
  input: {
    id: string;
    from?: string;
    to?: string;
    amount?: string;
    toAmount?: string;
    description?: string;
  },
): Promise<ActionResult<NewTransfer>> {
  const state = await readState(ctx.dir);
  const source = monthSource(state.files, ctx.month);
  if (source === null) {
    return { ok: false, error: "В этом месяце ещё нет операций" };
  }
  const statement = monthStatementsOf(state.files, ctx.month).find(
    (item) =>
      (item.kind === "transfer" || item.kind === "exchange") && item.id === input.id,
  );
  if (!statement || (statement.kind !== "transfer" && statement.kind !== "exchange")) {
    return { ok: false, error: `Перевод ${input.id} не найден` };
  }
  const transfer = prepareTransfer({
    date: statement.date,
    amount: input.amount ?? statement.amount,
    toAmount:
      input.toAmount ??
      (statement.kind === "exchange" ? statement.toAmount : ""),
    from: input.from ?? statement.from,
    to: input.to ?? statement.to,
    description:
      input.description !== undefined
        ? input.description
        : (statement.description ?? ""),
    month: ctx.month,
    accounts: state.accounts,
    ids: usedIds(state.statements, state.files),
  });
  if (typeof transfer === "string") {
    return { ok: false, error: transfer };
  }
  transfer.id = statement.id;
  const line = findStatementLine(source, ctx.month, {
    line: statement.line,
    id: statement.id,
    kind: statement.kind,
    date: statement.date,
  });
  if (line === null) {
    return { ok: false, error: "Строка перевода не найдена. Файл изменился снаружи." };
  }
  const next = replaceStatement(source, line, transferLine(transfer));
  if (next === null) {
    return { ok: false, error: "Строка перевода не найдена" };
  }
  await writeTextFile(await monthPath(ctx.dir, ctx.month), next);
  return { ok: true, message: "Перевод изменён", data: transfer };
}

export async function deleteOperation(
  ctx: ActionContext,
  input: { id: string },
): Promise<ActionResult<OperationView>> {
  const state = await readState(ctx.dir);
  const source = monthSource(state.files, ctx.month);
  if (source === null) {
    return { ok: false, error: "В этом месяце ещё нет операций" };
  }
  const statement = monthStatementsOf(state.files, ctx.month).find(
    (item) => isOperation(item) && item.id === input.id,
  );
  if (!statement || !isOperation(statement)) {
    return { ok: false, error: `Операция ${input.id} не найдена` };
  }
  const line = findStatementLine(source, ctx.month, {
    line: statement.line,
    id: statement.id,
    kind: statement.kind,
    date: statement.date,
  });
  if (line === null) {
    return { ok: false, error: "Строка операции не найдена. Файл изменился снаружи." };
  }
  const next = retireStatement(source, line, statement.id);
  if (next === null) {
    return { ok: false, error: "Строка операции не найдена" };
  }
  await writeTextFile(await monthPath(ctx.dir, ctx.month), next);
  return {
    ok: true,
    message: `Операция ${input.id} удалена (в файле останется пометка // deleted)`,
    data: operationView(statement),
  };
}

export async function createCategory(
  ctx: ActionContext,
  input: { name: string; kind: string },
): Promise<ActionResult<{ name: string; kind: string }>> {
  const category = normalizeCategory({ name: input.name, categoryKind: input.kind });
  if (typeof category === "string") {
    return { ok: false, error: category };
  }
  const state = await readState(ctx.dir);
  if (state.categories.some((item) => item.name === category.name)) {
    return { ok: false, error: `Категория «${category.name}» уже есть` };
  }
  const file = state.files.find((item) => item.file === "categories.md");
  if (!file) {
    return { ok: false, error: "Нет файла categories.md" };
  }
  await writeTextFile(
    await join(ctx.dir, "categories.md"),
    appendStatement(file.source, categoryLine(category)),
  );
  return {
    ok: true,
    message: `Категория «${category.name}» создана`,
    data: { name: category.name, kind: category.categoryKind },
  };
}

export async function renameCategory(
  ctx: ActionContext,
  input: { name: string; newName: string },
): Promise<ActionResult<{ name: string; newName: string }>> {
  const state = await readState(ctx.dir);
  const file = state.files.find((item) => item.file === "categories.md");
  if (!file) {
    return { ok: false, error: "Нет файла categories.md" };
  }
  const parsed = parseFinance(file.source);
  const current = parsed.statements.find(
    (item) => item.kind === "category" && item.name === input.name,
  );
  if (!current || current.kind !== "category") {
    return { ok: false, error: `Категория «${input.name}» не найдена` };
  }
  const next = normalizeCategory({
    name: input.newName,
    categoryKind: current.categoryKind,
  });
  if (typeof next === "string") {
    return { ok: false, error: next };
  }
  if (next.name === current.name) {
    return { ok: true, message: "Имя не изменилось", data: { name: input.name, newName: next.name } };
  }
  const names = parsed.statements.flatMap((item) =>
    item.kind === "category" ? [item.name] : [],
  );
  if (names.includes(next.name)) {
    return { ok: false, error: `Категория «${next.name}» уже есть` };
  }

  const nextSources = new Map<string, string>();
  const nextCategories = replaceCategoryLine(file.source, current.line, next);
  if (nextCategories === null) {
    return { ok: false, error: "Строка категории не найдена" };
  }
  nextSources.set("categories.md", nextCategories);
  for (const item of state.files) {
    if (item.file === "categories.md") {
      continue;
    }
    const rewritten = rewriteCategoryReferences(item.source, current.name, next.name);
    if (rewritten.changed) {
      nextSources.set(item.file, rewritten.source);
    }
  }
  const added = newParseError(state.files, nextSources);
  if (added) {
    return { ok: false, error: added };
  }
  await writeFilesSafely(ctx.dir, state.files, nextSources);
  return {
    ok: true,
    message: `Категория «${current.name}» переименована в «${next.name}»; ссылки в операциях и повторах обновлены`,
    data: { name: current.name, newName: next.name },
  };
}

export async function deleteCategory(
  ctx: ActionContext,
  input: { name: string; replacement?: string },
): Promise<ActionResult<{ name: string; replacement?: string }>> {
  const state = await readState(ctx.dir);
  const file = state.files.find((item) => item.file === "categories.md");
  if (!file) {
    return { ok: false, error: "Нет файла categories.md" };
  }
  const parsed = parseFinance(file.source);
  const current = parsed.statements.find(
    (item) => item.kind === "category" && item.name === input.name,
  );
  if (!current || current.kind !== "category") {
    return { ok: false, error: `Категория «${input.name}» не найдена` };
  }
  const usage = categoryUsage(state.statements, current.name);
  let replacement = "";
  if (usage.total > 0) {
    if (!input.replacement) {
      return {
        ok: false,
        error: `Категория «${current.name}» используется: ${usage.operations} операций и ${usage.recurring} повторов. Спросите, на какую категорию их перенести, и повторите вызов с replacement.`,
      };
    }
    const target = state.categories.find((item) => item.name === input.replacement);
    if (!target) {
      return { ok: false, error: `Категория-замена «${input.replacement}» не найдена` };
    }
    if (target.categoryKind !== current.categoryKind) {
      return {
        ok: false,
        error: `Категория-замена должна быть того же вида: ${current.categoryKind}`,
      };
    }
    if (target.name === current.name) {
      return { ok: false, error: "Категория-замена совпадает с удаляемой" };
    }
    replacement = target.name;
  }

  const nextSources = new Map<string, string>();
  const removed = removeStatementLine(file.source, current.line);
  if (removed === null) {
    return { ok: false, error: "Строка категории не найдена" };
  }
  nextSources.set("categories.md", removed);
  if (replacement) {
    for (const item of state.files) {
      if (item.file === "categories.md") {
        continue;
      }
      const rewritten = rewriteCategoryReferences(item.source, current.name, replacement);
      if (rewritten.changed) {
        nextSources.set(item.file, rewritten.source);
      }
    }
  }
  const added = newParseError(state.files, nextSources);
  if (added) {
    return { ok: false, error: added };
  }
  await writeFilesSafely(ctx.dir, state.files, nextSources);
  return {
    ok: true,
    message: replacement
      ? `Категория «${current.name}» удалена, её строки перенесены в «${replacement}»`
      : `Категория «${current.name}» удалена`,
    data: { name: current.name, replacement: replacement || undefined },
  };
}

export async function createRecurring(
  ctx: ActionContext,
  input: { name: string; account: string; category: string; amount: string; day: string },
): Promise<ActionResult<NewRecurring>> {
  const state = await readState(ctx.dir);
  const recurring = prepareRecurring({
    ...input,
    accounts: state.accounts,
    categories: state.categories,
    ids: usedIds(state.statements, state.files),
  });
  if (typeof recurring === "string") {
    return { ok: false, error: recurring };
  }
  const file = state.files.find((item) => item.file === "recurring.md");
  if (!file) {
    return { ok: false, error: "Нет файла recurring.md" };
  }
  await writeTextFile(
    await join(ctx.dir, "recurring.md"),
    appendStatement(file.source, recurringLine(recurring)),
  );
  return { ok: true, message: `Повтор «${recurring.name}» создан`, data: recurring };
}

export async function deleteRecurring(
  ctx: ActionContext,
  input: { id: string },
): Promise<ActionResult<{ id: string }>> {
  const state = await readState(ctx.dir);
  const file = state.files.find((item) => item.file === "recurring.md");
  if (!file) {
    return { ok: false, error: "Нет файла recurring.md" };
  }
  const recurring = parseFinance(file.source).statements.find(
    (item) => item.kind === "recurring" && item.id === input.id,
  );
  if (!recurring || recurring.kind !== "recurring") {
    return { ok: false, error: `Повтор ${input.id} не найден` };
  }
  const line = findRecurringLine(file.source, {
    id: recurring.id,
    line: recurring.line,
    name: recurring.name,
  });
  if (line === null) {
    return { ok: false, error: "Строка повтора не найдена" };
  }
  const next = retireStatement(file.source, line, recurring.id);
  if (next === null) {
    return { ok: false, error: "Строка повтора не найдена" };
  }
  await writeTextFile(await join(ctx.dir, "recurring.md"), next);
  return {
    ok: true,
    message: `Повтор ${input.id} удалён`,
    data: { id: input.id },
  };
}

export async function postRecurringNow(
  ctx: ActionContext,
  input: { id: string },
): Promise<ActionResult<NewMovement>> {
  const state = await readState(ctx.dir);
  const recurring = state.statements.find(
    (item) => item.kind === "recurring" && item.id === input.id,
  );
  if (!recurring || recurring.kind !== "recurring") {
    return { ok: false, error: `Повтор ${input.id} не найден` };
  }
  const monthStatements = monthStatementsOf(state.files, ctx.month);
  const movement = postRecurring({
    recurring,
    month: ctx.month,
    monthStatements,
    accounts: state.accounts,
    categories: state.categories,
    ids: usedIds(state.statements, state.files),
  });
  if (typeof movement === "string") {
    return { ok: false, error: movement };
  }
  await appendToMonth(ctx.dir, ctx.month, state.files, movementLine(movement));
  return {
    ok: true,
    message: `Повтор «${recurring.name}» проведён за ${ctx.month}`,
    data: movement,
  };
}

export function operationView(statement: Operation): OperationView {
  if (statement.kind === "expense" || statement.kind === "income") {
    return {
      id: statement.id,
      kind: statement.kind,
      date: statement.date,
      amount: statement.amount,
      currency: statement.currency,
      account: statement.account,
      category: statement.category,
      title: statement.title,
      description: statement.description,
    };
  }
  if (statement.kind === "transfer" || statement.kind === "exchange") {
    return {
      id: statement.id,
      kind: statement.kind,
      date: statement.date,
      amount: statement.amount,
      currency: statement.currency,
      from: statement.from,
      to: statement.to,
      toAmount: statement.kind === "exchange" ? statement.toAmount : undefined,
      toCurrency: statement.kind === "exchange" ? statement.toCurrency : undefined,
      description: statement.description,
    };
  }
  throw new Error("Неизвестная операция");
}

async function readState(dir: string): Promise<State> {
  const files = await readDataFolder(dir);
  const loaded = interpretFiles(files);
  const statements = loaded.statements.map((item) => item.statement);
  return {
    files,
    statements,
    accounts: firstAccounts(statements),
    categories: firstCategories(statements),
  };
}

function firstAccounts(statements: Statement[]): AccountStatement[] {
  const result: AccountStatement[] = [];
  const seen = new Set<string>();
  for (const statement of statements) {
    if (statement.kind === "account" && !seen.has(statement.name)) {
      result.push(statement);
      seen.add(statement.name);
    }
  }
  return result;
}

function firstCategories(statements: Statement[]): CategoryStatement[] {
  const result: CategoryStatement[] = [];
  const seen = new Set<string>();
  for (const statement of statements) {
    if (statement.kind === "category" && !seen.has(statement.name)) {
      result.push(statement);
      seen.add(statement.name);
    }
  }
  return result;
}

function usedIds(statements: Statement[], files: LoadedFile[]): string[] {
  return [
    ...statements.flatMap((statement) =>
      "id" in statement && statement.id ? [statement.id] : [],
    ),
    ...files.flatMap((file) => retiredIds(file.source)),
  ];
}

function monthStatementsOf(files: LoadedFile[], month: string): Statement[] {
  return interpretFiles(files).statements
    .filter((item) => item.file === `transactions/${month}.md`)
    .map((item) => item.statement);
}

function monthSource(files: LoadedFile[], month: string): string | null {
  return files.find((item) => item.file === `transactions/${month}.md`)?.source ?? null;
}

async function monthPath(dir: string, month: string): Promise<string> {
  return join(dir, "transactions", `${month}.md`);
}

async function appendToMonth(
  dir: string,
  month: string,
  files: LoadedFile[],
  line: string,
): Promise<void> {
  const path = await monthPath(dir, month);
  let source = files.find((item) => item.file === `transactions/${month}.md`)?.source;
  if (source === undefined) {
    try {
      source = await readTextFile(path);
    } catch {
      source = "```finance\n```\n";
    }
  }
  await writeTextFile(path, appendStatement(source, line));
}

async function writeFilesSafely(
  dir: string,
  files: LoadedFile[],
  nextSources: Map<string, string>,
): Promise<void> {
  const written: string[] = [];
  try {
    for (const [file, source] of nextSources) {
      await writeTextFile(await join(dir, ...file.split("/")), source);
      written.push(file);
    }
  } catch (error) {
    for (const file of written) {
      const previous = files.find((item) => item.file === file);
      if (!previous) {
        continue;
      }
      try {
        await writeTextFile(await join(dir, ...file.split("/")), previous.source);
      } catch {
        // Возвращаем исходную ошибку: откат — вспомогательный шаг.
      }
    }
    throw error;
  }
}

function newParseError(
  files: LoadedFile[],
  nextSources: Map<string, string>,
): string | null {
  const before = new Set(
    interpretFiles(files).errors.map((item) => `${item.file}:${item.line}:${item.message}`),
  );
  const nextFiles = files.map((file) => ({
    file: file.file,
    source: nextSources.get(file.file) ?? file.source,
  }));
  const added = interpretFiles(nextFiles).errors.find(
    (item) => !before.has(`${item.file}:${item.line}:${item.message}`),
  );
  return added ? `${added.file}:${added.line} — ${added.message}` : null;
}

type Operation = ExpenseStatement | IncomeStatement | TransferStatement | ExchangeStatement;

function isOperation(statement: Statement): statement is Operation {
  return (
    statement.kind === "expense" ||
    statement.kind === "income" ||
    statement.kind === "transfer" ||
    statement.kind === "exchange"
  );
}
