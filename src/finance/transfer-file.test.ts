import { describe, expect, it } from "vitest";
import { balances } from "./balance";
import type { AccountStatement } from "./parse";
import { parseFinance } from "./parse";
import { prepareTransfer, transferLine } from "./transfer-file";

const cash: AccountStatement = {
  kind: "account",
  line: 1,
  name: "Наличные",
  accountType: "cash",
  currency: "BYN",
  opening: "80.00",
};

const card: AccountStatement = {
  kind: "account",
  line: 2,
  name: "Карта",
  accountType: "bank",
  currency: "BYN",
  opening: "400.00",
};

const usd: AccountStatement = {
  kind: "account",
  line: 3,
  name: "Карта USD",
  accountType: "bank",
  currency: "USD",
  opening: "50.00",
};

function moved(line: string) {
  const parsed = parseFinance(`\`\`\`finance\n${line}\n\`\`\`\n`, { month: "2026-10" });
  expect(parsed.errors).toEqual([]);
  return balances([cash, card, usd, parsed.statements[0]]);
}

describe("prepareTransfer", () => {
  it("переносит 50 BYN с карты в наличные", () => {
    const transfer = prepareTransfer({
      date: "2026-10-21",
      amount: "50",
      toAmount: "",
      from: "Карта",
      to: "Наличные",
      description: "",
      month: "2026-10",
      accounts: [cash, card, usd],
      ids: [],
    });
    if (typeof transfer === "string") {
      throw new Error(transfer);
    }

    expect(transferLine(transfer)).toBe(
      'transfer t1 2026-10-21 50.00 BYN from "Карта" to "Наличные"',
    );
    expect(moved(transferLine(transfer))).toEqual([
      { name: "Наличные", currency: "BYN", amount: "130.00" },
      { name: "Карта", currency: "BYN", amount: "350.00" },
      { name: "Карта USD", currency: "USD", amount: "50.00" },
    ]);
  });

  it("обмен 20 USD на 62 BYN двигает каждый счёт на свою сумму", () => {
    const transfer = prepareTransfer({
      date: "2026-10-21",
      amount: "20.00",
      toAmount: "62",
      from: "Карта USD",
      to: "Карта",
      description: "в банке",
      month: "2026-10",
      accounts: [cash, card, usd],
      ids: ["t3"],
    });
    if (typeof transfer === "string") {
      throw new Error(transfer);
    }

    expect(transferLine(transfer)).toBe(
      'exchange t4 2026-10-21 20.00 USD from "Карта USD" to "Карта" 62.00 BYN :: в банке',
    );
    expect(moved(transferLine(transfer))).toEqual([
      { name: "Наличные", currency: "BYN", amount: "80.00" },
      { name: "Карта", currency: "BYN", amount: "462.00" },
      { name: "Карта USD", currency: "USD", amount: "30.00" },
    ]);
  });

  it("не переводит на тот же счёт и не обменивает без второй суммы", () => {
    expect(prepareTransfer({
      date: "2026-10-21",
      amount: "50.00",
      toAmount: "",
      from: "Карта",
      to: "Карта",
      description: "",
      month: "2026-10",
      accounts: [cash, card],
      ids: [],
    })).toBe("Перевод на тот же счёт «Карта»");

    expect(prepareTransfer({
      date: "2026-10-21",
      amount: "20.00",
      toAmount: "",
      from: "Карта USD",
      to: "Карта",
      description: "",
      month: "2026-10",
      accounts: [card, usd],
      ids: [],
    })).toBe("Вторую сумму запишите числом, не больше двух знаков после точки");
  });
});
