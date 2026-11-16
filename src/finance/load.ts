import { parseFinance, type Statement } from "./parse";

export type LoadedFile = {
  file: string;
  source: string;
};

export type LoadedStatement = {
  file: string;
  statement: Statement;
};

export type LoadedError = {
  file: string;
  line: number;
  message: string;
};

export function interpretFiles(files: LoadedFile[]): {
  statements: LoadedStatement[];
  errors: LoadedError[];
} {
  const statements: LoadedStatement[] = [];
  const errors: LoadedError[] = [];

  for (const file of files) {
    const parsed = parseFinance(file.source, { month: monthOf(file.file) });
    for (const statement of parsed.statements) {
      statements.push({ file: file.file, statement });
    }
    for (const error of parsed.errors) {
      errors.push({ file: file.file, ...error });
    }
  }

  return { statements, errors };
}

export function monthOf(file: string): string | undefined {
  const name = file.startsWith("transactions/") ? file.slice("transactions/".length) : "";
  return /^(\d{4}-\d{2})\.md$/.exec(name)?.[1];
}
