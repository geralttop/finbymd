import type { AccountType } from "./parse";

export { appendStatement as appendAccount } from "./fence";

export type NewAccount = {
  name: string;
  accountType: AccountType;
  currency: string;
  opening: string;
};

export function normalizeAccount(input: {
  name: string;
  accountType: string;
  currency: string;
  opening: string;
}): NewAccount | string {
  const name = input.name.trim();
  if (name.length === 0) {
    return "Введите имя счёта";
  }
  if (name.includes('"')) {
    return "В имени счёта нельзя использовать кавычки";
  }
  if (input.accountType !== "cash" && input.accountType !== "bank") {
    return "Тип счёта должен быть наличные или банк";
  }
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3,4}$/.test(currency)) {
    return "Валюта должна быть из 3 или 4 латинских букв";
  }
  const opening = normalizeOpening(input.opening);
  if (opening === null) {
    return "Начальный остаток запишите числом, не больше двух знаков после точки";
  }
  return { name, accountType: input.accountType, currency, opening };
}

export function accountLine(account: NewAccount): string {
  return `account "${account.name}" ${account.accountType} ${account.currency} opening ${account.opening}`;
}

function normalizeOpening(raw: string): string | null {
  const trimmed = raw.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return null;
  }
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > 2) {
    return null;
  }
  return `${whole}.${fraction.padEnd(2, "0")}`;
}
