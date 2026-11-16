import { describe, expect, it } from "vitest";
import { accountUsage, replaceAccountLine, rewriteAccountReferences } from "./account-edit";
import { parseFinance } from "./parse";

const month = `# Октябрь 2026

\`\`\`finance
expense t1 2026-10-02 12.40 BYN from "Карта" category "Кафе" "кофе" :: Карта
income t2 2026-10-03 250.00 BYN to "Карта" category "Стипендия" "зарплата"
transfer t3 2026-10-09 100.00 BYN from "Карта" to "Наличные" :: снял
exchange t4 2026-10-16 20.00 USD from "Карта USD" to "Карта" 62.00 BYN
recurring r1 "Аренда" from "Карта" category "Аренда" 200.00 BYN day 5
expense t5 2026-10-20 5.00 BYN from "Наличные" category "Кафе" "чай"
\`\`\`
`;

describe("accountUsage", () => {
  it("counts every line that refers to the account", () => {
    const statements = parseFinance(month).statements;
    expect(accountUsage(statements, "Карта")).toEqual({
      operations: 4,
      recurring: 1,
      total: 5,
    });
    expect(accountUsage(statements, "Наличные")).toEqual({
      operations: 2,
      recurring: 0,
      total: 2,
    });
    expect(accountUsage(statements, "Копилка").total).toBe(0);
  });
});

describe("replaceAccountLine", () => {
  const source = `# Счета\n\n\`\`\`finance\naccount "Карта" bank BYN opening 400.00\naccount "Наличные" cash BYN opening 80.00\n\`\`\`\n`;

  it("replaces only the requested line", () => {
    const next = replaceAccountLine(source, 4, {
      name: "Карта",
      accountType: "cash",
      currency: "USD",
      opening: "100.00",
    });
    expect(next).not.toBeNull();
    expect(next).toContain('account "Карта" cash USD opening 100.00');
    expect(next).toContain('account "Наличные" cash BYN opening 80.00');
  });

  it("refuses a line that is not an account", () => {
    expect(
      replaceAccountLine(source, 1, {
        name: "Карта",
        accountType: "bank",
        currency: "BYN",
        opening: "0.00",
      }),
    ).toBeNull();
  });

  it("keeps Windows line endings", () => {
    const windows = source.replace(/\n/g, "\r\n");
    const next = replaceAccountLine(windows, 4, {
      name: "Карта",
      accountType: "bank",
      currency: "BYN",
      opening: "500.00",
    });
    expect(next).toContain("\r\n");
    expect(next?.includes("\n\n")).toBe(false);
  });
});

describe("rewriteAccountReferences", () => {
  it("renames the account in every kind of line", () => {
    const result = rewriteAccountReferences(month, "Карта", "Основная карта");
    expect(result.changed).toBe(true);
    expect(result.source).toContain('from "Основная карта" category "Кафе"');
    expect(result.source).toContain('to "Основная карта" category "Стипендия"');
    expect(result.source).toContain('from "Основная карта" to "Наличные"');
    expect(result.source).toContain('to "Основная карта" 62.00 BYN');
    expect(result.source).toContain('recurring r1 "Аренда" from "Основная карта"');
    expect(result.source).not.toContain('from "Карта"');
    expect(result.source).not.toContain('to "Карта"');
  });

  it("keeps titles, descriptions and other accounts untouched", () => {
    const result = rewriteAccountReferences(month, "Карта", "Основная карта");
    expect(result.source).toContain('"кофе" :: Карта');
    expect(result.source).toContain('from "Наличные" category "Кафе" "чай"');
    expect(result.source).toContain('from "Карта USD"');
  });

  it("does nothing to other accounts", () => {
    const result = rewriteAccountReferences(month, "Копилка", "Сбережения");
    expect(result.changed).toBe(false);
    expect(result.source).toBe(month);
  });

  it("keeps the file parseable", () => {
    const result = rewriteAccountReferences(month, "Карта", "Основная карта");
    expect(parseFinance(result.source).errors).toEqual([]);
    expect(parseFinance(result.source).statements).toHaveLength(6);
  });
});
