import { App, PluginSettingTab, Setting } from "obsidian";
import type { ChatProvider } from "../src/chat/settings";
import type FinbymdPlugin from "./main";

export type FinbymdSettings = {
  folder: string;
  chat: {
    provider: ChatProvider;
    baseUrl: string;
    model: string;
  };
};

export class FinbymdSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: FinbymdPlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName("Папка учёта")
      .setDesc("Путь от корня хранилища: финансы или diary/финансы")
      .addText((text) =>
        text
          .setPlaceholder("финансы")
          .setValue(this.plugin.settings.folder)
          .onChange(async (value) => {
            this.plugin.settings.folder = value.trim();
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
          }),
      );
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: "Модель и ключ настраиваются в панели чата: шестерёнка в правом верхнем углу.",
    });
  }
}
