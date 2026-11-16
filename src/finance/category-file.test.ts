import { describe, expect, it } from "vitest";
import { categoryLine, normalizeCategory } from "./category-file";
import { appendStatement } from "./fence";
import { parseFinance } from "./parse";

describe("categoryLine", () => {
  it("дописывает категорию в пустой блок и файл читается обратно", () => {
    const next = appendStatement(
      "```finance\n```\n",
      categoryLine({ name: "Продукты", categoryKind: "expense" }),
    );

    expect(next).toBe('```finance\ncategory "Продукты" expense\n```\n');
    const parsed = parseFinance(next);
    expect(parsed.errors).toEqual([]);
    expect(parsed.statements[0]).toMatchObject({
      kind: "category",
      name: "Продукты",
      categoryKind: "expense",
    });
  });
});

describe("normalizeCategory", () => {
  it("обрезает имя", () => {
    expect(normalizeCategory({ name: " Продукты ", categoryKind: "expense" })).toEqual({
      name: "Продукты",
      categoryKind: "expense",
    });
  });

  it("отклоняет пустое имя и чужой вид", () => {
    expect(normalizeCategory({ name: " ", categoryKind: "expense" })).toBe("Введите имя категории");
    expect(normalizeCategory({ name: "Продукты", categoryKind: "transfer" })).toBe(
      "Вид категории должен быть expense или income",
    );
  });
});

describe("normalizeCategory newlines", () => {
  it("rejects a line break in the name", () => {
    expect(normalizeCategory({ name: "Еда\nи чай", categoryKind: "expense" })).toBe(
      "Имя категории должно быть в одну строку",
    );
  });
});
