import { describe, expect, it } from "vitest";
import type { CategoryStatement, ExpenseStatement, IncomeStatement, Statement } from "./parse";
import { categoryHistory, monthComparison, monthInsights, monthStats } from "./stats";

describe("monthStats", () => {
  it("суммирует расход и доход по категориям и не берёт перевод", () => {
    const statements: Statement[] = [
      expense("Продукты", "10.00"),
      expense("Продукты", "25.50"),
      expense("Игры", "35.00"),
      income("Стипендия", "250.00"),
      {
        kind: "transfer",
        line: 5,
        date: "2026-10-21",
        amount: "50.00",
        currency: "BYN",
        from: "Карта",
        to: "Наличные",
      },
    ];

    expect(monthStats(statements)).toEqual([
      {
        currency: "BYN",
        income: "250.00",
        expense: "70.50",
        incomeCategories: [{ name: "Стипендия", amount: "250.00" }],
        expenseCategories: [
          { name: "Продукты", amount: "35.50" },
          { name: "Игры", amount: "35.00" },
        ],
      },
    ]);
  });
});

describe("categoryHistory", () => {
  const category: CategoryStatement = {
    kind: "category",
    line: 1,
    name: "Продукты",
    categoryKind: "expense",
  };

  it("собирает месяцы, суммы и средние по одной категории", () => {
    const history = categoryHistory(
      [
        { month: "2026-09", statement: expense("Продукты", "100.00", "2026-09-04") },
        { month: "2026-10", statement: expense("Продукты", "50.00", "2026-10-02") },
        { month: "2026-10", statement: expense("Продукты", "30.00", "2026-10-18") },
        { month: "2026-10", statement: expense("Кафе", "12.00", "2026-10-19") },
        { month: "2026-10", statement: income("Продукты", "900.00", "2026-10-20") },
      ],
      category,
    );

    expect(history.operations).toBe(3);
    expect(history.months).toBe(2);
    expect(history.totals).toEqual([{ currency: "BYN", amount: "180.00" }]);
    expect(history.perMonth).toEqual([{ currency: "BYN", amount: "90.00" }]);
    expect(history.averageCheck).toEqual([{ currency: "BYN", amount: "60.00" }]);
    expect(history.monthly).toEqual([
      { month: "2026-10", operations: 2, totals: [{ currency: "BYN", amount: "80.00" }] },
      { month: "2026-09", operations: 1, totals: [{ currency: "BYN", amount: "100.00" }] },
    ]);
    expect(history.biggest).toEqual({
      date: "2026-09-04",
      amount: "100.00",
      currency: "BYN",
    });
  });

  it("возвращает пустую историю без операций", () => {
    const history = categoryHistory([], category);

    expect(history.operations).toBe(0);
    expect(history.months).toBe(0);
    expect(history.totals).toEqual([]);
    expect(history.biggest).toBeNull();
    expect(history.monthly).toEqual([]);
  });
});

describe("monthInsights", () => {
  it("считает операции, дни, средний чек и главную категорию", () => {
    const statements: Statement[] = [
      expense("Продукты", "20.00", "2026-10-02"),
      expense("Продукты", "40.00", "2026-10-02"),
      expense("Кафе", "15.00", "2026-10-05"),
      income("Зарплата", "1000.00", "2026-10-10"),
      expense("Игры", "5.00", "2026-10-05"),
    ];

    expect(monthInsights(statements)).toEqual([
      {
        currency: "BYN",
        operations: 4,
        days: 2,
        averageCheck: "20.00",
        top: { name: "Продукты", amount: "60.00" },
        biggest: { date: "2026-10-02", title: "Продукты", amount: "40.00" },
      },
    ]);
  });
});

describe("monthComparison", () => {
  it("сравнивает расходы и категории с прошлым месяцем", () => {
    const current = monthStats([
      expense("Продукты", "150.00", "2026-10-02"),
      expense("Кафе", "50.00", "2026-10-03"),
    ]);
    const previous = monthStats([
      expense("Продукты", "100.00", "2026-09-02"),
      expense("Техника", "80.00", "2026-09-03"),
    ]);

    const [comparison] = monthComparison(current, previous);
    expect(comparison.currency).toBe("BYN");
    expect(comparison.expense).toEqual({
      current: "200.00",
      previous: "180.00",
      deltaCents: 2000,
      percent: 11.1,
    });
    expect(comparison.income).toEqual({
      current: "0.00",
      previous: "0.00",
      deltaCents: 0,
      percent: null,
    });
    expect(comparison.categories).toEqual([
      {
        name: "Техника",
        current: "0.00",
        previous: "80.00",
        deltaCents: -8000,
        percent: -100,
      },
      {
        name: "Кафе",
        current: "50.00",
        previous: "0.00",
        deltaCents: 5000,
        percent: null,
      },
      {
        name: "Продукты",
        current: "150.00",
        previous: "100.00",
        deltaCents: 5000,
        percent: 50,
      },
    ]);
  });
});

function expense(category: string, amount: string, date = "2026-10-20"): ExpenseStatement {
  return {
    kind: "expense",
    line: 1,
    date,
    amount,
    currency: "BYN",
    account: "Карта",
    category,
  };
}

function income(category: string, amount: string, date = "2026-10-01"): IncomeStatement {
  return {
    kind: "income",
    line: 2,
    date,
    amount,
    currency: "BYN",
    account: "Карта",
    category,
  };
}
