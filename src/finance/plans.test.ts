import { describe, expect, it } from "vitest";
import { parseFinance } from "./parse";
import { buildPlans, openPlans, planDoneLine, planLine, planTotals, preparePlan } from "./plans";

const source = `\`\`\`finance
${planLine({ id: "p1", title: "Телевизор", amount: "1200.00", currency: "BYN", due: "2026-12-01", priority: 1 })}
${planLine({ id: "p2", title: "Наушники", amount: "300.00", currency: "BYN", priority: 2 })}
${planDoneLine("p2", "2026-11-02")}
\`\`\`
`;

function plans() {
  const parsed = parseFinance(source);
  expect(parsed.errors).toEqual([]);
  return buildPlans(parsed.statements);
}

describe("планы", () => {
  it("читает срок, важность и отметку о выполнении", () => {
    const list = plans();
    const tv = list.find((plan) => plan.id === "p1");
    const headphones = list.find((plan) => plan.id === "p2");

    expect(tv).toMatchObject({ title: "Телевизор", amount: "1200.00", due: "2026-12-01", priority: 1 });
    expect(headphones).toMatchObject({ title: "Наушники", done: "2026-11-02" });
    expect(list.map((plan) => plan.id)).toEqual(["p1", "p2"]);
  });

  it("считает только открытые планы", () => {
    const list = plans();
    expect(openPlans(list).map((plan) => plan.id)).toEqual(["p1"]);
    expect(planTotals(list)).toEqual([{ currency: "BYN", amount: "1200.00" }]);
  });

  it("сортирует по важности, затем по сроку", () => {
    const parsed = parseFinance(`\`\`\`finance
${planLine({ id: "p1", title: "Потом", amount: "10.00", currency: "BYN", priority: 3 })}
${planLine({ id: "p2", title: "Важное", amount: "10.00", currency: "BYN", due: "2026-12-05", priority: 1 })}
${planLine({ id: "p3", title: "Обычное", amount: "10.00", currency: "BYN" })}
\`\`\`
`);
    expect(parsed.errors).toEqual([]);
    expect(buildPlans(parsed.statements).map((plan) => plan.title)).toEqual([
      "Важное",
      "Обычное",
      "Потом",
    ]);
  });
});

describe("preparePlan", () => {
  const base = {
    title: "Телевизор",
    amount: "1200",
    currency: "BYN",
    due: "",
    priority: "2",
    description: "",
    ids: ["p1", "p4"],
  };

  it("назначает следующий идентификатор и приводит сумму", () => {
    expect(preparePlan(base)).toMatchObject({ id: "p5", amount: "1200.00", priority: 2 });
  });

  it("проверяет название, сумму и срок", () => {
    expect(preparePlan({ ...base, title: "  " })).toBe("Введите название плана");
    expect(preparePlan({ ...base, amount: "0" })).toBe("Сумма должна быть больше нуля");
    expect(preparePlan({ ...base, due: "2026-02-30" })).toBe("Срок должен быть датой вида 2026-12-01");
    expect(preparePlan({ ...base, priority: "5" })).toBe("Приоритет должен быть 1, 2 или 3");
  });
});