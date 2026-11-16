import { describe, expect, it } from "vitest";
import { balances } from "./balance";
import { parseFinance } from "./parse";

function ledger(body: string) {
  const parsed = parseFinance("```finance\n" + body + "\n```\n");
  expect(parsed.errors).toEqual([]);
  return balances(parsed.statements);
}

const accounts = `account "Наличные" cash BYN opening 80.00
account "Карта" bank BYN opening 400.00
account "Карта USD" bank USD opening 50.00`;

describe("balances", () => {
  it("начинает с opening", () => {
    expect(ledger(accounts)).toEqual([
      { name: "Наличные", currency: "BYN", amount: "80.00" },
      { name: "Карта", currency: "BYN", amount: "400.00" },
      { name: "Карта USD", currency: "USD", amount: "50.00" },
    ]);
  });

  it("уменьшает счёт расходом и увеличивает доходом", () => {
    expect(
      ledger(`${accounts}
expense t1 2026-10-20 10.00 BYN from "Наличные" category "Продукты"
income t2 2026-10-01 250.00 BYN to "Карта" category "Стипендия"`),
    ).toEqual([
      { name: "Наличные", currency: "BYN", amount: "70.00" },
      { name: "Карта", currency: "BYN", amount: "650.00" },
      { name: "Карта USD", currency: "USD", amount: "50.00" },
    ]);
  });

  it("переносит одну сумму между счетами", () => {
    expect(
      ledger(`${accounts}
transfer t1 2026-10-21 50.00 BYN from "Карта" to "Наличные"`),
    ).toEqual([
      { name: "Наличные", currency: "BYN", amount: "130.00" },
      { name: "Карта", currency: "BYN", amount: "350.00" },
      { name: "Карта USD", currency: "USD", amount: "50.00" },
    ]);
  });

  it("списывает первую сумму обмена и зачисляет вторую", () => {
    expect(
      ledger(`${accounts}
exchange t1 2026-10-21 20.00 USD from "Карта USD" to "Карта" 62.00 BYN`),
    ).toEqual([
      { name: "Наличные", currency: "BYN", amount: "80.00" },
      { name: "Карта", currency: "BYN", amount: "462.00" },
      { name: "Карта USD", currency: "USD", amount: "30.00" },
    ]);
  });

  it("не кладёт чужую валюту в остаток", () => {
    expect(
      ledger(`${accounts}
expense t1 2026-10-20 10.00 USD from "Наличные" category "Продукты"
transfer t2 2026-10-21 15.00 USD from "Карта" to "Наличные"`),
    ).toEqual([
      { name: "Наличные", currency: "BYN", amount: "80.00" },
      { name: "Карта", currency: "BYN", amount: "400.00" },
      { name: "Карта USD", currency: "USD", amount: "50.00" },
    ]);
  });

  it("не меняет остаток из-за повтора, пока тот не проведён", () => {
    expect(
      ledger(`${accounts}
recurring r1 "Аренда" from "Карта" category "Аренда" 200.00 BYN day 5`),
    ).toEqual([
      { name: "Наличные", currency: "BYN", amount: "80.00" },
      { name: "Карта", currency: "BYN", amount: "400.00" },
      { name: "Карта USD", currency: "USD", amount: "50.00" },
    ]);
  });
});
