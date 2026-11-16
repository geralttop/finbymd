export const ROOT = "/home/finbymd/Деньги";

const accounts = `# Счета

Небольшая подсказка: остаток программа считает сама.

\`\`\`finance
account "Наличные" cash BYN opening 80.00
account "Карта" bank BYN opening 4000.00
account "Карта USD" bank USD opening 50.00
account "Копилка" bank BYN opening 1200.00
\`\`\`
`;

const categories = `# Категории

\`\`\`finance
category "Продукты" expense
category "Аренда" expense
category "Техника" expense
category "Транспорт" expense
category "Кафе" expense
category "Здоровье" expense
category "Подписки" expense
category "Стипендия" income
category "Зарплата" income
category "Подарки" income
\`\`\`
`;

const recurring = `# Повторы

\`\`\`finance
recurring r1 "Аренда" from "Карта" category "Аренда" 200.00 BYN day 5
recurring r2 "Подписка на музыку" from "Карта" category "Подписки" 12.50 BYN day 12
recurring r3 "Стипендия" from "Карта" category "Стипендия" 250.00 BYN day 10
recurring r4 "Интернет" from "Карта" category "Подписки" 35.00 BYN day 25
\`\`\`
`;

const september = `# Сентябрь 2026

Спокойный месяц перед покупкой телевизора.

\`\`\`finance
expense u1 2026-09-03 54.20 BYN from "Карта" category "Продукты" "продукты"
expense u2 2026-09-05 200.00 BYN from "Карта" category "Аренда" "аренда"
income u3 2026-09-10 250.00 BYN to "Карта" category "Стипендия" "стипендия"
expense u4 2026-09-14 89.00 BYN from "Карта" category "Техника" "наушники"
expense u5 2026-09-22 15.00 BYN from "Наличные" category "Кафе" "кофе" :: с коллегой
\`\`\`
`;

const october = `# Октябрь 2026

\`\`\`finance
expense t1 2026-10-02 12.40 BYN from "Наличные" category "Кафе" "кофе" :: утром по дороге
income t2 2026-10-03 250.00 BYN to "Карта" category "Стипендия" "стипендия"
expense t3 2026-10-05 200.00 BYN from "Карта" category "Аренда" "аренда" :: повтор r1
expense t4 2026-10-07 63.80 BYN from "Карта" category "Продукты" "продукты на неделю"
transfer t5 2026-10-09 100.00 BYN from "Карта" to "Наличные" :: снял в банкомате
expense t6 2026-10-12 12.50 BYN from "Карта" category "Подписки" "музыка" :: повтор r2
expense t7 2026-10-14 1000.00 BYN from "Карта" category "Техника" "телевизор" :: устал тащить его домой
exchange t8 2026-10-16 20.00 USD from "Карта USD" to "Карта" 62.00 BYN :: в банке
expense t9 2026-10-17 8.90 BYN from "Наличные" category "Транспорт" "метро"
expense t10 2026-10-18 45.20 BYN from "Карта" category "Продукты" "рынок"
income t11 2026-10-19 90.00 BYN to "Карта" category "Подарки" "подарок"
expense t12 2026-10-20 34.00 BYN from "Карта" category "Здоровье" "аптека"
expense t13 2026-10-21 7.50 BYN from "Наличные" category "Кафе" "булочка" :: к чаю
\`\`\`
`;

const debts = `# Долги

\`\`\`finance
debt d1 2026-10-04 "Андрей" 65.00 BYN to "Карта" :: скинул на карту
debt-agreed d1 2026-10-06 40.00 :: договорились вернуть меньше
debt-pay d1 2026-10-20 25.00 BYN from "Карта" :: часть вернул
debt d2 2026-10-12 "Марина" 30.00 BYN from "Наличные" :: дал до зарплаты
debt d3 2026-09-20 "Костя" 50.00 BYN to "Карта" :: за билеты
debt-pay d3 2026-09-28 50.00 BYN from "Карта"
\`\`\`
`;

const plans = `# Планы

\`\`\`finance
plan p1 "Телевизор" 1200.00 BYN due 2026-12-01 priority 1 :: давно хочу
plan p2 "Наушники" 300.00 BYN priority 2
plan p3 "Поездка" 800.00 BYN due 2026-11-20 priority 3
plan-done p4 2026-10-15
plan p4 "Клавиатура" 150.00 BYN priority 2
\`\`\`
`;

const params = new URLSearchParams(window.location.search);
const empty = params.get("empty") === "1";
const broken = params.get("broken") === "1";
const template = "```finance\n```\n";
const brokenOctober = october.replace(
  "```finance\n",
  '```finance\nexpense t99 2026-10-99 10.0 BYN from "Нет" category "Нет" "сломанная строка"\n',
);

export const files = new Map<string, string>(
  empty
    ? [
        [`${ROOT}/accounts.md`, template],
        [`${ROOT}/categories.md`, template],
        [`${ROOT}/recurring.md`, template],
        [`${ROOT}/debts.md`, template],
        [`${ROOT}/plans.md`, template],
      ]
    : [
        [`${ROOT}/accounts.md`, accounts],
        [`${ROOT}/categories.md`, categories],
        [`${ROOT}/recurring.md`, recurring],
        [`${ROOT}/debts.md`, debts],
        [`${ROOT}/plans.md`, plans],
        [`${ROOT}/transactions/2026-09.md`, september],
        [`${ROOT}/transactions/2026-10.md`, broken ? brokenOctober : october],
      ],
);

type Watcher = (event: { type: { modify: Record<string, never> }; paths: string[] }) => void;
const watchers = new Set<Watcher>();

export function subscribe(watcher: Watcher): () => void {
  watchers.add(watcher);
  return () => {
    watchers.delete(watcher);
  };
}

export function notify(): void {
  for (const watcher of watchers) {
    watcher({ type: { modify: {} }, paths: [] });
  }
}
