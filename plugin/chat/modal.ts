import { App, Modal } from "obsidian";
import type { ChatContext, ChatPanel } from "./panel";

/** На телефоне чат открывается окном: у него есть крестик и его закрывает кнопка «назад». */
export class ChatModal extends Modal {
  private host: HTMLElement | null = null;
  private viewportHandler: (() => void) | null = null;

  constructor(
    app: App,
    private panel: ChatPanel,
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClass("finbymd-chat-shell");
    this.titleEl.setText("");
    this.contentEl.addClass("finbymd-chat-modal");
    this.host = this.contentEl.createDiv({ cls: "finbymd-chat-host finbymd-chat-host-modal" });
    this.panel.render(this.host);

    // Клавиатура на Android уменьшает visualViewport, а не layout viewport:
    // подгоняем высоту окна вручную, иначе поле ввода уезжает под клавиатуру.
    const viewport = window.visualViewport;
    if (viewport) {
      const apply = (): void => {
        const height = Math.round(viewport.height * 0.94);
        this.modalEl.style.height = `${height}px`;
        this.modalEl.style.maxHeight = `${height}px`;
      };
      apply();
      viewport.addEventListener("resize", apply);
      this.viewportHandler = apply;
    }
  }

  refresh(context: ChatContext): void {
    this.panel.setContext(context);
    if (this.host) {
      this.panel.render(this.host);
    }
  }

  isOpen(): boolean {
    return this.host !== null && this.host.isConnected;
  }

  onClose(): void {
    if (this.viewportHandler) {
      window.visualViewport?.removeEventListener("resize", this.viewportHandler);
      this.viewportHandler = null;
    }
    this.modalEl.style.height = "";
    this.modalEl.style.maxHeight = "";
    this.host = null;
    this.contentEl.empty();
  }
}
