import { describe, expect, it } from "vitest";
import {
  dayLabel,
  difference,
  formatAmount,
  formatCount,
  percent,
  plural,
  weekdayLabel,
} from "./format";

describe("formatAmount", () => {
  it("groups thousands and uses a comma", () => {
    expect(formatAmount("1234.5")).toBe("1\u00A0234,50");
    expect(formatAmount("1234567.89")).toBe("1\u00A0234\u00A0567,89");
    expect(formatAmount("0.00")).toBe("0,00");
  });

  it("keeps the sign and pads the fraction", () => {
    expect(formatAmount("-50.00")).toBe("−50,00");
    expect(formatAmount("80")).toBe("80,00");
    expect(formatAmount("7.5")).toBe("7,50");
  });
});

describe("plural", () => {
  it("declines Russian nouns", () => {
    expect(formatCount(1, ["операция", "операции", "операций"])).toBe("1 операция");
    expect(formatCount(3, ["операция", "операции", "операций"])).toBe("3 операции");
    expect(formatCount(11, ["операция", "операции", "операций"])).toBe("11 операций");
    expect(formatCount(21, ["операция", "операции", "операций"])).toBe("21 операция");
    expect(plural(12, ["счёт", "счёта", "счетов"])).toBe("счетов");
  });
});

describe("dayLabel", () => {
  const now = new Date(2026, 9, 21, 12, 0, 0);

  it("names today and yesterday", () => {
    expect(dayLabel("2026-10-21", now)).toBe("Сегодня");
    expect(dayLabel("2026-10-20", now)).toBe("Вчера");
  });

  it("writes the day and month for older dates", () => {
    expect(dayLabel("2026-10-03", now)).toBe("3 октября");
    expect(dayLabel("2025-12-31", now)).toBe("31 декабря 2025");
  });

  it("keeps broken dates as they are", () => {
    expect(dayLabel("не дата", now)).toBe("не дата");
  });
});

describe("weekdayLabel", () => {
  it("returns the Russian weekday", () => {
    expect(weekdayLabel("2026-10-21")).toBe("среда");
    expect(weekdayLabel("2026-01-01")).toBe("четверг");
  });
});

describe("difference", () => {
  it("signs the result", () => {
    expect(difference("300.00", "120.50")).toBe("+179,50");
    expect(difference("100.00", "120.50")).toBe("−20,50");
    expect(difference("10.00", "10.00")).toBe("0,00");
  });
});

describe("percent", () => {
  it("turns a part into a share of the whole", () => {
    expect(percent("25.00", "100.00")).toBe(25);
    expect(percent("1.00", "3.00")).toBe(33);
    expect(percent("5.00", "0.00")).toBe(0);
  });
});
