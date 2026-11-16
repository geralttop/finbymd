import type { CategoryKind } from "./parse";

export type NewCategory = {
  name: string;
  categoryKind: CategoryKind;
};

export function normalizeCategory(input: {
  name: string;
  categoryKind: string;
}): NewCategory | string {
  const name = input.name.trim();
  if (name.length === 0) {
    return "Введите имя категории";
  }
  if (name.includes('"')) {
    return "В имени категории нельзя использовать кавычки";
  }
  if (/[\r\n]/.test(name)) {
    return "Имя категории должно быть в одну строку";
  }
  if (input.categoryKind !== "expense" && input.categoryKind !== "income") {
    return "Вид категории должен быть expense или income";
  }
  return { name, categoryKind: input.categoryKind };
}

export function categoryLine(category: NewCategory): string {
  return `category "${category.name}" ${category.categoryKind}`;
}
