/**
 * Thin wrapper around chrome.i18n.getMessage. Falls back to the literal
 * `fallback` string (always the English text) if the message key is
 * missing from _locales for any reason, so a translation gap never shows
 * the user a raw message key like "controlCenterTitle".
 */
export function t(key: string, fallback: string): string {
  try {
    const msg = chrome.i18n.getMessage(key);
    return msg && msg.length > 0 ? msg : fallback;
  } catch {
    return fallback;
  }
}
