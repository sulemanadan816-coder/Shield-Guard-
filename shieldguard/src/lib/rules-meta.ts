import type { FilterRuleMeta, ProtectionCategory } from "./types";

/**
 * NOTE on the bundled rule files (public/rules/*.json):
 * These are a small, original, illustrative starter set built from
 * publicly and independently documented ad-tech/tracking infrastructure
 * domains -- NOT a copy of any single proprietary filter list. They exist
 * to make the declarativeNetRequest architecture real and testable out of
 * the box. A production deployment should replace/extend them with a
 * properly licensed, regularly updated filter list converted to MV3 DNR
 * JSON via a build-time script (never fetched/executed as remote code at
 * runtime -- MV3 static rulesets must ship inside the extension package).
 */
const RULE_FILES: Record<Exclude<ProtectionCategory, "overlays" | "socialWidgets" | "cryptoMining" | "scamMalvertising">, string> = {
  ads: "ads.json",
  trackers: "trackers.json",
  popups: "popups.json",
  redirects: "redirects.json",
  annoyances: "annoyances.json"
};

const SECURITY_FILE = "security.json";

export async function getRuleMeta(): Promise<FilterRuleMeta[]> {
  const results: FilterRuleMeta[] = [];
  for (const [category, fileName] of Object.entries(RULE_FILES) as [ProtectionCategory, string][]) {
    if (category === "annoyances") {
      const res = await fetch(chrome.runtime.getURL(`rules/${fileName}`));
      const json = (await res.json()) as { keywordSelectors: string[] };
      results.push({ category, ruleCount: json.keywordSelectors.length, fileName });
      continue;
    }
    const res = await fetch(chrome.runtime.getURL(`rules/${fileName}`));
    const json = (await res.json()) as unknown[];
    results.push({ category, ruleCount: json.length, fileName });
  }
  const secRes = await fetch(chrome.runtime.getURL(`rules/${SECURITY_FILE}`));
  const secJson = (await secRes.json()) as unknown[];
  results.push({ category: "scamMalvertising", ruleCount: secJson.length, fileName: SECURITY_FILE });
  return results;
}
