import { join } from "@tauri-apps/api/path";
import { remove, writeTextFile } from "@tauri-apps/plugin-fs";
import { readDataFolder } from "../data-folder";
import type { LoadedFile } from "../finance/load";

export type FileChange = {
  file: string;
  /** undefined means the file did not exist before the chat turn. */
  before?: string;
};

/** Сравнивает папку с состоянием до хода чата. */
export async function collectChanges(
  dir: string,
  before: LoadedFile[],
): Promise<FileChange[]> {
  const after = await readDataFolder(dir);
  const beforeMap = new Map(before.map((item) => [item.file, item.source]));
  const afterMap = new Map(after.map((item) => [item.file, item.source]));
  const files = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  const changes: FileChange[] = [];
  for (const file of files) {
    const oldSource = beforeMap.get(file);
    const newSource = afterMap.get(file);
    if (oldSource === newSource) {
      continue;
    }
    changes.push({ file, before: oldSource });
  }
  return changes;
}

/** Возвращает файлы к состоянию до хода чата. */
export async function undoChanges(dir: string, changes: FileChange[]): Promise<void> {
  for (const change of changes) {
    const path = await join(dir, ...change.file.split("/"));
    if (change.before === undefined) {
      try {
        await remove(path);
      } catch {
        // Файла уже нет — отмена считается выполненной.
      }
      continue;
    }
    await writeTextFile(path, change.before);
  }
}
