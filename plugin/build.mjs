import { build } from "esbuild";
import { cp, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "dist", "plugin");
const deploy = process.argv.includes("--deploy");

await mkdir(outDir, { recursive: true });

await build({
  entryPoints: [path.join(root, "plugin", "main.ts")],
  bundle: true,
  external: ["obsidian"],
  format: "cjs",
  target: "es2020",
  platform: "browser",
  outfile: path.join(outDir, "main.js"),
  logLevel: "info",
  sourcemap: false,
  legalComments: "none",
});

for (const name of ["manifest.json", "styles.css"]) {
  await cp(path.join(root, "plugin", name), path.join(outDir, name));
}

if (deploy) {
  const vault = process.env.OBSIDIAN_VAULT ?? path.join(homedir(), "my_folder", "obsidian");
  const target =
    process.env.OBSIDIAN_PLUGIN_DIR ?? path.join(vault, "diary", ".obsidian", "plugins", "finbymd");
  await mkdir(target, { recursive: true });
  for (const name of ["main.js", "manifest.json", "styles.css"]) {
    await cp(path.join(outDir, name), path.join(target, name));
  }
  console.log(`плагин скопирован в ${target}`);
}
