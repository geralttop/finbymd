import { icon } from "./icons";

type ToastKind = "success" | "error" | "info";

let toastStack: HTMLElement | null = null;
let openDialog: HTMLElement | null = null;

export function toast(text: string, kind: ToastKind = "success"): void {
  const stack = toastStackElement();
  while (stack.childElementCount >= 3) {
    stack.firstElementChild?.remove();
  }
  const item = document.createElement("div");
  item.className = "toast";
  item.dataset.kind = kind;
  const mark = document.createElement("span");
  mark.className = "toast-icon";
  mark.append(icon(kind === "error" ? "alert" : kind === "info" ? "info" : "check", 16));
  const label = document.createElement("span");
  label.textContent = text;
  item.append(mark, label);
  stack.append(item);
  window.setTimeout(() => item.remove(), 3000);
}

export function confirmAction(options: {
  title: string;
  text: string;
  confirmLabel?: string;
  cancelLabel?: string;
}): Promise<boolean> {
  openDialog?.remove();
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "overlay";

    const dialog = document.createElement("div");
    dialog.className = "dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "dialog-title");

    const title = document.createElement("h2");
    title.className = "dialog-title";
    title.id = "dialog-title";
    title.textContent = options.title;

    const text = document.createElement("p");
    text.className = "dialog-text";
    text.textContent = options.text;

    const actions = document.createElement("div");
    actions.className = "dialog-actions";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn ghost";
    cancel.textContent = options.cancelLabel ?? "Отмена";

    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "btn danger";
    confirm.textContent = options.confirmLabel ?? "Удалить";

    actions.append(cancel, confirm);
    dialog.append(title, text, actions);
    overlay.append(dialog);

    let settled = false;
    const close = (result: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      document.removeEventListener("keydown", onKey);
      overlay.remove();
      openDialog = null;
      resolve(result);
    };

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(false);
      }
      if (event.key === "Enter" && document.activeElement === confirm) {
        event.preventDefault();
        close(true);
      }
    };

    cancel.addEventListener("click", () => close(false));
    confirm.addEventListener("click", () => close(true));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        close(false);
      }
    });
    document.addEventListener("keydown", onKey);

    document.body.append(overlay);
    openDialog = overlay;
    cancel.focus();
  });
}

function toastStackElement(): HTMLElement {
  if (toastStack && toastStack.isConnected) {
    return toastStack;
  }
  toastStack = document.createElement("div");
  toastStack.className = "toast-stack";
  toastStack.setAttribute("role", "status");
  toastStack.setAttribute("aria-live", "polite");
  document.body.append(toastStack);
  return toastStack;
}
