const GENITIVE_MONTHS = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

const WEEKDAYS = [
  "воскресенье",
  "понедельник",
  "вторник",
  "среда",
  "четверг",
  "пятница",
  "суббота",
];

type PluralForms = readonly [one: string, few: string, many: string];

/** "1234.5" → "1 234,50", "-50.00" → "−50,00". */
export function formatAmount(value: string): string {
  const trimmed = value.trim();
  const negative = trimmed.startsWith("-");
  const unsigned = trimmed.replace(/^[-+]/, "");
  const [wholeRaw = "0", fractionRaw = ""] = unsigned.split(".");
  const whole = wholeRaw.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, "\u00A0");
  const fraction = fractionRaw.padEnd(2, "0").slice(0, 2);
  return `${negative ? "−" : ""}${whole || "0"},${fraction}`;
}

/** "1 операция", "3 операции", "11 операций". */
export function formatCount(count: number, forms: PluralForms): string {
  return `${count} ${plural(count, forms)}`;
}

export function plural(count: number, [one, few, many]: PluralForms): string {
  const mod10 = Math.abs(count) % 10;
  const mod100 = Math.abs(count) % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return one;
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return few;
  }
  return many;
}

/** "Сегодня", "Вчера" or "20 октября". */
export function dayLabel(date: string, now = new Date()): string {
  const parts = dateParts(date);
  if (!parts) {
    return date;
  }
  const today = dayNumber(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const target = dayNumber(parts.year, parts.month, parts.day);
  if (target === today) {
    return "Сегодня";
  }
  if (target === today - 1) {
    return "Вчера";
  }
  const month = GENITIVE_MONTHS[parts.month - 1] ?? "";
  const year = parts.year === now.getFullYear() ? "" : ` ${parts.year}`;
  return `${parts.day} ${month}${year}`;
}

export function weekdayLabel(date: string): string {
  const parts = dateParts(date);
  if (!parts) {
    return "";
  }
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return WEEKDAYS[weekday] ?? "";
}

/** Difference of two formatted amounts as a signed display value. */
export function difference(income: string, expense: string): string {
  const cents = Math.round(Number(income) * 100) - Math.round(Number(expense) * 100);
  const sign = cents < 0 ? "−" : cents > 0 ? "+" : "";
  return `${sign}${formatAmount((Math.abs(cents) / 100).toFixed(2))}`;
}

export function differenceCents(income: string, expense: string): number {
  return Math.round(Number(income) * 100) - Math.round(Number(expense) * 100);
}

export function signedAmount(value: string, sign: "−" | "+"): string {
  return Number(value) === 0 ? formatAmount(value) : `${sign}${formatAmount(value)}`;
}

export function percent(part: string, total: string): number {
  const totalCents = Math.round(Number(total) * 100);
  if (totalCents <= 0) {
    return 0;
  }
  return Math.round((Number(part) * 10000) / totalCents);
}

function dateParts(date: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    return null;
  }
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function dayNumber(year: number, month: number, day: number): number {
  return Math.round(Date.UTC(year, month - 1, day) / 86_400_000);
}
