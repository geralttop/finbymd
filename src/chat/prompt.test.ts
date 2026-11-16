import { describe, expect, it } from "vitest";
import type { ChatSnapshot } from "./context";
import { buildSystemPrompt } from "./prompt";

const snapshot: ChatSnapshot = {
  today: "2026-10-21",
  month: "2026-10",
  accounts: [{ name: "Карта", type: "bank", currency: "BYN", balance: "2946.50" }],
  categories: [{ name: "Продукты", kind: "expense" }],
  recurring: [],
  operations: [
    {
      id: "t1",
      kind: "expense",
      date: "2026-10-20",
      amount: "10.00",
      currency: "BYN",
      account: "Карта",
      category: "Продукты",
      title: "хлеб",
    },
  ],
  operationsTotal: 1,
  debts: [],
  plans: [],
};

describe("buildSystemPrompt", () => {
  it("includes the month, today and the snapshot", () => {
    const prompt = buildSystemPrompt(snapshot);
    expect(prompt).toContain("Selected month: 2026-10");
    expect(prompt).toContain("Today: 2026-10-21");
    expect(prompt).toContain("Карта");
    expect(prompt).toContain("t1");
  });

  it("explains how to work with debts and plans", () => {
    const prompt = buildSystemPrompt(snapshot);
    expect(prompt).toContain("Debt money movements");
    expect(prompt).toContain("change_debt");
    expect(prompt).toContain("Use edit_debt to correct");
    expect(prompt).toContain("Plans are wishes");
  });

  it("tells the model not to invent accounts or claim false success", () => {
    const prompt = buildSystemPrompt(snapshot);
    expect(prompt).toContain("Never invent an account");
    expect(prompt).toContain("Do not claim that something was saved");
    expect(prompt).toContain("answer the human in Russian");
  });
});
