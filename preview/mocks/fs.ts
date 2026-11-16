import { files, notify, ROOT, subscribe } from "../fixtures";

export type UnwatchFn = () => void;
export type WatchEvent = { type: string | { create?: unknown; modify?: unknown; remove?: unknown }; paths: string[] };

export type DirEntry = {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
};

export async function readTextFile(path: string): Promise<string> {
  const source = files.get(path);
  if (source === undefined) {
    throw new Error(`Предпросмотр: нет файла ${path}`);
  }
  return source;
}

export async function writeTextFile(path: string, contents: string | Uint8Array): Promise<void> {
  const text = typeof contents === "string" ? contents : new TextDecoder().decode(contents);
  files.set(path, text);
  notify();
}

export async function remove(path: string): Promise<void> {
  files.delete(path);
  notify();
}

export async function readDir(path: string): Promise<DirEntry[]> {
  if (path !== `${ROOT}/transactions`) {
    throw new Error(`Предпросмотр: нет каталога ${path}`);
  }
  const prefix = `${ROOT}/transactions/`;
  return [...files.keys()]
    .filter((name) => name.startsWith(prefix))
    .map((name) => ({
      name: name.slice(prefix.length),
      isFile: true,
      isDirectory: false,
      isSymlink: false,
    }));
}

export async function watch(
  _path: string,
  callback: (event: { type: { modify: Record<string, never> }; paths: string[] }) => void,
  _options?: unknown,
): Promise<UnwatchFn> {
  return subscribe(callback);
}
