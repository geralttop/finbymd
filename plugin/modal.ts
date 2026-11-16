import { App, Modal } from "obsidian";
import { monthLabel } from "../src/finance/entry-file";
import type { ExpenseStatement, IncomeStatement } from "../src/finance/parse";
import type { Book, EditTarget, OperationInput } from "./storage";
import { addOperation, deleteOperation, editOperation } from "./storage";

export type Editable = ExpenseStatement | IncomeStatement;

type Options = {
  book: Book;
  month: string;
  date: string;
  statement?: Editable;
  file?: string;
  onSaved: (month?: string) => void;
};

export class OperationModal extends Modal {
  private kind: "expense" | "income";
  private error: HTMLElement | null = null;

  constructor(
    app: App,
    private options: Options,
  ) {
    super(app);
    this.kind = options.statement?.kind ?? "expense";
  }

  onOpen(): void {
    const { contentEl } = this;
    const statement = this.options.statement;
    contentEl.addClass("finbymd-modal");
    this.titleEl.setText(statement ? "Операция" : "Новая операция");

    const kindRow = contentEl.createDiv({ cls: "finbymd-kind" });
    const expense = kindRow.createEl("button", { text: "Расход", cls: "finbymd-kind-btn" });
    const income = kindRow.createEl("button", { text: "Доход", cls: "finbymd-kind-btn" });

    const grid = contentEl.createDiv({ cls: "finbymd-fields" });
    const date = field(grid, "Дата");
    date.type = "date";
    date.value = statement?.date ?? this.options.date;

    const amount = field(grid, "Сумма");
    amount.type = "text";
    amount.inputMode = "decimal";
    amount.placeholder = "0.00";
    amount.value = statement?.amount ?? "";

    const account = selectField(grid, "Счёт");
    for (const item of this.options.book.accounts) {
      const option = account.createEl("option", { text: `${item.name} · ${item.currency}` });
      option.value = item.name;
    }
    account.value = statement?.account ?? this.options.book.accounts[0]?.name ?? "";

    const category = selectField(grid, "Категория");
    const title = field(grid, "Заголовок");
    title.value = statement?.title ?? "";
    const description = field(grid, "Описание");
    description.value = statement?.description ?? "";

    const dateNote = contentEl.createEl("p", { cls: "finbymd-note" });
    const syncDateNote = (): void => {
      const month = date.value.slice(0, 7);
      const target = /^\d{4}-\d{2}$/.test(month) ? month : this.options.month;
      dateNote.hidden = target === this.options.month;
      if (dateNote.hidden) {
        return;
      }
      dateNote.setText(
        statement
          ? `Дата должна остаться в «${monthLabel(this.options.month)}»: месяц меняйте в файле`
          : `Операция попадёт в «${monthLabel(target)}»`,
      );
    };
    date.addEventListener("input", syncDateNote);
    syncDateNote();

    const fillCategories = (): void => {
      const previous = category.value;
      category.empty();
      const items = this.options.book.categories.filter((item) => item.categoryKind === this.kind);
      for (const item of items) {
        const option = category.createEl("option", { text: item.name });
        option.value = item.name;
      }
      const fallback = statement?.category ?? "";
      if (items.some((item) => item.name === previous)) {
        category.value = previous;
      } else if (items.some((item) => item.name === fallback)) {
        category.value = fallback;
      }
    };

    const paintKind = (): void => {
      expense.toggleClass("is-active", this.kind === "expense");
      income.toggleClass("is-active", this.kind === "income");
      fillCategories();
    };

    expense.addEventListener("click", () => {
      this.kind = "expense";
      paintKind();
    });
    income.addEventListener("click", () => {
      this.kind = "income";
      paintKind();
    });
    paintKind();

    this.error = contentEl.createEl("p", { cls: "finbymd-error" });
    this.error.hide();

    const actions = contentEl.createDiv({ cls: "finbymd-actions" });
    if (statement) {
      const remove = actions.createEl("button", { text: "Удалить", cls: "finbymd-danger" });
      remove.addEventListener("click", () => this.remove(statement));
    }
    const cancel = actions.createEl("button", { text: "Отмена" });
    cancel.addEventListener("click", () => this.close());
    const save = actions.createEl("button", { text: "Записать", cls: "mod-cta" });
    save.addEventListener("click", () => {
      void this.save({ kind: this.kind, date: date.value, amount: amount.value, account: account.value, category: category.value, title: title.value, description: description.value });
    });

    if (statement === undefined) {
      window.setTimeout(() => amount.focus(), 50);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private showError(message: string): void {
    if (!this.error) {
      return;
    }
    this.error.setText(message);
    this.error.show();
  }

  private async save(input: OperationInput): Promise<void> {
    const statement = this.options.statement;
    const error = statement
      ? await editOperation(this.app, this.options.book.folder, this.options.month, this.target(statement), input)
      : await addOperation(this.app, this.options.book.folder, this.options.month, input);
    if (error) {
      this.showError(error);
      return;
    }
    this.close();
    this.options.onSaved(statement ? this.options.month : input.date.slice(0, 7) || undefined);
  }

  private remove(statement: Editable): void {
    new ConfirmModal(this.app, "Удалить операцию? В файле останется пометка // deleted.", () => {
      void (async () => {
        const error = await deleteOperation(
          this.app,
          this.options.book.folder,
          this.options.month,
          this.target(statement),
        );
        if (error) {
          this.showError(error);
          return;
        }
        this.close();
        this.options.onSaved();
      })();
    }).open();
  }

  private target(statement: Editable): EditTarget {
    return {
      file: this.options.file ?? "",
      kind: statement.kind,
      date: statement.date,
      line: statement.line,
      id: statement.id,
    };
  }
}

class ConfirmModal extends Modal {
  constructor(
    app: App,
    private message: string,
    private onYes: () => void,
  ) {
    super(app);
  }

  onOpen(): void {
    this.contentEl.createEl("p", { text: this.message });
    const actions = this.contentEl.createDiv({ cls: "finbymd-actions" });
    const cancel = actions.createEl("button", { text: "Отмена" });
    cancel.addEventListener("click", () => this.close());
    const yes = actions.createEl("button", { text: "Удалить", cls: "finbymd-danger" });
    yes.addEventListener("click", () => {
      this.close();
      this.onYes();
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function field(parent: HTMLElement, label: string): HTMLInputElement {
  return inputField(parent, label);
}

function inputField(parent: HTMLElement, label: string): HTMLInputElement {
  const wrap = parent.createDiv({ cls: "finbymd-field" });
  wrap.createEl("label", { text: label });
  return wrap.createEl("input", { cls: "finbymd-input" });
}

function selectField(parent: HTMLElement, label: string): HTMLSelectElement {
  const wrap = parent.createDiv({ cls: "finbymd-field" });
  wrap.createEl("label", { text: label });
  return wrap.createEl("select", { cls: "finbymd-input" });
}
