// Bundles the overlay filter for the Android WebView with a tiny chrome.* shim.
import * as esbuild from "esbuild";
import { mkdirSync, copyFileSync, readdirSync, writeFileSync, readFileSync } from "node:fs";

const out = "android/app/src/main/assets";
mkdirSync(`${out}/rules`, { recursive: true });
for (const f of readdirSync("public/rules")) copyFileSync(`public/rules/${f}`, `${out}/rules/${f}`);

const shim = `window.chrome={runtime:{getURL:function(p){return p;},sendMessage:function(){return Promise.resolve(undefined);}}};
window.fetch=(function(of){return function(u){if(u==='rules/annoyances.json'&&window.__SG_ANNOY){return Promise.resolve(new Response(JSON.stringify(window.__SG_ANNOY)));}return of.apply(this,arguments);};})(window.fetch);`;
const r = await esbuild.build({
  entryPoints: ["src/content/overlay-filter.ts"], bundle: true, write: false,
  format: "iife", target: "chrome100", logLevel: "info"
});
writeFileSync(`${out}/overlay-filter.js`, shim + "\n" + r.outputFiles[0].text);
console.log("Android assets ready in", out);
