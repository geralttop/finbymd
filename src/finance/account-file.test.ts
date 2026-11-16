import { describe, expect, it } from "vitest";
import { accountLine, appendAccount, normalizeAccount } from "./account-file";
import { parseFinance } from "./parse";

describe("appendAccount", () => {
  it("дописывает счёт в пустой блок и файл читается обратно", () => {
    const source = "```finance\n```\n";
    const next = appendAccount(source, accountLine({
      name: "Наличные",
      accountType: "cash",
      currency: "BYN",
      opening: "80.00",
    }));

    expect(next).toBe('```finance\naccount "Наличные" cash BYN opening 80.00\n```\n');
    const parsed = parseFinance(next);
    expect(parsed.errors).toEqual([]);
    expect(parsed.statements[0]).toMatchObject({
      kind: "account",
      name: "Наличные",
      accountType: "cash",
      currency: "BYN",
      opening: "80.00",
    });
  });

  it("не затирает уже лежащие строки", () => {
    const source = '```finance\naccount "Карта" bank BYN opening 400.00\n```\n';
    const next = appendAccount(
      source,
      'account "Наличные" cash BYN opening 0.00',
    );

    expect(parseFinance(next).statements.map((statement) => statement.kind === "account" ? statement.name : "")).toEqual([
      "Карта",
      "Наличные",
    ]);
  });
});

describe("normalizeAccount", () => {
  it("приводит валюту и остаток к виду строки", () => {
    expect(normalizeAccount({
      name: " Наличные ",
      accountType: "cash",
      currency: "byn",
      opening: "80",
    })).toEqual({
      name: "Наличные",
      accountType: "cash",
      currency: "BYN",
      opening: "80.00",
    });
  });

  it("отклоняет пустое имя и лишние знаки в сумме", () => {
    expect(normalizeAccount({
      name: " ",
      accountType: "cash",
      currency: "BYN",
      opening: "0.00",
    })).toBe("Введите имя счёта");
    expect(normalizeAccount({
      name: "Наличные",
      accountType: "bank",
      currency: "BYN",
      opening: "1.234",
    })).toBe("Начальный остаток запишите числом, не больше двух знаков после точки");
  });
});
