import { cpSync, mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });

const copies = [
  ["public/manifest.json", "dist/manifest.json"],
  ["public/icons", "dist/icons"],
  ["public/rules", "dist/rules"],
  ["public/_locales", "dist/_locales"],
  ["src/popup/popup.html", "dist/popup.html"],
  ["src/popup/popup.css", "dist/popup.css"],
  ["src/dashboard/dashboard.html", "dist/dashboard.html"],
  ["src/dashboard/dashboard.css", "dist/dashboard.css"],
  ["src/redirect-shield/redirect-shield.html", "dist/redirect-shield.html"],
  ["src/redirect-shield/redirect-shield.css", "dist/redirect-shield.css"]
];

for (const [src, dest] of copies) {
  cpSync(src, dest, { recursive: true });
  console.log(`copied ${src} -> ${dest}`);
}

console.log("Static assets copied.");
