import { describe, expect, it } from "vitest";
import { appendStatement } from "./fence";
import { movementLine } from "./entry-file";
import type { AccountStatement, CategoryStatement, RecurringStatement } from "./parse";
import { parseFinance } from "./parse";
import {
  alreadyPosted,
  postDate,
  postRecurring,
  prepareRecurring,
  recurringLine,
  reminderDue,
} from "./recurring-file";

const card: AccountStatement = {
  kind: "account",
  line: 1,
  name: "Карта",
  accountType: "bank",
  currency: "BYN",
  opening: "400.00",
};

const rent: CategoryStatement = {
  kind: "category",
  line: 1,
  name: "Аренда",
  categoryKind: "expense",
};

describe("prepareRecurring", () => {
  it("пишет повтор аренды", () => {
    const recurring = prepareRecurring({
      name: "Аренда",
      account: "Карта",
      category: "Аренда",
      amount: "200",
      day: "5",
      accounts: [card],
      categories: [rent],
      ids: [],
    });
    if (typeof recurring === "string") {
      throw new Error(recurring);
    }

    expect(recurringLine(recurring)).toBe(
      'recurring r1 "Аренда" from "Карта" category "Аренда" 200.00 BYN day 5',
    );
    expect(parseFinance(`\`\`\`finance\n${recurringLine(recurring)}\n\`\`\`\n`).errors).toEqual([]);
  });
});

describe("postRecurring", () => {
  it("проводит аренду один раз", () => {
    const recurring = rentStatement();
    const first = postRecurring({
      recurring,
      month: "2026-10",
      monthStatements: [],
      accounts: [card],
      categories: [rent],
      ids: [],
    });
    if (typeof first === "string") {
      throw new Error(first);
    }

    const source = appendStatement("```finance\n```\n", movementLine(first));
    const posted = parseFinance(source, { month: "2026-10" });
    expect(posted.statements.filter((statement) => statement.kind === "expense")).toHaveLength(1);
    expect(posted.statements[0]).toMatchObject({
      kind: "expense",
      amount: "200.00",
      title: "Аренда",
      description: "повтор r1",
    });
    expect(alreadyPosted(posted.statements, recurring)).toBe(true);
    expect(postRecurring({
      recurring,
      month: "2026-10",
      monthStatements: posted.statements,
      accounts: [card],
      categories: [rent],
      ids: ["t1"],
    })).toBe("Уже проведено в этом месяце");
  });
});

describe("postDate", () => {
  it("в коротком месяце берёт последний день", () => {
    expect(postDate("2026-02", 31)).toBe("2026-02-28");
  });
});

describe("reminderDue", () => {
  const october = new Date(2026, 9, 20);

  it("напоминает с нужного дня и только в текущем месяце", () => {
    expect(reminderDue(5, "2026-10", october)).toBe(true);
    expect(reminderDue(20, "2026-10", october)).toBe(true);
    expect(reminderDue(21, "2026-10", october)).toBe(false);
    expect(reminderDue(5, "2026-11", october)).toBe(false);
  });
});

function rentStatement(): RecurringStatement {
  return {
    kind: "recurring",
    line: 2,
    id: "r1",
    name: "Аренда",
    account: "Карта",
    category: "Аренда",
    amount: "200.00",
    currency: "BYN",
    day: 5,
  };
}
