import { describe, expect, it } from "vitest";
import { interpretFiles, monthOf } from "./load";

describe("interpretFiles", () => {
  it("читает строку из файла и оставляет остальные, если одна кривая", () => {
    const { statements, errors } = interpretFiles([
      {
        file: "accounts.md",
        source: "```finance\naccount \"Наличные\" cash BYN opening 80.00\n```\n",
      },
      {
        file: "transactions/2026-10.md",
        source: `\`\`\`finance
expense t1 2026-10-20 10.00 BYN from "Наличные" category "Продукты" "хлеб"
expense t2 2026-11-01 5.00 BYN from "Наличные" category "Продукты"
\`\`\`
`,
      },
    ]);

    expect(statements.map((item) => item.statement.kind)).toEqual(["account", "expense"]);
    expect(statements[1]).toMatchObject({
      file: "transactions/2026-10.md",
      statement: { title: "хлеб", amount: "10.00" },
    });
    expect(errors).toEqual([
      {
        file: "transactions/2026-10.md",
        line: 3,
        message: "Дата 2026-11-01 не относится к месяцу 2026-10",
      },
    ]);
  });

  it("узнаёт месяц по имени файла транзакций", () => {
    expect(monthOf("transactions/2026-10.md")).toBe("2026-10");
    expect(monthOf("accounts.md")).toBeUndefined();
  });
});
