import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

/**
 * Отдельная конфигурация для просмотра интерфейса в браузере.
 * Подменяет API Tauri заглушками, чтобы рисовать окно без запуска
 * Rust-оболочки: npm run preview:ui
 */
export default defineConfig({
  server: {
    port: 4173,
    strictPort: true,
    host: "127.0.0.1",
  },
  resolve: {
    alias: [
      { find: /^@tauri-apps\/api\/core$/, replacement: mock("core.ts") },
      { find: /^@tauri-apps\/api\/path$/, replacement: mock("path.ts") },
      { find: /^@tauri-apps\/api\/window$/, replacement: mock("window.ts") },
      { find: /^@tauri-apps\/plugin-dialog$/, replacement: mock("dialog.ts") },
      { find: /^@tauri-apps\/plugin-fs$/, replacement: mock("fs.ts") },
      { find: /^@tauri-apps\/plugin-http$/, replacement: mock("http.ts") },
    ],
  },
});

function mock(name: string): string {
  return fileURLToPath(new URL(`./preview/mocks/${name}`, import.meta.url));
}
