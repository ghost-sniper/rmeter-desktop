import { copyFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = join(root, ".cache", "icons");
const desktop = join(root, "src-tauri", "icons");
const web = join(root, "public");
await mkdir(output, { recursive: true });
await mkdir(desktop, { recursive: true });
await mkdir(web, { recursive: true });

// Tauri creates the platform icon formats from the same transparent master.
// Keep mobile-only output in the cache; this project distributes desktop apps.
const result = Bun.spawnSync(
  [
    process.execPath,
    "run",
    "tauri",
    "icon",
    "assets/branding/rmeter-logo.png",
    "--output",
    output,
  ],
  { cwd: root, stdout: "inherit", stderr: "inherit" },
);
if (result.exitCode !== 0) process.exit(result.exitCode || 1);

for (const entry of await readdir(output, { withFileTypes: true })) {
  if (entry.isFile() && /\.(png|ico|icns)$/.test(entry.name)) {
    await copyFile(join(output, entry.name), join(desktop, entry.name));
  }
}
await copyFile(join(output, "128x128@2x.png"), join(web, "rmeter-logo.png"));
await copyFile(join(output, "32x32.png"), join(web, "favicon-32x32.png"));
await copyFile(join(output, "icon.ico"), join(web, "favicon.ico"));
console.log("Updated desktop icons, header logo and browser favicons.");
