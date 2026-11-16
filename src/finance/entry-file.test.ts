import { describe, expect, it } from "vitest";
import {
  defaultDate,
  movementLine,
  nextTransactionId,
  prepareMovement,
  todayDate,
} from "./entry-file";
import type { AccountStatement, CategoryStatement } from "./parse";
import { parseFinance } from "./parse";

const account: AccountStatement = {
  kind: "account",
  line: 1,
  name: "Карта",
  accountType: "bank",
  currency: "BYN",
  opening: "400.00",
};

const category: CategoryStatement = {
  kind: "category",
  line: 1,
  name: "Техника",
  categoryKind: "expense",
};

describe("movementLine", () => {
  it("пишет расход с заголовком и описанием", () => {
    const line = movementLine({
      kind: "expense",
      id: "t1",
      date: "2026-10-20",
      amount: "1000.00",
      currency: "BYN",
      account: "Карта",
      category: "Техника",
      title: "телевизор",
      description: "устал тащить его домой",
    });

    expect(line).toBe(
      'expense t1 2026-10-20 1000.00 BYN from "Карта" category "Техника" "телевизор" :: устал тащить его домой',
    );
    expect(parseFinance(`\`\`\`finance\n${line}\n\`\`\`\n`, { month: "2026-10" }).statements[0]).toMatchObject({
      kind: "expense",
      id: "t1",
      title: "телевизор",
      description: "устал тащить его домой",
    });
  });
});

describe("prepareMovement", () => {
  it("назначает следующий id и приводит сумму", () => {
    const movement = prepareMovement({
      kind: "expense",
      date: "2026-10-20",
      amount: "1000",
      account: "Карта",
      category: "Техника",
      title: "телевизор",
      description: "устал тащить его домой",
      month: "2026-10",
      accounts: [account],
      categories: [category],
      ids: ["t1", "t3"],
    });

    expect(movement).toMatchObject({ id: "t4", amount: "1000.00", currency: "BYN" });
  });

  it("не принимает дату другого месяца и категорию не того вида", () => {
    expect(prepareMovement({
      kind: "expense",
      date: "2026-11-01",
      amount: "10.00",
      account: "Карта",
      category: "Техника",
      title: "",
      description: "",
      month: "2026-10",
      accounts: [account],
      categories: [category],
      ids: [],
    })).toBe("Дата 2026-11-01 не относится к месяцу 2026-10");

    expect(prepareMovement({
      kind: "income",
      date: "2026-10-01",
      amount: "10.00",
      account: "Карта",
      category: "Техника",
      title: "",
      description: "",
      month: "2026-10",
      accounts: [account],
      categories: [category],
      ids: [],
    })).toBe("Категория «Техника» предназначена для расхода");
  });
});

describe("nextTransactionId", () => {
  it("начинает с t1 и не заполняет пропуски", () => {
    expect(nextTransactionId([])).toBe("t1");
    expect(nextTransactionId(["t2", "r1"])).toBe("t3");
  });
});

const firstOfNovember = new Date(2026, 10, 1, 12, 0, 0);

describe("todayDate", () => {
  it("отдаёт локальную дату в формате файла", () => {
    expect(todayDate(firstOfNovember)).toBe("2026-11-01");
    expect(todayDate(new Date(2026, 0, 9))).toBe("2026-01-09");
  });
});

describe("defaultDate", () => {
  it("ставит сегодняшнее число в текущем месяце", () => {
    expect(defaultDate("2026-11", firstOfNovember)).toBe("2026-11-01");
  });

  it("для другого месяца ставит первое число", () => {
    expect(defaultDate("2026-10", firstOfNovember)).toBe("2026-10-01");
  });
});
