import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  root: "/data",
  files: new Map<string, string>(),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: async (path: string) => {
    const source = state.files.get(path);
    if (source === undefined) {
      throw new Error(`нет файла ${path}`);
    }
    return source;
  },
  writeTextFile: async (path: string, source: string) => {
    state.files.set(path, source);
  },
  readDir: async (path: string) => {
    const prefix = `${path}/`;
    return [...state.files.keys()]
      .filter((name) => name.startsWith(prefix))
      .map((name) => ({
        name: name.slice(prefix.length),
        isFile: true,
        isDirectory: false,
        isSymlink: false,
      }));
  },
  remove: async (path: string) => {
    state.files.delete(path);
  },
}));

vi.mock("@tauri-apps/api/path", () => ({
  join: async (...parts: string[]) => parts.join("/").replace(/\/{2,}/g, "/"),
}));

vi.mock("../data-folder", () => ({
  readDataFolder: async (dir: string) => {
    const prefix = `${dir}/`;
    return [...state.files.entries()]
      .filter(([path]) => path.startsWith(prefix))
      .map(([path, source]) => ({ file: path.slice(prefix.length), source }))
      .sort((left, right) => left.file.localeCompare(right.file));
  },
}));

import {
  addExpense,
  addIncome,
  addTransfer,
  createCategory,
  createRecurring,
  deleteCategory,
  deleteOperation,
  deleteRecurring,
  addDebt,
  addPlan,
  changeDebt,
  completePlan,
  deleteDebt,
  deletePlan,
  editOperation,
  editDebt,
  forgiveDebt,
  listAccounts,
  listDebts,
  listOperations,
  listPlans,
  payDebt,
  postRecurringNow,
  renameCategory,
} from "./actions";
import { executeTool } from "../chat/tools";

const ctx = { dir: state.root, month: "2026-10" };

beforeEach(() => {
  state.files.clear();
  state.files.set(
    `${state.root}/accounts.md`,
    `\`\`\`finance
account "Наличные" cash BYN opening 80.00
account "Карта" bank BYN opening 4000.00
account "Карта USD" bank USD opening 50.00
\`\`\`
`,
  );
  state.files.set(
    `${state.root}/categories.md`,
    `\`\`\`finance
category "Продукты" expense
category "Кафе" expense
category "Техника" expense
category "Аренда" expense
category "Стипендия" income
\`\`\`
`,
  );
  state.files.set(
    `${state.root}/recurring.md`,
    `\`\`\`finance
recurring r1 "Аренда" from "Карта" category "Аренда" 200.00 BYN day 5
\`\`\`
`,
  );
  state.files.set(`${state.root}/transactions/2026-10.md`, "```finance\n```\n");
});

describe("ledger actions", () => {
  it("ИИ исправляет исходную запись долга, сохраняя id и возвраты", async () => {
    await addDebt(ctx, { person: "Ошибка", amount: "65", account: "Карта", direction: "from", date: "2026-09-01", description: "старое" });
    await payDebt(ctx, { id: "d1", amount: "20", date: "2026-09-05" });
    const result = await executeTool("edit_debt", {
      id: "d1", person: "Андрей", amount: "80", account: "Наличные", date: "2026-08-30", description: "",
    }, ctx);
    expect(result).toContain("Долг изменён");
    const debts = await listDebts(ctx);
    expect(debts.ok && debts.data[0]).toMatchObject({
      id: "d1", person: "Андрей", principal: "80.00", remaining: "60.00", paid: "20.00", account: "Наличные", opened: "2026-08-30",
    });
    const source = state.files.get(`${state.root}/debts.md`)!;
    expect(source).not.toContain("старое");
    expect(source.match(/^debt /gm)).toHaveLength(1);
    expect(source).toContain('debt-pay d1 2026-09-05 20.00 BYN to "Карта"');
    const accounts = await listAccounts(ctx);
    expect(accounts.ok && accounts.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Карта", balance: "4020.00" }),
      expect.objectContaining({ name: "Наличные", balance: "0.00" }),
    ]));
  });

  it("исправляет направление долга вместе с возвратами и сохраняет договорённости", async () => {
    await addDebt(ctx, { person: "Андрей", amount: "65", account: "Карта", direction: "from", date: "2026-09-01" });
    await changeDebt(ctx, { id: "d1", amount: "50", date: "2026-09-02" });
    await payDebt(ctx, { id: "d1", amount: "20", date: "2026-09-05" });
    const result = await editDebt(ctx, { id: "d1", direction: "to", amount: "70" });
    expect(result).toMatchObject({ ok: true, data: { direction: "owe", principal: "70.00", agreed: "50.00", paid: "20.00", remaining: "30.00" } });
    expect(state.files.get(`${state.root}/debts.md`)).toContain('debt-pay d1 2026-09-05 20.00 BYN from "Карта"');
    const accounts = await listAccounts(ctx);
    expect(accounts.ok && accounts.data.find((item) => item.name === "Карта")?.balance).toBe("4050.00");
  });

  it("позволяет исправить имя у закрытого долга", async () => {
    await addDebt(ctx, { person: "Ошибка", amount: "65", account: "Карта", direction: "to", date: "2026-09-01" });
    await payDebt(ctx, { id: "d1", amount: "65", date: "2026-09-05" });
    expect(await editDebt(ctx, { id: "d1", person: "Андрей" })).toMatchObject({ ok: true, data: { person: "Андрей", status: "closed", paid: "65.00" } });
  });

  it("отклоняет некорректную правку долга без изменения файлов", async () => {
    await addDebt(ctx, { person: "Андрей", amount: "65", account: "Карта", direction: "to", date: "2026-09-01" });
    await payDebt(ctx, { id: "d1", amount: "20", date: "2026-09-05" });
    const before = [...state.files.entries()];
    for (const input of [
      { id: "d404", person: "Кто-то" }, { id: "d1" },
      { id: "d1", person: "" }, { id: "d1", amount: "abc" },
      { id: "d1", account: "Нет счёта" }, { id: "d1", account: "Карта USD" },
      { id: "d1", direction: "owe" }, { id: "d1", date: "2026-02-30" },
      { id: "d1", date: "2026-09-06" }, { id: "d1", description: "строка\nстрока" },
    ]) {
      expect(await editDebt(ctx, input)).toMatchObject({ ok: false });
      expect([...state.files.entries()]).toEqual(before);
    }
    expect(await executeTool("edit_debt", { id: "d1", amount: 10 }, ctx)).toContain("Ошибка");
    expect(await executeTool("edit_debt", { person: "Андрей" }, ctx)).toContain("Ошибка");
    expect([...state.files.entries()]).toEqual(before);
  });

  it("reads accounts with balances", async () => {
    const result = await listAccounts(ctx);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.data).toEqual([
      { name: "Наличные", type: "cash", currency: "BYN", opening: "80.00", balance: "80.00" },
      { name: "Карта", type: "bank", currency: "BYN", opening: "4000.00", balance: "4000.00" },
      { name: "Карта USD", type: "bank", currency: "USD", opening: "50.00", balance: "50.00" },
    ]);
  });

  it("adds, edits and deletes an expense", async () => {
    const added = await addExpense(ctx, {
      amount: "10.00",
      account: "Карта",
      category: "Продукты",
      title: "хлеб",
    });
    expect(added.ok).toBe(true);
    expect(added.ok && added.data.id).toBe("t1");
    expect(state.files.get(`${state.root}/transactions/2026-10.md`)).toContain(
      'expense t1 2026-10-',
    );

    const edited = await editOperation(ctx, { id: "t1", amount: "12.50", title: "хлеб и молоко" });
    expect(edited.ok).toBe(true);
    const editedSource = state.files.get(`${state.root}/transactions/2026-10.md`) ?? "";
    expect(editedSource).toContain('12.50 BYN');
    expect(editedSource).toContain('"хлеб и молоко"');
    expect(editedSource.match(/expense t1 /g)).toHaveLength(1);

    const removed = await deleteOperation(ctx, { id: "t1" });
    expect(removed.ok).toBe(true);
    expect(state.files.get(`${state.root}/transactions/2026-10.md`)).toContain("// deleted t1");
    const operations = await listOperations(ctx);
    expect(operations.ok && operations.data).toHaveLength(0);
  });

  it("adds an income and updates the balance", async () => {
    const added = await addIncome(ctx, {
      amount: "250.00",
      account: "Карта",
      category: "Стипендия",
      title: "стипендия",
    });
    expect(added.ok).toBe(true);
    const accounts = await listAccounts(ctx);
    expect(accounts.ok && accounts.data[1].balance).toBe("4250.00");
  });

  it("adds transfers and exchanges", async () => {
    const transfer = await addTransfer(ctx, {
      from: "Карта",
      to: "Наличные",
      amount: "100.00",
    });
    expect(transfer.ok).toBe(true);
    expect(transfer.ok && transfer.data.kind).toBe("transfer");

    const exchange = await addTransfer(ctx, {
      from: "Карта USD",
      to: "Карта",
      amount: "20.00",
      toAmount: "62.00",
    });
    expect(exchange.ok).toBe(true);
    expect(exchange.ok && exchange.data.kind).toBe("exchange");
    const source = state.files.get(`${state.root}/transactions/2026-10.md`) ?? "";
    expect(source).toContain("exchange");
    expect(source).toContain('20.00 USD from "Карта USD" to "Карта" 62.00 BYN');
  });

  it("renames a category and its references", async () => {
    await addExpense(ctx, {
      amount: "10.00",
      account: "Карта",
      category: "Продукты",
      title: "хлеб",
    });
    const renamed = await renameCategory(ctx, { name: "Продукты", newName: "Еда" });
    expect(renamed.ok).toBe(true);
    expect(state.files.get(`${state.root}/categories.md`)).toContain('category "Еда" expense');
    expect(state.files.get(`${state.root}/transactions/2026-10.md`)).toContain('category "Еда"');
  });

  it("refuses to delete a used category without a replacement", async () => {
    await addExpense(ctx, {
      amount: "10.00",
      account: "Карта",
      category: "Продукты",
      title: "хлеб",
    });
    const failed = await deleteCategory(ctx, { name: "Продукты" });
    expect(failed.ok).toBe(false);
  });

  it("deletes a used category with a replacement", async () => {
    await addExpense(ctx, {
      amount: "10.00",
      account: "Карта",
      category: "Продукты",
      title: "хлеб",
    });
    const failed = await deleteCategory(ctx, { name: "Продукты", replacement: "Кафе" });
    expect(failed.ok).toBe(true);
    expect(state.files.get(`${state.root}/categories.md`)).not.toContain('category "Продукты"');
    expect(state.files.get(`${state.root}/transactions/2026-10.md`)).toContain('category "Кафе"');
  });

  it("creates and posts a recurring payment only once", async () => {
    const created = await createRecurring(ctx, {
      name: "Кофе",
      account: "Карта",
      category: "Кафе",
      amount: "100.00",
      day: "5",
    });
    expect(created.ok).toBe(true);
    expect(created.ok && created.data.id).toBe("r2");

    const posted = await postRecurringNow(ctx, { id: "r2" });
    expect(posted.ok).toBe(true);
    const source = state.files.get(`${state.root}/transactions/2026-10.md`) ?? "";
    expect(source).toContain(":: повтор r2");

    const again = await postRecurringNow(ctx, { id: "r2" });
    expect(again.ok).toBe(false);
  });

  it("creates a category and deletes a recurring payment", async () => {
    const created = await createCategory(ctx, { name: "Подписки", kind: "expense" });
    expect(created.ok).toBe(true);
    const removed = await deleteRecurring(ctx, { id: "r1" });
    expect(removed.ok).toBe(true);
    expect(state.files.get(`${state.root}/recurring.md`)).toContain("// deleted r1");
  });

  it("ведёт долг: берёт 65, договаривается на 40, возвращает и прощает", async () => {
    const added = await addDebt(ctx, {
      person: "Андрей",
      amount: "65.00",
      account: "Карта",
      direction: "to",
      date: "2026-10-04",
    });
    expect(added.ok).toBe(true);
    if (!added.ok) {
      return;
    }
    expect(added.data).toMatchObject({ id: "d1", remaining: "65.00", status: "open" });

    const changed = await changeDebt(ctx, { id: "d1", amount: "40.00", date: "2026-10-06" });
    expect(changed.ok).toBe(true);
    const paid = await payDebt(ctx, {
      id: "d1",
      amount: "25.00",
      account: "Наличные",
      date: "2026-10-20",
    });
    expect(paid.ok).toBe(true);
    const forgiven = await forgiveDebt(ctx, { id: "d1", date: "2026-10-21" });
    expect(forgiven.ok).toBe(true);

    const debts = await listDebts(ctx);
    expect(debts.ok).toBe(true);
    if (debts.ok) {
      expect(debts.data[0]).toMatchObject({
        person: "Андрей",
        direction: "owe",
        principal: "65.00",
        agreed: "40.00",
        paid: "25.00",
        forgiven: "40.00",
        remaining: "0.00",
        status: "closed",
      });
    }

    const accounts = await listAccounts(ctx);
    expect(accounts.ok).toBe(true);
    if (accounts.ok) {
      expect(accounts.data.find((item) => item.name === "Карта")?.balance).toBe("4065.00");
      expect(accounts.data.find((item) => item.name === "Наличные")?.balance).toBe("55.00");
    }
  });

  it("даёт в долг и удаляет ошибочный долг вместе с движениями", async () => {
    const added = await addDebt(ctx, {
      person: "Марина",
      amount: "30.00",
      account: "Наличные",
      direction: "from",
      date: "2026-10-12",
    });
    expect(added.ok).toBe(true);
    if (!added.ok) {
      return;
    }
    expect(added.data).toMatchObject({ direction: "owed", remaining: "30.00" });

    const removed = await deleteDebt(ctx, { id: added.data.id });
    expect(removed.ok).toBe(true);
    const accounts = await listAccounts(ctx);
    if (accounts.ok) {
      expect(accounts.data.find((item) => item.name === "Наличные")?.balance).toBe("80.00");
    }
  });

  it("ИИ вызывает инструменты долгов и планов", async () => {
    const added = await executeTool(
      "add_debt",
      { person: "Андрей", amount: "65", account: "Карта", direction: "to", date: "2026-10-04" },
      ctx,
    );
    expect(added).toContain("Долг");

    const paid = await executeTool("pay_debt", { id: "d1", amount: "25.00" }, ctx);
    expect(paid).toContain("Возврат записан");

    const debts = await executeTool("list_debts", {}, ctx);
    expect(debts).toContain("\"remaining\":\"40.00\"");

    const plan = await executeTool(
      "add_plan",
      { title: "Телевизор", amount: "1200", currency: "BYN", priority: "1" },
      ctx,
    );
    expect(plan).toContain("План «Телевизор» добавлен");

    const completed = await executeTool("complete_plan", { id: "p1" }, ctx);
    expect(completed).toContain("выполненным");
  });

  it("добавляет, выполняет и удаляет план", async () => {
    const added = await addPlan(ctx, {
      title: "Телевизор",
      amount: "1200",
      currency: "BYN",
      due: "2026-12-01",
      priority: "1",
    });
    expect(added.ok).toBe(true);
    if (!added.ok) {
      return;
    }
    const plans = await listPlans(ctx);
    expect(plans.ok).toBe(true);
    if (plans.ok) {
      expect(plans.data[0]).toMatchObject({ id: added.data.id, amount: "1200.00", priority: 1 });
    }

    const done = await completePlan(ctx, { id: added.data.id, date: "2026-10-21" });
    expect(done.ok).toBe(true);
    const removed = await deletePlan(ctx, { id: added.data.id });
    expect(removed.ok).toBe(true);
    expect(state.files.get(`${state.root}/plans.md`)).not.toContain("Телевизор");
  });
});
