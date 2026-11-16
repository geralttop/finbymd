import { normalizeAmount } from "./entry-file";
import type { Statement } from "./parse";

export type Plan = {
  id: string;
  title: string;
  amount: string;
  currency: string;
  due?: string;
  priority?: number;
  done?: string;
  description?: string;
  line: number;
};

export type PlanTotal = {
  currency: string;
  amount: string;
};

export type NewPlan = {
  id: string;
  title: string;
  amount: string;
  currency: string;
  due?: string;
  priority?: number;
  description?: string;
};

export function nextPlanId(ids: Iterable<string>): string {
  let max = 0;
  for (const id of ids) {
    const match = /^p(\d+)$/.exec(id);
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  }
  return `p${max + 1}`;
}

export function preparePlan(input: {
  title: string;
  amount: string;
  currency: string;
  due: string;
  priority: string;
  description: string;
  ids: Iterable<string>;
}): NewPlan | string {
  const title = input.title.trim();
  if (title.length === 0) {
    return "Введите название плана";
  }
  if (title.includes('"') || /[\r\n]/.test(title)) {
    return "Название должно быть в одну строку и без кавычек";
  }
  const amount = normalizeAmount(input.amount);
  if (amount === null) {
    return "Сумму запишите числом, не больше двух знаков после точки";
  }
  if (Number(amount) <= 0) {
    return "Сумма должна быть больше нуля";
  }
  if (input.due && !isDate(input.due)) {
    return "Срок должен быть датой вида 2026-12-01";
  }
  const priority = input.priority === "" ? undefined : Number(input.priority);
  if (priority !== undefined && (!Number.isInteger(priority) || priority < 1 || priority > 3)) {
    return "Приоритет должен быть 1, 2 или 3";
  }
  const description = input.description.trim();
  if (/[\r\n]/.test(description)) {
    return "Описание должно быть в одну строку";
  }
  return {
    id: nextPlanId(input.ids),
    title,
    amount,
    currency: input.currency,
    ...(input.due ? { due: input.due } : {}),
    ...(priority !== undefined ? { priority } : {}),
    ...(description ? { description } : {}),
  };
}

export function planLine(plan: NewPlan): string {
  const due = plan.due ? ` due ${plan.due}` : "";
  const priority = plan.priority !== undefined ? ` priority ${plan.priority}` : "";
  const description = plan.description ? ` :: ${plan.description}` : "";
  return `plan ${plan.id} "${plan.title}" ${plan.amount} ${plan.currency}${due}${priority}${description}`;
}

export function planDoneLine(plan: string, date: string): string {
  return `plan-done ${plan} ${date}`;
}

export function buildPlans(statements: Statement[]): Plan[] {
  const plans = new Map<string, Plan>();
  for (const statement of statements) {
    if (statement.kind !== "plan") {
      continue;
    }
    const id = statement.id ?? `p${statement.line}`;
    plans.set(id, {
      id,
      title: statement.title,
      amount: statement.amount,
      currency: statement.currency,
      ...(statement.due ? { due: statement.due } : {}),
      ...(statement.priority !== undefined ? { priority: statement.priority } : {}),
      ...(statement.description ? { description: statement.description } : {}),
      line: statement.line,
    });
  }
  for (const statement of statements) {
    if (statement.kind !== "plan-done") {
      continue;
    }
    const plan = plans.get(statement.plan);
    if (plan) {
      plan.done = statement.date;
    }
  }
  return [...plans.values()].sort(comparePlans);
}

export function openPlans(plans: Plan[]): Plan[] {
  return plans.filter((plan) => plan.done === undefined);
}

export function planTotals(plans: Plan[]): PlanTotal[] {
  const totals = new Map<string, number>();
  for (const plan of openPlans(plans)) {
    totals.set(plan.currency, (totals.get(plan.currency) ?? 0) + toCents(plan.amount));
  }
  return [...totals.entries()]
    .sort((left, right) => left[0].localeCompare(right[0]))
    .map(([currency, cents]) => ({ currency, amount: fromCents(cents) }));
}

function comparePlans(left: Plan, right: Plan): number {
  if (left.done !== undefined && right.done === undefined) {
    return 1;
  }
  if (left.done === undefined && right.done !== undefined) {
    return -1;
  }
  const priority = (left.priority ?? 2) - (right.priority ?? 2);
  if (priority !== 0) {
    return priority;
  }
  if (left.due && right.due && left.due !== right.due) {
    return left.due.localeCompare(right.due);
  }
  if (left.due && !right.due) {
    return -1;
  }
  if (!left.due && right.due) {
    return 1;
  }
  return left.title.localeCompare(right.title, "ru");
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function toCents(amount: string): number {
  const [whole, fraction = ""] = amount.split(".");
  return Math.round(Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2)));
}

function fromCents(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}
