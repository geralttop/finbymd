import { parseFinance } from "./parse";

export type MovementRef = {
  line: number;
  id?: string;
  kind: "expense" | "income" | "transfer" | "exchange";
  date: string;
};

export function findStatementLine(source: string, month: string, target: MovementRef): number | null {
  const found = parseFinance(source, { month }).statements.find((statement) => {
    if (statement.kind !== target.kind || !("date" in statement) || statement.date !== target.date) {
      return false;
    }
    if (target.id) {
      return statement.id === target.id;
    }
    return statement.line === target.line && !statement.id;
  });
  return found?.line ?? null;
}

export function replaceStatement(source: string, line: number, next: string): string | null {
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/);
  const index = line - 1;
  if (index < 0 || index >= lines.length || lines[index] === "") {
    return null;
  }
  lines[index] = next;
  return lines.join(newline);
}

export function retireStatement(source: string, line: number, id: string | undefined): string | null {
  if (id) {
    return replaceStatement(source, line, `// deleted ${id}`);
  }
  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/);
  const index = line - 1;
  if (index < 0 || index >= lines.length || lines[index] === "") {
    return null;
  }
  lines.splice(index, 1);
  return lines.join(newline);
}

export function retiredIds(source: string): string[] {
  const ids: string[] = [];
  for (const line of source.split(/\r?\n/)) {
    const match = /^\/\/ deleted ([A-Za-z][A-Za-z0-9_-]*)$/.exec(line.trim());
    if (match) {
      ids.push(match[1]);
    }
  }
  return ids;
}
