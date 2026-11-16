import { readDir, readTextFile, watch, type UnwatchFn, type WatchEvent } from "@tauri-apps/plugin-fs";
import { join } from "@tauri-apps/api/path";
import type { LoadedFile } from "./finance/load";

const ROOT_FILES = ["accounts.md", "categories.md", "recurring.md"];
const OPTIONAL_FILES = ["debts.md", "plans.md"];
const EMPTY_FINANCE = "```finance\n```\n";

export async function readDataFolder(dir: string): Promise<LoadedFile[]> {
  const files: LoadedFile[] = [];
  for (const name of ROOT_FILES) {
    files.push({
      file: name,
      source: await readTextFile(await join(dir, name)),
    });
  }

  for (const name of OPTIONAL_FILES) {
    files.push({
      file: name,
      source: await readOptional(await join(dir, name)),
    });
  }

  const transactions = await join(dir, "transactions");
  const entries = await readDir(transactions);
  const names = entries
    .filter((entry) => entry.isFile && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();
  for (const name of names) {
    files.push({
      file: `transactions/${name}`,
      source: await readTextFile(await join(transactions, name)),
    });
  }
  return files;
}

async function readOptional(path: string): Promise<string> {
  try {
    return await readTextFile(path);
  } catch {
    return EMPTY_FINANCE;
  }
}

export async function watchDataFolder(dir: string, onChange: () => void): Promise<UnwatchFn> {
  return watch(
    dir,
    (event) => {
      if (contentChanged(event)) {
        onChange();
      }
    },
    { recursive: true, delayMs: 300 },
  );
}

function contentChanged(event: WatchEvent): boolean {
  const kind = event.type;
  if (kind === "any" || kind === "other") {
    return true;
  }
  if (typeof kind === "string") {
    return false;
  }
  return "create" in kind || "modify" in kind || "remove" in kind;
}
