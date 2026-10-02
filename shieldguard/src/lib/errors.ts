/**
 * An error representing an expected, user-facing validation failure --
 * e.g. "invalid license key format" or "that file isn't valid ShieldGuard
 * settings" -- as opposed to an unexpected bug.
 *
 * The background message listener (src/background/index.ts) uses this
 * distinction to decide whether to log via console.error (reserved for
 * real, unexpected bugs) or just return the message quietly to the caller
 * (routine user-input problems, which are normal application flow and
 * should not populate chrome://extensions' "Errors" badge).
 */
export class ExpectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpectedError";
  }
}
