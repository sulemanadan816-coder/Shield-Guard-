# ShieldGuard

**Advanced Popup, Redirect, Ad & Browsing Protection**
*Browse freely. Shield the unwanted.*

ShieldGuard is an original Manifest V3 Chrome/Chromium extension. Its product
structure (dashboard, Free/Pro split, per-site controls, content filter
panel) was inspired by the general shape of commercial popup-blocker
products, but its branding, code, UI, and architecture are original and do
not copy any proprietary product's source, assets, or exact design.

## Architecture

```
src/
  background/index.ts   - the real protection engine (service worker)
  content/               - gesture tracking + conservative overlay removal
  popup/                 - toolbar popup UI
  dashboard/             - Control Center / Content Filter / Site Manager /
                            Event History / Settings / Premium / More (SPA)
  lib/                    - shared types, storage schema, detection engines,
                            subscription service, profiles, utilities
public/
  manifest.json           - MV3 manifest
  rules/*.json             - declarativeNetRequest static rulesets +
                            cosmetic-filter selector config
  icons/, _locales/
tests/                    - vitest unit tests for the detection engines
scripts/                  - esbuild bundling + static asset copy
```

### The four layers

1. **Browser Protection Engine** (`src/background`) — declarativeNetRequest
   rule management, popup detection via `webNavigation.onCreatedNavigationTarget`,
   redirect-chain analysis, badge/notification/retention lifecycle.
2. **Content Filtering Engine** (`public/rules`, `src/content/overlay-filter.ts`)
   — static network rules plus conservative, structurally-gated cosmetic
   overlay removal.
3. **User Control Center** (`src/dashboard`) — statistics, event history,
   per-site controls, settings.
4. **Premium Intelligence Layer** (`src/lib/subscription.ts`,
   `src/lib/profiles.ts`) — license/entitlement abstraction and protection
   profiles.

## Honesty notes / known platform limitations

- **Popup prevention is detection + fast closure, not true prevention.**
  Chrome does not expose an API that lets an extension stop
  `window.open()`/`target=_blank` from ever creating a tab. ShieldGuard
  detects the new tab via `webNavigation.onCreatedNavigationTarget`
  (typically within milliseconds) and closes it with `chrome.tabs.remove()`
  when the popup-risk heuristic scores it medium-or-above. A brief flash of
  the destination tab is possible and is a disclosed limitation, not a bug
  being hidden.
- **The Popup Risk Score is a heuristic, not a malware probability.** It
  combines gesture timing, cross-origin status, burst frequency, and static
  rule matches. It is displayed and documented as a heuristic everywhere in
  the UI.
- **Quiet Protection Mode is the default, and it is a real behavior change,
  not a cosmetic one.** Suspicious redirect chains are handled silently:
  ShieldGuard diverts the tab back to the last page it can confirm the user
  was actually on (`RedirectTracker.earliestKnownGoodUrl`), never to
  `redirect-shield.html`, and never via a blind `history.back()`. A per-tab
  cooldown (`recentDiversions` in `src/background/index.ts`) means a page
  that keeps re-triggering the same redirect gets diverted at most once
  per 15s window -- after that ShieldGuard stops intervening and just logs
  the event as "flagged" rather than risking a divert/redirect loop. The
  full-page interstitial is reachable in exactly two ways: (1) manually,
  via "View details" on any event in Event History (a modal, not
  `redirect-shield.html` itself), or (2) automatically, only when Quiet
  Protection Mode is turned off **and** the chain is high-severity (a
  same-domain navigation loop, or 5+ distinct domains) -- the narrow case
  the project spec calls out as one a user may genuinely need to decide on.
- **Per-site network exceptions.** `declarativeNetRequest`'s static
  rulesets are global on/off switches with no built-in idea of "this tab's
  site is trusted." So that Site Manager's Pause/Trust/per-category toggles
  actually change network-level blocking (not just the JS-side popup and
  redirect heuristics), the background worker mirrors site settings into
  high-priority **dynamic** `allow` rules scoped to that site's initiator
  domain (`src/lib/site-exceptions.ts` for the pure decision logic, wired
  up in `src/background/index.ts`). A timed "Pause for 5 minutes" also
  schedules a `chrome.alarms` entry so the exception expires on its own
  without polling.
- **The bundled `rules/*.json` files are a small, original, illustrative
  starter set** built from independently and publicly documented
  ad-tech/tracking domains -- not a copy of any single proprietary filter
  list. A production deployment should extend/replace them with a properly
  licensed, regularly updated list converted to MV3 DNR JSON at build time
  (never fetched or executed as remote code at runtime).
- **No fake data, ever.** Statistics come only from real recorded
  `ProtectionEvent`s (see `src/lib/statistics.ts`). Setting "Log blocked
  events" to off stops that recording entirely rather than faking it.
- **The subscription system is dev-mode only, and this is a launch
  blocker, not a footnote.** `src/lib/subscription.ts`'s
  `MockSubscriptionProvider` only accepts an obviously-fake
  `SG-TEST-XXXX-XXXX` key format, and `ProductionSubscriptionProvider`
  throws on every call until it's wired to a real backend -- so no build
  of this extension can currently fabricate a paid entitlement. But "throws
  until configured" is not the same as "a real entitlement system exists."
  There is no server, no payment-provider integration, no per-user
  authenticated entitlement check, and no admin dashboard in this codebase.
  See "Premium/entitlement architecture" below for exactly what would need
  to be built, and do not submit this extension to the Chrome Web Store
  with real payments implied anywhere in its listing until that exists.
- **What background-side premium enforcement exists today, and its
  limit.** `SET_PROFILE` and `GET_EVENTS` (extended history) independently
  re-check `isPremium()` in `src/background/index.ts` and deny/cap the
  request even if a free user calls the message directly (e.g. from
  devtools), not just when the dashboard UI happens to hide the button.
  That closes the specific "edit localStorage / call the message myself"
  bypass. It does **not** mean entitlement is trustworthy in an absolute
  sense: `isPremium()` reads `chrome.storage.local`, which lives entirely
  on the user's machine. A sufficiently motivated user with devtools access
  can still flip that stored value directly, the same way they could patch
  any client-only license check in any desktop application. Closing that
  last gap requires the server-verified entitlement flow described below;
  nothing client-side can fully close it.

## Premium/entitlement architecture: current state vs. what shipping needs

**Implemented in this codebase today:** the client-side entitlement
surface (`SubscriptionState`, `isPremium()`, `activateLicense()`) and the
two real background-side checks described above. That is the full extent
of it.

**Not implemented, and out of scope for a browser-extension-only
codebase:** an authentication provider, a payments/billing integration, a
backend that verifies payment and issues signed entitlement tokens, and an
admin dashboard for managing plans/prices/users. None of that can live
inside a Chrome extension bundle by design -- an extension cannot hold
service-role/secret keys or safely be the source of truth for its own
entitlement. The realistic target architecture, if/when a backend is
built, is:

```
User authenticates (e.g. Supabase Auth / Firebase Auth / Clerk)
        |
User purchases via a real payment provider (Stripe recommended for a
Chrome extension, since Chrome Web Store's own in-app payments were
deprecated) -> provider webhook -> backend verifies payment
        |
Backend stores entitlement server-side (e.g. a `subscriptions` table:
user_id, plan_id, status, current_period_end) -- never trust a client claim
        |
Extension authenticates the user (e.g. a short-lived token from the
backend after OAuth) and calls a `GET /entitlement` endpoint
        |
Backend re-derives entitlement from its own database on every call and
returns a short-lived signed response (or the extension re-checks on an
interval + on each Pro-gated action) -- the extension never locally
decides "I am premium" from a value nothing server-side can vouch for
        |
Background service worker gates every Pro-gated background action
(profiles, extended history, custom rules, scheduled protection) on that
server-verified entitlement, with a short grace-period cache for
offline/service-worker-restart tolerance
```

An admin dashboard (view users, grant/revoke access, manage plans/prices)
is a separate, normal authenticated web app talking to that same backend
database with server-side role checks (e.g. a Postgres row-level-security
policy keyed off an `is_admin` claim that only the backend, never the
client, can set) -- it is not something that can or should be built inside
this extension's codebase. No such backend or admin app exists in this
repository, and building one requires infrastructure (a hosted database, a
deployed API, a payment-provider account) this engineering pass did not
have access to.

## Permissions (all requested, all justified)

| Permission | Why |
|---|---|
| `storage` | Persist settings, site preferences, and local event history. |
| `tabs` | Read the active tab's domain; close tabs identified as unwanted popups. |
| `webNavigation` | Observe navigation events for popup and redirect-chain detection. |
| `declarativeNetRequest` | Apply bundled, on-device blocking rules and per-site dynamic exceptions. |
| `alarms` | Periodic retention cleanup, summary-notification checks, and site-pause expiry. |
| `notifications` | Occasional blocked-events summary (never per-event spam). |

No `host_permissions` and no broad `scripting` permission are requested —
content scripts are declared statically in the manifest, and
`declarativeNetRequest` block rules do not require host access.

## Message-passing security

`externally_connectable` is not declared in the manifest, so
`chrome.runtime.onMessage` is already restricted by Chrome itself to this
extension's own contexts (its background worker, dashboard, popup, and
its own content scripts) -- an arbitrary web page's JS cannot message the
background worker at all. `src/background/index.ts` adds two further,
defensive checks on top of that platform guarantee rather than relying on
it alone: every inbound message is rejected unless `sender.id` equals
`chrome.runtime.id`, and unless `message.type` is one of the literal
`RuntimeMessage` variants (`KNOWN_MESSAGE_TYPES`) -- so a malformed or
unexpected payload from any context fails closed instead of reaching
`handleMessage`.

## Accessibility

All interactive elements (toggles, cards, tiles, feed rows) are real
`<button>`s or have `role="button"`/`tabindex="0"` with Enter/Space
support, so the dashboard and popup are fully keyboard-operable. Focus is
always visible via `:focus-visible`. The Settings > Appearance > Reduced
motion toggle disables transitions/animations app-wide, and the OS-level
`prefers-reduced-motion` media query is honored automatically regardless
of that setting.

## Internationalization

ShieldGuard ships full `chrome.i18n` locale files for English, Urdu,
Arabic, Spanish, French, and German (`public/_locales/*/messages.json`),
covering 103 keys — page titles/subtitles, sidebar navigation, all card
and stat labels, filter levels, all 8 content-filter category names, Site
Manager/Event History/Settings/Premium section chrome, and every More-menu
tile. `src/lib/i18n.ts` wraps `chrome.i18n.getMessage()` with a safe
English fallback, so a missing or malformed translation never surfaces a
raw message key to the user. `tests/i18n.test.ts` enforces that every
shipped locale has exactly the same key set as English and that no
message value is empty — a locale can never silently fall out of sync.

Dynamic content (domain names, detection reasons, user-entered report
text) is intentionally left untranslated, since it's technical/user data
rather than UI chrome.

## Build

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run build       # typecheck + esbuild bundles + copy static assets -> dist/
```

Load `dist/` via `chrome://extensions` → Developer Mode → **Load unpacked**.

## Bug found via a real test run: expected user-errors were logging as extension bugs

Running the real test suite (not just my static parse checks) surfaced two
genuine, pre-existing bugs I hadn't caught:

- **A wrong license key or a malformed settings-import file logged a
  `console.error` in the background service worker**, which chrome://extensions
  surfaces as a scary-looking "Errors" badge on the extension -- even though
  nothing was actually broken; the user had just typed the wrong thing. Root
  cause: `subscription.ts` and `storage.ts` used a plain `throw new
  Error(...)` for routine input validation, and the message listener's
  catch-all logged every rejection via `console.error` with no distinction
  from a real bug.
- **The dashboard's own error handling for both of those flows never actually
  ran.** `chrome.runtime.sendMessage()` only rejects on a transport failure
  (no listener, extension reloaded mid-call, etc.) -- it resolves normally
  when the background catches an error and responds with `{ error: ... }`,
  which is exactly what the listener does. The dashboard's `activateBtn` and
  `import` handlers were both written as `try { await send(...) } catch
  (err) { ... }`, so that catch block could never fire. Worst concretely: on
  a malformed import file, the code fell through to the success path and
  told the user "Your settings were imported successfully" when nothing had
  been imported at all.

**Fix:** added `src/lib/errors.ts` with an `ExpectedError` class. Routine
validation failures (bad license key format, malformed/invalid import file)
now throw `ExpectedError` specifically; the background message listener logs
via `console.error` only for anything that ISN'T an `ExpectedError`, so
genuine bugs still show up loudly and routine user mistakes don't.
`importAll()` in `storage.ts` now validates JSON shape properly instead of
letting a raw `JSON.parse` exception escape. Both dashboard call sites were
rewritten to check the resolved `.error` field instead of relying on a
`catch` that could never trigger. `tests/chrome-mock-full.ts`'s
`sendMessage` mock was also fixed to mirror this same resolve-not-reject
behavior, since it previously diverged from the real runtime and would have
made this exact class of bug invisible under test. Covered by 4 new test
cases in `tests/storage.test.ts`.

## Scheduled Protection and Custom Rules (Pro) -- previously advertised but not implemented; now real

Two Pro features were named in the Free vs Pro comparison table without
actually existing anywhere in the codebase -- a real "misleading premium
claim" problem, not just a missing nice-to-have. Both are now implemented:

- **Scheduled Protection**: `ScheduleRule`s (day-of-week + time-of-day
  window -> protection profile) are evaluated every 5 minutes by
  `evaluateSchedules()` in `src/background/index.ts` (plus immediately on
  install/startup/save, so an already-active window doesn't wait for the
  next tick), and actually switch `activeProfile`/`filterLevel`/categories
  via the same `applyProfileSettings()` path `SET_PROFILE` uses -- not a
  UI-only label. When no schedule matches and one was previously active,
  it restores the profile the user had selected before, tracked via
  `UserSettings.preScheduleProfile`/`activeScheduleId`. Handles overnight
  windows (e.g. 22:00 -> 06:00) and, if multiple schedules overlap, picks
  the first match deterministically rather than at random.
- **Custom Rules**: a Pro user can block a specific domain outright (e.g.
  a site not covered by the bundled rulesets). Deliberately narrow by
  design -- a plain registrable domain only, no wildcards, regex, or paths
  (`src/lib/custom-rules.ts`) -- so a copy-pasted or mistyped rule can't
  accidentally block far more than intended, and because
  declarativeNetRequest has no arbitrary-scripting mechanism to expose in
  the first place. Capped at 100 rules per user.

**A real architectural risk this surfaced, caught before it shipped:**
Custom Rules needed its own declarativeNetRequest *dynamic* rules (BLOCK),
but `syncSiteExceptionRules()` already owned the *entire* dynamic rule
table for per-site trust/pause exceptions (ALLOW) -- and it worked by
unconditionally removing every existing dynamic rule ID and replacing them
with only the ones it just computed. Adding Custom Rules as a second,
independent producer writing to that same table would have meant each
feature silently deleted the other's rules on its next sync. Fixed by
merging both into one `syncDynamicRules()` that computes site exceptions
and custom rules together and writes them in a single
`updateDynamicRules()` call, using disjoint ID ranges (site exceptions:
1..N; custom rules: 100,000..100,099) so the two can never collide. Site
exceptions are given higher DNR priority than custom-rule blocks, so an
explicit "Trust this site" always overrides the user's own custom block
rule for that site -- matching what "Trust" should mean. Both are Pro-only
and enforced at write time (`SET_CUSTOM_RULES`/`SET_SCHEDULES` check
`isPremium()` server-side) and at evaluation time (a lapsed subscription's
saved custom rules stop compiling into the network layer, not just get
hidden in the UI). Pure validation/normalization logic for both lives in
`src/lib/custom-rules.ts`, covered by `tests/custom-rules.test.ts`.

## This engineering pass: site pause, notifications, diagnostics

- **Site pause durations were mislabeled and inaccurate; fixed.** "Pause
  for this session" actually persisted indefinitely across browser
  restarts (`pausedUntil: undefined` with no expiry logic tied to restart
  at all) -- it was a "pause until manually re-enabled" wearing the wrong
  label. `SiteSettings.pausedUntil` is now `number | "restart" | undefined`
  with real, distinct semantics for all four cases the spec calls for: a
  fixed duration (10 min / 1 hour), `"restart"` (cleared specifically by
  `chrome.runtime.onStartup`, not by the unrelated and much more frequent
  MV3 service-worker suspend/wake cycle), and `undefined` (manual only).
  `src/lib/site-exceptions.ts`'s `isSiteBypassed` needed a matching fix:
  broadening the type without it would have made `"restart" > now`
  silently evaluate to `false` via numeric coercion, i.e. treated a
  restart-paused site as still protected. Covered by two new cases in
  `tests/site-exceptions.test.ts`.
- **Smart notifications were already rate-limited correctly** --
  `logEvent()` never calls `chrome.notifications.create` itself; only a
  once-per-calendar-day alarm-driven summary does, so per-event spam was
  structurally impossible already. What I improved was the message itself:
  it now names the top categories (`"12 trackers, 3 popups, and more (18
  total) today"`) instead of a bare total.
- **Protection Health page (More -> Protection Health), new.** Live
  diagnostics: version/manifest version, protection on/off, active
  profile, each bundled ruleset's enabled state and actual rule count
  (read from the shipped `rules/*.json`, not hardcoded), the current count
  of per-site dynamic exception rules, last recorded event, storage bytes
  in use, and a plain-language configuration-warning list (e.g. "every
  category is disabled", "N rulesets not enabled"). "Service worker
  status" is reported honestly as "running (it responded to this
  request)" -- there is no MV3 API to inspect a *different*, currently-idle
  worker's state from a page, so I did not invent one. "Copy diagnostics"
  copies the same JSON the page renders; it contains no license keys,
  tokens, or secrets of any kind.

## Manual testing checklist

1. Run `npm run build`, load `dist/` unpacked.
2. Open a normal website (e.g. a news site) — confirm no visible breakage.
3. Open the popup — confirm status, current domain, and today's counters render.
4. Open Control Center — confirm range tabs (Today/Yesterday/7d/30d/All) update real numbers.
5. Open Content Filter — toggle a category, confirm the change persists on reload.
6. Switch Filter Level to Strict/Lockdown — confirm the compatibility warning appears.
7. Open Site Manager on any site — Pause 10 min / Pause 1 hour / Pause until restart / Pause until manually re-enabled / Trust / Reset, confirm the status line and behavior update the popup status, and confirm "until restart" actually survives a normal tab reload but clears after fully quitting and reopening the browser (`chrome.runtime.onStartup`), not just a service-worker suspend.
8. Open Event History — filter by category and search by domain.
9. Open Settings — toggle Protection Enabled off — confirm popup shows "PROTECTION OFF" and DNR rulesets disable.
10. Open Premium — attempt an invalid license key (rejected), then `SG-TEST-DEMO-0001` (accepted in dev builds only).
10b. While still on the free plan, open the browser devtools console on the
     dashboard page and run
     `chrome.runtime.sendMessage({type:"SET_PROFILE", profile:"lockdown"})`
     directly — confirm the response is
     `{ error: "premium_required", ... }` and `activeProfile` in Settings
     does **not** change. This confirms the Pro gate is enforced in the
     background worker, not only hidden by the dashboard UI.
10c. Trigger 60+ synthetic events (e.g. via repeated
     `chrome.runtime.sendMessage` calls with a custom test hook, or by
     browsing sites that generate blocked events) on the free plan —
     confirm Event History shows at most 50 and displays the "Upgrade to
     Pro" note; `SG-TEST-` activate, then confirm the cap lifts.
11. Open More → Export Settings, then Import Settings from the downloaded file.
12. More → Reset Extension — confirm everything returns to defaults.
13. Reload the unpacked extension (simulates browser/service-worker restart) — confirm settings and site list persisted.
14. With Quiet Protection Mode on (default), visit a page that performs a
    fast, multi-domain redirect chain (a controlled test page under your
    own control -- do not point this at a real ad network) — confirm the
    tab is diverted back to the original page, not to `redirect-shield.html`,
    and that Event History logs it.
15. Turn Quiet Protection Mode off, then trigger a same-domain redirect
    loop (A -> B -> A) on a controlled test page — confirm this specific,
    high-severity case does show `redirect-shield.html`, and that its
    Go Back / Continue / Trust Site actions still work.
16. More → Protection Health — confirm version/manifest info, ruleset
    enabled state, and rule counts render, and that a configuration
    warning appears if you turn off every category in Content Filter
    first. Click "Copy diagnostics" and confirm it copies valid JSON with
    no license key or token in it.
17. Activate a test Pro license, then Premium → Scheduled Protection → Add
    Schedule with a window that includes right now — confirm the active
    profile switches within a few seconds (the schedule check also runs
    immediately on save) and Protection Health's "Active profile" reflects
    it. Edit the window so it no longer includes now — confirm the
    original profile is restored, not left on the schedule's profile.
18. Premium → Custom Rules → add a domain (e.g. a controlled test domain
    you control) — confirm requests to it are blocked, then disable the
    rule and confirm requests succeed again. Try an invalid pattern (with
    a wildcard, path, or space) and confirm it's rejected with a clear
    message rather than silently accepted.
19. On the free plan, call `chrome.runtime.sendMessage({type:"SET_SCHEDULES", schedules:[...]})`
    or `SET_CUSTOM_RULES` directly from devtools — confirm both are denied
    with `{ error: "premium_required" }` and nothing is persisted.

## Testing

`npm test` runs unit/DOM tests (vitest) covering: popup risk scoring,
gesture tracking, redirect-chain detection, URL/subdomain/IP/malformed-URL
handling, storage schema and whitelist isolation (no cross-domain trust
leakage), event retention, statistics honesty (no fabricated numbers), the
subscription architecture (no fake purchase success), protection profiles,
per-site declarativeNetRequest exception computation
(`tests/site-exceptions.test.ts`), service-worker-restart-safe defaults
(fresh trackers fail toward more scrutiny, never less), locale-file parity
(`tests/i18n.test.ts`), and — via `tests/dashboard-smoke.test.ts` — a real
jsdom boot of the actual dashboard SPA code (not a hand-rolled fixture)
that navigates every panel and confirms a live category toggle round-trips
through the real storage layer.
