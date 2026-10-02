import * as esbuild from "esbuild";
import { mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });

const shared = {
  bundle: true,
  minify: false,
  sourcemap: false,
  target: "chrome111",
  logLevel: "info"
};

async function build() {
  // Background service worker: MV3 allows ES module service workers.
  await esbuild.build({
    ...shared,
    entryPoints: ["src/background/index.ts"],
    outfile: "dist/background.js",
    format: "esm"
  });

  // Content scripts must be classic (non-module) scripts.
  await esbuild.build({
    ...shared,
    entryPoints: ["src/content/gesture-client.ts"],
    outfile: "dist/gesture-client.js",
    format: "iife"
  });
  await esbuild.build({
    ...shared,
    entryPoints: ["src/content/overlay-filter.ts"],
    outfile: "dist/overlay-filter.js",
    format: "iife"
  });

  // Extension pages.
  await esbuild.build({
    ...shared,
    entryPoints: ["src/popup/popup.ts"],
    outfile: "dist/popup.js",
    format: "esm"
  });
  await esbuild.build({
    ...shared,
    entryPoints: ["src/dashboard/dashboard.ts"],
    outfile: "dist/dashboard.js",
    format: "esm"
  });
  await esbuild.build({
    ...shared,
    entryPoints: ["src/redirect-shield/redirect-shield.ts"],
    outfile: "dist/redirect-shield.js",
    format: "esm"
  });

  console.log("JS bundles built.");
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
