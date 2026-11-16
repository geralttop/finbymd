import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => {
  class TFile {
    constructor(public path: string) {}
    get name(): string {
      return this.path.split("/").pop() ?? "";
    }
    get extension(): string {
      const name = this.name;
      return name.includes(".") ? name.split(".").pop() ?? "" : "";
    }
  }
  class TFolder {
    constructor(
      public path: string,
      public children: unknown[] = [],
    ) {}
  }
  const normalizePath = (value: string): string =>
    value.replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
  return { TFile, TFolder, normalizePath };
});

import type { App } from "obsidian";
import { TFile, TFolder, normalizePath } from "obsidian";
import {
  addOperation,
  deleteOperation,
  editOperation,
  loadBook,
  type OperationInput,
} from "./storage";

const MockFile = TFile as unknown as new (path: string) => TFile;
const MockFolder = TFolder as unknown as new (path: string, children: unknown[]) => TFolder;

function makeApp(store: Map<string, string>): App {
  const folders = new Set<string>([""]);
  const remember = (path: string): void => {
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      folders.add(parts.slice(0, index).join("/"));
    }
  };
  for (const path of store.keys()) {
    remember(path);
  }

  const folder = (path: string): TFolder => {
    const prefix = path === "" ? "" : `${path}/`;
    const children: unknown[] = [];
    for (const key of store.keys()) {
      const rest = key.slice(prefix.length);
      if (key.startsWith(prefix) && rest.length > 0 && !rest.includes("/")) {
        children.push(new MockFile(key));
      }
    }
    for (const key of folders) {
      const rest = key.slice(prefix.length);
      if (key !== path && key.startsWith(prefix) && rest.length > 0 && !rest.includes("/")) {
        children.push(folder(key));
      }
    }
    return new MockFolder(path, children);
  };

  const vault = {
    getAbstractFileByPath(path: string) {
      const clean = normalizePath(path);
      if (store.has(clean)) {
        return new MockFile(clean);
      }
      if (folders.has(clean)) {
        return folder(clean);
      }
      return null;
    },
    async read(file: TFile) {
      return store.get(file.path) ?? "";
    },
    async process(file: TFile, mutate: (data: string) => string) {
      const current = store.get(file.path);
      if (current === undefined) {
        throw new Error(`нет файла ${file.path}`);
      }
      const next = mutate(current);
      store.set(file.path, next);
      return next;
    },
    async create(path: string, data: string) {
      store.set(path, data);
      remember(path);
      return new MockFile(path);
    },
    async createFolder(path: string) {
      folders.add(path);
    },
  };

  return { vault } as unknown as App;
}

const ACCOUNTS = [
  "```finance",
  'account "Наличные" cash BYN opening 40.51',
  'account "Карта" bank BYN opening 141.66',
  "```",
  "",
].join("\n");
const CATEGORIES = ["```finance", 'category "Кафе" expense', 'category "Находка" income', "```", ""].join("\n");
const OCTOBER = [
  "```finance",
  'expense t1 2026-10-21 5.00 BYN from "Наличные" category "Кафе" "билет"',
  "```",
  "",
].join("\n");

function input(overrides: Partial<OperationInput> = {}): OperationInput {
  return {
    kind: "expense",
    date: "2026-10-28",
    amount: "7.50",
    account: "Карта",
    category: "Кафе",
    title: "булочка",
    description: "",
    ...overrides,
  };
}

function seed(): Map<string, string> {
  return new Map([
    ["финансы/accounts.md", ACCOUNTS],
    ["финансы/categories.md", CATEGORIES],
    ["финансы/transactions/2026-10.md", OCTOBER],
  ]);
}

describe("storage", () => {
  let store: Map<string, string>;
  let app: App;

  beforeEach(() => {
    store = seed();
    app = makeApp(store);
  });

  it("читает счета, категории и операции", async () => {
    const book = await loadBook(app, "финансы");
    expect(book.files.map((file) => file.file)).toEqual([
      "accounts.md",
      "categories.md",
      "transactions/2026-10.md",
    ]);
    expect(book.accounts).toHaveLength(2);
    expect(book.categories).toHaveLength(2);
    expect(book.statements).toHaveLength(5);
    expect(book.errors).toEqual([]);
    expect(book.conflicts).toEqual([]);
  });

  it("дописывает операцию в файл месяца", async () => {
    expect(await addOperation(app, "финансы", "2026-10", input())).toBeNull();
    const text = store.get("финансы/transactions/2026-10.md") ?? "";
    expect(text).toContain('expense t2 2026-10-28 7.50 BYN from "Карта" category "Кафе" "булочка"');
    const book = await loadBook(app, "финансы");
    expect(book.errors).toEqual([]);
  });

  it("создаёт файл месяца, если его нет", async () => {
    expect(await addOperation(app, "финансы", "2026-11", input({ date: "2026-11-02" }))).toBeNull();
    const text = store.get("финансы/transactions/2026-11.md") ?? "";
    expect(text.startsWith("```finance")).toBe(true);
    expect(text).toContain('expense t2 2026-11-02 7.50 BYN from "Карта" category "Кафе"');
    const book = await loadBook(app, "финансы");
    expect(book.errors).toEqual([]);
  });

  it("не даёт записать операцию, если сумма кривая", async () => {
    const error = await addOperation(app, "финансы", "2026-10", input({ amount: "7,555" }));
    expect(error).toBeTruthy();
    expect(store.get("финансы/transactions/2026-10.md")).toBe(OCTOBER);
  });

  it("отказывается писать в файл с маркерами конфликта", async () => {
    const conflicted = [OCTOBER, "<<<<<<< HEAD", "```", ""].join("\n");
    store.set("финансы/transactions/2026-10.md", conflicted);
    const book = await loadBook(app, "финансы");
    expect(book.conflicts).toEqual(["transactions/2026-10.md"]);
    expect(book.statements.every((item) => item.file !== "transactions/2026-10.md")).toBe(true);
    const error = await addOperation(app, "финансы", "2026-10", input());
    expect(error).toContain("конфликт");
  });

  it("удаляет операцию пометкой // deleted", async () => {
    const error = await deleteOperation(app, "финансы", "2026-10", {
      file: "transactions/2026-10.md",
      kind: "expense",
      date: "2026-10-21",
      line: 2,
      id: "t1",
    });
    expect(error).toBeNull();
    const text = store.get("финансы/transactions/2026-10.md") ?? "";
    expect(text).toContain("// deleted t1");
    const book = await loadBook(app, "финансы");
    expect(book.statements.filter((item) => item.statement.kind === "expense")).toHaveLength(0);
  });

  it("правит сумму операции", async () => {
    const error = await editOperation(
      app,
      "финансы",
      "2026-10",
      { file: "transactions/2026-10.md", kind: "expense", date: "2026-10-21", line: 2, id: "t1" },
      input({ date: "2026-10-21", amount: "9.99", title: "билет" }),
    );
    expect(error).toBeNull();
    const text = store.get("финансы/transactions/2026-10.md") ?? "";
    expect(text).toContain("expense t1 2026-10-21 9.99 BYN");
    expect(text).not.toContain("5.00 BYN");
  });

  it("не трогает файл, когда операция не найдена", async () => {
    const error = await deleteOperation(app, "финансы", "2026-10", {
      file: "transactions/2026-10.md",
      kind: "expense",
      date: "2026-10-21",
      line: 2,
      id: "t99",
    });
    expect(error).toBeTruthy();
    expect(store.get("финансы/transactions/2026-10.md")).toBe(OCTOBER);
  });

  it("находит папку, даже если она вложена в хранилище", async () => {
    const nested = new Map<string, string>();
    for (const [key, value] of store) {
      nested.set(key.replace("финансы/", "diary/финансы/"), value);
    }
    const nestedApp = makeApp(nested);
    const book = await loadBook(nestedApp, "diary/финансы");
    expect(book.accounts).toHaveLength(2);
    expect(normalizePath("diary//финансы")).toBe("diary/финансы");
  });
});
