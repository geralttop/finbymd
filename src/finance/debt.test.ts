import { describe, expect, it } from "vitest";
import { balances } from "./balance";
import {
  buildDebts,
  debtAgreedLine,
  debtForgiveLine,
  debtLine,
  debtMonthFlow,
  debtPaymentLine,
  debtTotals,
  prepareDebt,
  preparePayment,
} from "./debt";
import { parseFinance } from "./parse";

const ledger = `\`\`\`finance
account "Карта" bank BYN opening 100.00
account "Наличные" cash BYN opening 0.00
category "Продукты" expense
${debtLine({
  id: "d1",
  date: "2026-11-01",
  person: "Андрей",
  amount: "65.00",
  currency: "BYN",
  direction: "to",
  account: "Карта",
})}
${debtAgreedLine({ debt: "d1", date: "2026-11-02", amount: "40.00" })}
${debtPaymentLine({
  debt: "d1",
  date: "2026-11-03",
  amount: "40.00",
  currency: "BYN",
  direction: "from",
  account: "Карта",
})}
${debtLine({
  id: "d2",
  date: "2026-11-04",
  person: "Марина",
  amount: "20.00",
  currency: "BYN",
  direction: "from",
  account: "Карта",
})}
\`\`\`
`;

function statements(source: string) {
  const parsed = parseFinance(source);
  expect(parsed.errors).toEqual([]);
  return parsed.statements;
}

describe("долги", () => {
  it("меняет остаток счёта и хранит договорённость", () => {
    const parsed = statements(ledger);
    const debts = buildDebts(parsed);
    const andrey = debts.find((debt) => debt.id === "d1");
    const marina = debts.find((debt) => debt.id === "d2");

    expect(andrey).toMatchObject({
      person: "Андрей",
      direction: "owe",
      principal: "65.00",
      agreed: "40.00",
      paid: "40.00",
      forgiven: "25.00",
      remaining: "0.00",
      status: "closed",
    });
    expect(andrey?.events.map((event) => event.kind)).toEqual(["open", "agreed", "pay"]);
    expect(marina).toMatchObject({
      direction: "owed",
      principal: "20.00",
      remaining: "20.00",
      status: "open",
    });

    const money = balances(parsed).find((account) => account.name === "Карта");
    expect(money?.amount).toBe("105.00");
  });

  it("считает итоги и движение за месяц", () => {
    const debts = buildDebts(statements(ledger));
    expect(debtTotals(debts)).toEqual([{ currency: "BYN", owe: "0.00", owed: "20.00" }]);
    expect(debtMonthFlow(debts, "2026-11")).toEqual([
      {
        currency: "BYN",
        borrowed: "65.00",
        repaid: "40.00",
        lent: "20.00",
        collected: "0.00",
        forgiven: "25.00",
        cash: "5.00",
      },
    ]);
    expect(debtMonthFlow(debts, "2026-12")).toEqual([]);
  });

  it("закрывает долг прощением без движения денег", () => {
    const source = `\`\`\`finance
account "Карта" bank BYN opening 0.00
${debtLine({
  id: "d1",
  date: "2026-11-01",
  person: "Андрей",
  amount: "65.00",
  currency: "BYN",
  direction: "to",
  account: "Карта",
})}
${debtForgiveLine({ debt: "d1", date: "2026-11-05" })}
\`\`\`
`;
    const parsed = statements(source);
    const [debt] = buildDebts(parsed);
    expect(debt).toMatchObject({
      agreed: "65.00",
      paid: "0.00",
      forgiven: "65.00",
      remaining: "0.00",
      status: "closed",
    });
    expect(balances(parsed)[0]?.amount).toBe("65.00");
  });

  it("не даёт вернуть больше валюты долга и кривую сумму", () => {
    const debts = buildDebts(statements(ledger));
    const andrey = debts.find((debt) => debt.id === "d1");
    expect(andrey).toBeDefined();
    if (!andrey) {
      return;
    }
    expect(preparePayment(andrey, { amount: "10", date: "2026-11-09", account: {
      kind: "account",
      line: 1,
      name: "Карта",
      accountType: "bank",
      currency: "BYN",
      opening: "0.00",
    }, description: "" })).toBe("Долг уже закрыт");
  });
});

describe("prepareDebt", () => {
  it("назначает идентификатор и проверяет поля", () => {
    const debt = prepareDebt({
      person: " Андрей ",
      amount: "65",
      currency: "BYN",
      direction: "to",
      account: "Карта",
      date: "2026-11-01",
      description: "",
      ids: ["d1", "d3"],
    });
    expect(debt).toMatchObject({ id: "d4", person: "Андрей", amount: "65.00" });

    expect(
      prepareDebt({
        person: "",
        amount: "65",
        currency: "BYN",
        direction: "to",
        account: "Карта",
        date: "2026-11-01",
        description: "",
        ids: [],
      }),
    ).toBe("Введите имя человека");
  });
});