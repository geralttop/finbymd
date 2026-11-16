import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS } from "./constants";
import type { FinbymdSettings } from "./settings";
import { FinbymdSettingTab } from "./settings";
import { FinbymdView, VIEW_TYPE } from "./view";

export default class FinbymdPlugin extends Plugin {
  settings: FinbymdSettings = { ...DEFAULT_SETTINGS };

  async onload(): Promise<void> {
    await this.loadSettings();
    this.registerView(VIEW_TYPE, (leaf) => new FinbymdView(leaf, this));
    this.addRibbonIcon("wallet", "finbymd: журнал", () => void this.openView());
    this.addCommand({
      id: "open-journal",
      name: "Открыть журнал",
      callback: () => void this.openView(),
    });
    this.addSettingTab(new FinbymdSettingTab(this.app, this));
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  async openView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (existing) {
      await this.app.workspace.revealLeaf(existing);
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }

  refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof FinbymdView) {
        void leaf.view.refresh();
      }
    }
  }

  async loadSettings(): Promise<void> {
    const saved = (await this.loadData()) as Partial<FinbymdSettings> | null;
    this.settings = {
      folder: saved?.folder ?? DEFAULT_SETTINGS.folder,
      chat: { ...DEFAULT_SETTINGS.chat, ...(saved?.chat ?? {}) },
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
