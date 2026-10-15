import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const browser = process.argv[2];
if (browser !== "chrome" && browser !== "firefox") {
  throw new Error("Choose a build target: chrome or firefox.");
}

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = path.join(projectRoot, "dist", browser);

await rm(outputRoot, { recursive: true, force: true });
await mkdir(path.join(outputRoot, "content"), { recursive: true });
await mkdir(path.join(outputRoot, "popup"), { recursive: true });
await mkdir(path.join(outputRoot, "icons"), { recursive: true });

await build({
  entryPoints: {
    "background": path.join(projectRoot, "src/background.ts"),
    "content/index": path.join(projectRoot, "src/content/index.ts"),
    "popup/popup": path.join(projectRoot, "src/popup/popup.ts")
  },
  outdir: outputRoot,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: browser === "chrome" ? "chrome109" : "firefox109",
  sourcemap: true,
  logLevel: "info"
});

await Promise.all([
  cp(path.join(projectRoot, `manifests/${browser}.json`), path.join(outputRoot, "manifest.json")),
  cp(path.join(projectRoot, "assets/icons"), path.join(outputRoot, "icons"), { recursive: true }),
  cp(path.join(projectRoot, "src/content/styles.css"), path.join(outputRoot, "content/styles.css")),
  cp(path.join(projectRoot, "src/popup/index.html"), path.join(outputRoot, "popup/index.html")),
  cp(path.join(projectRoot, "src/popup/popup.css"), path.join(outputRoot, "popup/popup.css"))
]);
