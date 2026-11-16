import type { App } from "obsidian";
import { TFile, TFolder, normalizePath } from "obsidian";
import { appendStatement } from "../src/finance/fence";
import {
  movementLine,
  prepareEdit,
  prepareMovement,
  todayDate,
  type MovementKind,
  type NewMovement,
} from "../src/finance/entry-file";
import {
  findStatementLine,
  replaceStatement,
  retireStatement,
  retiredIds,
  type MovementRef,
} from "../src/finance/edit-line";
import {
  interpretFiles,
  type LoadedError,
  type LoadedFile,
  type LoadedStatement,
} from "../src/finance/load";
import type {
  AccountStatement,
  CategoryStatement,
  Statement,
} from "../src/finance/parse";

export const ROOT_FILES = ["accounts.md", "categories.md", "recurring.md"] as const;
const EXTRA_FILES = ["debts.md", "plans.md"] as const;

/** Служебные строки, которые git пишет в файл, когда не смог слить версии. */
const CONFLICT_LINE = /^(<<<<<<<|=======|>>>>>>>)(\s|$)/;

export type Book = {
  folder: string;
  files: LoadedFile[];
  /** Файлы с маркерами конфликта: их не считаем, но показываем. */
  conflicts: string[];
  statements: LoadedStatement[];
  errors: LoadedError[];
  accounts: AccountStatement[];
  categories: CategoryStatement[];
};

export type OperationInput = {
  kind: MovementKind;
  date: string;
  amount: string;
  account: string;
  category: string;
  title: string;
  description: string;
};

export type EditTarget = {
  file: string;
  kind: MovementRef["kind"];
  date: string;
  line: number;
  id?: string;
};

export function dataFolder(path: string): string {
  const trimmed = path.trim().replace(/^\/+|\/+$/g, "");
  return normalizePath(trimmed.length > 0 ? trimmed : "финансы");
}

export function monthPath(folder: string, month: string): string {
  return normalizePath(`${folder}/transactions/${month}.md`);
}

export function hasConflictMarkers(source: string): boolean {
  return source.split(/\r?\n/).some((line) => CONFLICT_LINE.test(line));
}

export async function loadBook(app: App, folder: string): Promise<Book> {
  const base = dataFolder(folder);
  const files: LoadedFile[] = [];
  const conflicts: string[] = [];

  const push = (name: string, source: string): void => {
    if (hasConflictMarkers(source)) {
      conflicts.push(name);
      return;
    }
    files.push({ file: name, source });
  };

  for (const name of ROOT_FILES) {
    const source = await readIfExists(app, `${base}/${name}`);
    if (source !== null) {
      push(name, source);
    }
  }

  // Долги и планы читаем, чтобы остатки на счетах совпадали с приложением.
  for (const name of EXTRA_FILES) {
    const source = await readIfExists(app, `${base}/${name}`);
    if (source !== null) {
      push(name, source);
    }
  }

  const transactions = app.vault.getAbstractFileByPath(normalizePath(`${base}/transactions`));
  if (transactions instanceof TFolder) {
    const names = transactions.children
      .filter((child): child is TFile => child instanceof TFile && child.extension === "md")
      .map((child) => child.name)
      .sort();
    for (const name of names) {
      const source = await readIfExists(app, `${base}/transactions/${name}`);
      if (source !== null) {
        push(`transactions/${name}`, source);
      }
    }
  }

  const { statements, errors } = interpretFiles(files);
  const plain = statements.map((item) => item.statement);
  return {
    folder: base,
    files,
    conflicts,
    statements,
    errors,
    accounts: plain.filter((item): item is AccountStatement => item.kind === "account"),
    categories: plain.filter((item): item is CategoryStatement => item.kind === "category"),
  };
}

export async function addOperation(
  app: App,
  folder: string,
  month: string,
  input: OperationInput,
): Promise<string | null> {
  const book = await loadBook(app, folder);
  const blocked = conflictMessage(book);
  if (blocked) {
    return blocked;
  }
  const date = input.date.trim().length > 0 ? input.date.trim() : todayDate();
  const targetMonth = /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : month;
  const movement = prepareMovement({
    ...input,
    date,
    month: targetMonth,
    accounts: book.accounts,
    categories: book.categories,
    ids: usedIds(book),
  });
  if (typeof movement === "string") {
    return movement;
  }
  await writeMonth(app, book.folder, targetMonth, (source) =>
    appendStatement(source, movementLine(movement)),
  );
  return null;
}

export async function editOperation(
  app: App,
  folder: string,
  month: string,
  target: EditTarget,
  input: OperationInput,
): Promise<string | null> {
  const book = await loadBook(app, folder);
  const blocked = conflictMessage(book);
  if (blocked) {
    return blocked;
  }
  if (target.kind !== "expense" && target.kind !== "income") {
    return "Переводы и обмены пока не редактируются в плагине";
  }
  const movement = prepareEdit({
    kind: input.kind,
    id: target.id,
    date: target.date,
    amount: input.amount,
    account: input.account,
    category: input.category,
    title: input.title,
    description: input.description,
    month,
    accounts: book.accounts,
    categories: book.categories,
  });
  if (typeof movement === "string") {
    return movement;
  }
  return replaceInMonth(app, book.folder, month, target, (source, line) =>
    replaceStatement(source, line, movementLine(movement)),
  );
}

export async function deleteOperation(
  app: App,
  folder: string,
  month: string,
  target: EditTarget,
): Promise<string | null> {
  const book = await loadBook(app, folder);
  const blocked = conflictMessage(book);
  if (blocked) {
    return blocked;
  }
  return replaceInMonth(app, book.folder, month, target, (source, line) =>
    retireStatement(source, line, target.id),
  );
}

export function monthOperations(statements: Statement[]): Statement[] {
  return statements.filter(
    (item: Statement) =>
      item.kind === "expense" ||
      item.kind === "income" ||
      item.kind === "transfer" ||
      item.kind === "exchange",
  );
}

function usedIds(book: Book): string[] {
  const ids: string[] = [];
  for (const item of book.statements) {
    if ("id" in item.statement && item.statement.id) {
      ids.push(item.statement.id);
    }
  }
  for (const file of book.files) {
    ids.push(...retiredIds(file.source));
  }
  return ids;
}

function conflictMessage(book: Book): string | null {
  if (book.conflicts.length === 0) {
    return null;
  }
  return `В файлах есть конфликт git: ${book.conflicts.join(", ")}. Разбери его в тексте, потом записывай.`;
}

async function readIfExists(app: App, path: string): Promise<string | null> {
  const file = app.vault.getAbstractFileByPath(normalizePath(path));
  if (file instanceof TFile) {
    return app.vault.read(file);
  }
  return null;
}

async function writeMonth(
  app: App,
  folder: string,
  month: string,
  mutate: (source: string) => string,
): Promise<void> {
  const path = monthPath(folder, month);
  const file = app.vault.getAbstractFileByPath(path);
  if (file instanceof TFile) {
    await app.vault.process(file, mutate);
    return;
  }
  await ensureFolders(app, `${folder}/transactions`);
  await app.vault.create(path, mutate(""));
}

async function replaceInMonth(
  app: App,
  folder: string,
  month: string,
  target: EditTarget,
  rewrite: (source: string, line: number) => string | null,
): Promise<string | null> {
  const path = monthPath(folder, month);
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) {
    return "Файл месяца не найден";
  }
  let failure: string | null = null;
  await app.vault.process(file, (source) => {
    const line = findStatementLine(source, month, target);
    if (line === null) {
      failure = "Строка уже изменилась. Открой журнал заново.";
      return source;
    }
    const next = rewrite(source, line);
    if (next === null) {
      failure = "Строка уже изменилась. Открой журнал заново.";
      return source;
    }
    return next;
  });
  return failure;
}

async function ensureFolders(app: App, path: string): Promise<void> {
  const parts = normalizePath(path).split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current.length > 0 ? `${current}/${part}` : part;
    if (app.vault.getAbstractFileByPath(current) === null) {
      await app.vault.createFolder(current);
    }
  }
}

export type { NewMovement };
