import { describe, expect, it } from "vitest";
import { parseFinance, validateLedger } from "./parse";

const month = `
# Октябрь 2026

Хлеб брал по дороге.

\`\`\`finance
expense t1 2026-10-20 10.00 BYN from "Наличные" category "Продукты" "хлеб"
income t2 2026-10-01 250.00 BYN to "Карта" category "Стипендия"
transfer t3 2026-10-21 50.00 BYN from "Карта" to "Наличные"
exchange t4 2026-10-21 20.00 USD from "Карта USD" to "Карта BYN" 62.00 BYN :: в банке
expense t5 2026-10-20 1000.00 BYN from "Карта" category "Техника" "телевизор" :: устал тащить его домой
\`\`\`
`;

function finance(body: string): string {
  return "```finance\n" + body + "\n```\n";
}

describe("parseFinance", () => {
  it("читает все виды строк, заголовок и описание", () => {
    const { statements, errors } = parseFinance(month, { month: "2026-10" });

    expect(errors).toEqual([]);
    expect(statements).toEqual([
      {
        kind: "expense",
        line: 7,
        id: "t1",
        date: "2026-10-20",
        amount: "10.00",
        currency: "BYN",
        account: "Наличные",
        category: "Продукты",
        title: "хлеб",
      },
      {
        kind: "income",
        line: 8,
        id: "t2",
        date: "2026-10-01",
        amount: "250.00",
        currency: "BYN",
        account: "Карта",
        category: "Стипендия",
      },
      {
        kind: "transfer",
        line: 9,
        id: "t3",
        date: "2026-10-21",
        amount: "50.00",
        currency: "BYN",
        from: "Карта",
        to: "Наличные",
      },
      {
        kind: "exchange",
        line: 10,
        id: "t4",
        date: "2026-10-21",
        amount: "20.00",
        currency: "USD",
        from: "Карта USD",
        to: "Карта BYN",
        toAmount: "62.00",
        toCurrency: "BYN",
        description: "в банке",
      },
      {
        kind: "expense",
        line: 11,
        id: "t5",
        date: "2026-10-20",
        amount: "1000.00",
        currency: "BYN",
        account: "Карта",
        category: "Техника",
        title: "телевизор",
        description: "устал тащить его домой",
      },
    ]);
  });

  it("читает счета, категории и повтор", () => {
    const source = finance(`account "Наличные" cash BYN opening 80.00
account "Карта" bank BYN opening 400.00
category "Продукты" expense
category "Стипендия" income
recurring r1 "Аренда" from "Карта" category "Аренда" 200.00 BYN day 5`);

    const { statements, errors } = parseFinance(source);

    expect(errors).toEqual([]);
    expect(statements.map((statement) => statement.kind)).toEqual([
      "account",
      "account",
      "category",
      "category",
      "recurring",
    ]);
    expect(statements[4]).toMatchObject({
      kind: "recurring",
      id: "r1",
      name: "Аренда",
      account: "Карта",
      category: "Аренда",
      amount: "200.00",
      currency: "BYN",
      day: 5,
    });
  });

  it("принимает строку без id", () => {
    const { statements, errors } = parseFinance(
      finance(`expense 2026-10-20 10.00 BYN from "Наличные" category "Продукты"`),
    );

    expect(errors).toEqual([]);
    expect(statements[0]).toMatchObject({ kind: "expense", amount: "10.00" });
    expect(statements[0]).not.toHaveProperty("id");
    expect(statements[0]).not.toHaveProperty("title");
  });

  it("не читает текст вне блока и пропускает комментарий", () => {
    const source = `expense t1 2026-10-20 10.00 BYN from "Наличные" category "Продукты"

\`\`\`finance
// это комментарий

expense t1 2026-10-20 3.50 BYN from "Наличные" category "Продукты" "кофе"
\`\`\`

expense t9 2026-10-20 1.00 BYN from "Наличные" category "Продукты"`;

    const { statements, errors } = parseFinance(source);

    expect(errors).toEqual([]);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatchObject({ id: "t1", title: "кофе", line: 6 });
  });

  it("после кривой строки читает остальные и сообщает номер", () => {
    const source = finance(`expense t1 2026-13-01 10.00 BYN from "Наличные" category "Продукты"
income t2 2026-10-01 250.00 BYN to "Карта" category "Стипендия"
покупка t3 2026-10-02 5.00 BYN from "Наличные" category "Продукты"
expense t4 2026-10-03 10 BYN from "Наличные" category "Продукты"
expense t5 2026-10-04 10.00 byn from "Наличные" category "Продукты"
exchange t6 2026-10-05 20.00 USD from "Карта USD" to "Карта BYN"`);

    const { statements, errors } = parseFinance(source);

    expect(statements.map((statement) => (statement.kind === "income" ? statement.id : ""))).toEqual([
      "t2",
    ]);
    expect(errors).toEqual([
      { line: 2, message: "Дата «2026-13-01» не существует" },
      { line: 4, message: "Неизвестное слово «покупка»" },
      { line: 5, message: "Сумма «10» должна быть с двумя знаками после точки" },
      { line: 6, message: "Валюта «byn» должна быть из 3 или 4 заглавных латинских букв" },
      { line: 7, message: "В обмене нет второй суммы" },
    ]);
  });

  it("отклоняет дату из другого месяца", () => {
    const { statements, errors } = parseFinance(
      finance(`expense t1 2026-11-01 10.00 BYN from "Наличные" category "Продукты"`),
      { month: "2026-10" },
    );

    expect(statements).toEqual([]);
    expect(errors).toEqual([
      { line: 2, message: "Дата 2026-11-01 не относится к месяцу 2026-10" },
    ]);
  });

  it("сообщает, что блок не закрыт, и всё равно читает строки внутри", () => {
    const { statements, errors } = parseFinance(
      "```finance\nexpense t1 2026-10-20 10.00 BYN from \"Наличные\" category \"Продукты\"\n",
    );

    expect(statements).toHaveLength(1);
    expect(errors).toEqual([{ line: 1, message: "Блок finance не закрыт" }]);
  });
});

describe("validateLedger", () => {
  const directory = finance(`account "Наличные" cash BYN opening 80.00
account "Карта" bank BYN opening 400.00
account "Карта USD" bank USD opening 50.00
category "Продукты" expense
category "Стипендия" income
category "Аренда" expense`);

  it("принимает согласованные записи", () => {
    const parsed = parseFinance(
      directory +
        finance(`expense t1 2026-10-20 10.00 BYN from "Наличные" category "Продукты" "хлеб"
transfer t2 2026-10-21 50.00 BYN from "Карта" to "Наличные"
exchange t3 2026-10-21 20.00 USD from "Карта USD" to "Карта" 62.00 BYN
recurring r1 "Аренда" from "Карта" category "Аренда" 200.00 BYN day 5`),
    );

    expect(parsed.errors).toEqual([]);
    expect(validateLedger(parsed.statements)).toEqual([]);
  });

  it("оставляет остальные строки и помечает кривые ссылки", () => {
    const parsed = parseFinance(finance(`account "Наличные" cash BYN opening 80.00
account "Карта" bank BYN opening 400.00
category "Продукты" expense
category "Стипендия" income
expense t1 2026-10-20 10.00 USD from "Наличные" category "Продукты"
expense t2 2026-10-20 10.00 BYN from "Нет такого" category "Продукты"
income t3 2026-10-20 10.00 BYN to "Карта" category "Продукты"
transfer t4 2026-10-20 10.00 BYN from "Карта" to "Карта"
expense t5 2026-10-20 8.00 BYN from "Наличные" category "Продукты" "хлеб"`));

    expect(parsed.statements.filter((statement) => statement.kind === "expense")).toHaveLength(3);
    expect(validateLedger(parsed.statements)).toEqual([
      {
        line: 6,
        message: "Валюта USD не совпадает с валютой счёта «Наличные» (BYN)",
      },
      { line: 7, message: "Счёт «Нет такого» не найден" },
      { line: 8, message: "Категория «Продукты» предназначена для расхода" },
      { line: 9, message: "Перевод на тот же счёт «Карта»" },
    ]);
  });
});
