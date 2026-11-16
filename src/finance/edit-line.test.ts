import { describe, expect, it } from "vitest";
import { findStatementLine, replaceStatement, retireStatement, retiredIds } from "./edit-line";
import { movementLine, nextTransactionId, prepareEdit } from "./entry-file";
import type { AccountStatement, CategoryStatement } from "./parse";
import { parseFinance } from "./parse";

const source = [
  "```finance",
  'expense t1 2026-10-20 35.00 BYN from "БУНЫ" category "Игры" "игра"',
  "```",
  "",
].join("\n");

const account: AccountStatement = {
  kind: "account",
  line: 1,
  name: "БУНЫ",
  accountType: "cash",
  currency: "BYN",
  opening: "120.00",
};

const category: CategoryStatement = {
  kind: "category",
  line: 1,
  name: "Игры",
  categoryKind: "expense",
};

describe("replaceStatement", () => {
  it("оставляет одну строку с тем же id", () => {
    const edited = prepareEdit({
      kind: "expense",
      id: "t1",
      date: "2026-10-20",
      amount: "40",
      account: "БУНЫ",
      category: "Игры",
      title: "телевизор",
      description: "устал тащить его домой",
      month: "2026-10",
      accounts: [account],
      categories: [category],
    });
    if (typeof edited === "string") {
      throw new Error(edited);
    }
    const next = replaceStatement(source, 2, movementLine(edited));
    const parsed = parseFinance(next ?? "", { month: "2026-10" });

    expect(next?.match(/expense/g)).toHaveLength(1);
    expect(parsed.statements).toHaveLength(1);
    expect(parsed.statements[0]).toMatchObject({
      id: "t1",
      amount: "40.00",
      title: "телевизор",
      description: "устал тащить его домой",
    });
  });
});

describe("retireStatement", () => {
  it("не выдаёт удалённый id снова", () => {
    const next = retireStatement(source, 2, "t1");
    expect(next).toContain("// deleted t1");
    expect(parseFinance(next ?? "", { month: "2026-10" }).statements).toHaveLength(0);
    expect(nextTransactionId(retiredIds(next ?? ""))).toBe("t2");
    expect(findStatementLine(next ?? "", "2026-10", {
      line: 2,
      id: "t1",
      kind: "expense",
      date: "2026-10-20",
    })).toBeNull();
  });
});
