import { describe, expect, it } from "vitest";
import {
  categoryUsage,
  removeStatementLine,
  replaceCategoryLine,
  rewriteCategoryReferences,
} from "./category-edit";
import { parseFinance } from "./parse";

const month = `# Октябрь 2026

\`\`\`finance
expense t1 2026-10-02 12.40 BYN from "Карта" category "Кафе" "кофе"
income t2 2026-10-03 250.00 BYN to "Карта" category "Стипендия" "стипендия"
recurring r1 "Аренда" from "Карта" category "Аренда" 200.00 BYN day 5
expense t3 2026-10-04 5.00 BYN from "Наличные" category "Кафе" "чай"
\`\`\`
`;

describe("categoryUsage", () => {
  it("counts operations and recurring lines", () => {
    const statements = parseFinance(month).statements;
    expect(categoryUsage(statements, "Кафе")).toEqual({
      operations: 2,
      recurring: 0,
      total: 2,
    });
    expect(categoryUsage(statements, "Аренда")).toEqual({
      operations: 0,
      recurring: 1,
      total: 1,
    });
    expect(categoryUsage(statements, "Нет")).toEqual({
      operations: 0,
      recurring: 0,
      total: 0,
    });
  });
});

describe("replaceCategoryLine", () => {
  const source = `# Категории\n\n\`\`\`finance\ncategory "Продукты" expense\ncategory "Кафе" expense\n\`\`\`\n`;

  it("replaces the requested category", () => {
    const next = replaceCategoryLine(source, 4, {
      name: "Еда",
      categoryKind: "expense",
    });
    expect(next).toContain('category "Еда" expense');
    expect(next).toContain('category "Кафе" expense');
  });

  it("refuses a line that is not a category", () => {
    expect(replaceCategoryLine(source, 1, { name: "Еда", categoryKind: "expense" })).toBeNull();
  });
});

describe("rewriteCategoryReferences", () => {
  it("renames the category in operations and recurring lines", () => {
    const result = rewriteCategoryReferences(month, "Кафе", "Кафе и чай");
    expect(result.changed).toBe(true);
    expect(result.source).toContain('category "Кафе и чай" "кофе"');
    expect(result.source).toContain('category "Кафе и чай" "чай"');
    expect(result.source).not.toContain('category "Кафе"');
  });

  it("rewrites a recurring line", () => {
    const result = rewriteCategoryReferences(month, "Аренда", "Жильё");
    expect(result.source).toContain('recurring r1 "Аренда" from "Карта" category "Жильё"');
    expect(parseFinance(result.source).errors).toEqual([]);
  });

  it("does nothing for an unused name", () => {
    const result = rewriteCategoryReferences(month, "Нет", "Есть");
    expect(result.changed).toBe(false);
    expect(result.source).toBe(month);
  });
});

describe("removeStatementLine", () => {
  it("removes a category line", () => {
    const source = `\`\`\`finance\ncategory "Продукты" expense\ncategory "Кафе" expense\n\`\`\`\n`;
    const next = removeStatementLine(source, 2);
    expect(next).not.toBeNull();
    expect(next).not.toContain('category "Продукты"');
    expect(next).toContain('category "Кафе"');
  });
});
