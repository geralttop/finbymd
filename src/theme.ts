import { icon } from "./ui/icons";

export type Brightness = "dark" | "light";
export type Palette = "neutral" | "red" | "blue" | "green";

export type Theme = {
  brightness: Brightness;
  palette: Palette;
};

const STORAGE_KEY = "finbymd.theme";

const BRIGHTNESS: { id: Brightness; label: string; iconName: "sun" | "moon" }[] = [
  { id: "light", label: "Светлая тема", iconName: "sun" },
  { id: "dark", label: "Тёмная тема", iconName: "moon" },
];

const PALETTES: { id: Palette; label: string; swatch: string }[] = [
  { id: "neutral", label: "Обычная палитра", swatch: "#b08d57" },
  { id: "red", label: "Красная палитра", swatch: "#c4554a" },
  { id: "blue", label: "Синяя палитра", swatch: "#4f7cc4" },
  { id: "green", label: "Зелёная палитра", swatch: "#4f9a74" },
];

export function readTheme(): Theme {
  const fallback: Theme = { brightness: "dark", palette: "neutral" };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return fallback;
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return fallback;
    }
    const record = parsed as Record<string, unknown>;
    const brightness = record.brightness === "light" ? "light" : "dark";
    const palette = PALETTES.find((item) => item.id === record.palette)?.id ?? "neutral";
    return { brightness, palette };
  } catch {
    return fallback;
  }
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.dataset.brightness = theme.brightness;
  root.dataset.palette = theme.palette;
  root.style.colorScheme = theme.brightness;
  void syncWindowTheme(theme.brightness);
}

export function saveTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
  } catch {
    // Запоминать не обязательно: тема применится до перезапуска.
  }
}

export function themeControl(): HTMLElement {
  let theme = readTheme();

  const wrap = document.createElement("div");
  wrap.className = "theme-control";
  wrap.setAttribute("role", "group");
  wrap.setAttribute("aria-label", "Оформление");

  const mode = document.createElement("div");
  mode.className = "segmented";
  mode.setAttribute("role", "group");
  mode.setAttribute("aria-label", "Яркость");

  const modeButtons = BRIGHTNESS.map((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "segmented-item";
    button.dataset.brightness = item.id;
    button.title = item.label;
    button.setAttribute("aria-label", item.label);
    button.append(icon(item.iconName, 15));
    button.addEventListener("click", () => {
      theme = { ...theme, brightness: item.id };
      applyTheme(theme);
      saveTheme(theme);
      sync();
    });
    return button;
  });
  mode.append(...modeButtons);

  const dots = document.createElement("div");
  dots.className = "palette-dots";
  dots.setAttribute("role", "group");
  dots.setAttribute("aria-label", "Цвет");

  const dotButtons = PALETTES.map((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "palette-dot";
    button.dataset.palette = item.id;
    button.title = item.label;
    button.setAttribute("aria-label", item.label);
    const dot = document.createElement("span");
    dot.style.background = item.swatch;
    button.append(dot);
    button.addEventListener("click", () => {
      theme = { ...theme, palette: item.id };
      applyTheme(theme);
      saveTheme(theme);
      sync();
    });
    return button;
  });
  dots.append(...dotButtons);

  const sync = (): void => {
    for (const button of modeButtons) {
      const active = button.dataset.brightness === theme.brightness;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    for (const button of dotButtons) {
      const active = button.dataset.palette === theme.palette;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  };
  sync();

  wrap.append(mode, dots);
  return wrap;
}

async function syncWindowTheme(brightness: Brightness): Promise<void> {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setTheme(brightness);
  } catch {
    // В обычном браузере и в предпросмотре окна Tauri нет.
  }
}
