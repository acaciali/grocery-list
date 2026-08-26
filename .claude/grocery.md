# 🛒 Grocery — Todo

**MVP:** connect to one store, create a list
**Bonus:** push items into a real cart
**Owns:** `/grocery/`, `/functions/stores.ts`, `groceries` collection

---

## 📍 Where this stands

Store connection, product search, the whole match/UI model, and now **cart push** are
built. **Nothing has run against the live Kroger API** — every result so far is `MockStore`.

`npm run typecheck` and `npm run build` clean. `npm run test` green (19 shared + 9 web +
41 functions).

**`resolveItems` is verified.** It was hanging, not crashing — see B1 below. All four
fixture states now come back correctly over HTTP from the emulator.

✅ **The frontend track (F1–F5) is done.** The match model is fully reachable: every row
opens an item sheet, unresolved items batch-resolve against the connected store, user
corrections are remembered, and a store switch invalidates stale matches. F6 (cart UI) is
now unblocked — backend B3 has landed.

⚠️ **None of it has been seen in a browser.** Typecheck, tests and build are the only
verification so far.

---

## 🔀 Two tracks — work these in parallel

| | Backend track | Frontend track |
|---|---|---|
| **Owns** | `functions/**`, `firestore.rules`, deploys | `apps/web/src/routes/grocery/**` |
| **Goal** | ~~Verify the resolver, then build cart push~~ — both done. Now: live Kroger + deploy | ✅ F1–F5 done. Now: F6, the cart UI |
| **Blocked by** | B2 and B4 need credentials, `firebase login`, and a JRE | Nothing — **F6 is unblocked, B3 is built** |

### The seam: HTTP contract

Both tracks code against this. It is **now implemented in full** — the cart and OAuth
endpoints landed against the shapes agreed here, unchanged. **Neither track changes these
shapes without telling the other.**

```
GET  /findStores?zip=84604
     -> { stores: StoreLocation[] }

GET  /searchProducts?q=milk&locationId=01400376
     -> { products: StoreProduct[] }

POST /resolveItems                                    ✅ built + verified + called
     { locationId: string, uid?: string,
       items: [{ id: string, name: string }] }        // max 50
     -> { matches: { [id: string]: StoreMatch } }

POST /rememberChoice                                  ✅ built + called
     { uid: string, term: string, product: StoreProduct }
     -> { ok: true }

--- Now BUILT, exactly as specified below. No shape changed. ---

GET  /krogerAuthUrl?uid=<uid>&redirect=<app-url>      ✅ built
     -> { url: string }                               // send the user here
     -> 400 if `redirect`'s ORIGIN is not in APP_ALLOWED_ORIGINS (open-redirect guard;
        defaults to http://localhost:5173 + 127.0.0.1:5173)

GET  /krogerCallback?code=&state=                     ✅ built
     -> 302 back to the app with ?kroger=linked
     -> 302 back with ?kroger=error&reason=<...> when consent is declined or the
        code exchange fails
     -> 400 plain text when `state` can't be verified (no trustworthy URL to return to)

GET  /krogerStatus?uid=<uid>                          ✅ built
     -> { linked: boolean }
     -> 502 if Firestore can't be read. Deliberately NOT `linked:false` — reporting
        "not linked" during an outage is a lie. Render an error state, not a link button.

POST /addToCart                                       ✅ built
     { uid: string, locationId: string,
       modality: 'PICKUP' | 'DELIVERY',
       lines: [{ itemId: string, upc: string, quantity?: number }] }   // quantity ⇒ 1
     -> { batchId: string,
          results: [{ itemId: string, ok: boolean, error?: string }] }
     -> 400 if any line has no `upc` (the error names the itemId), if `lines` is
        empty, or if there are more than 100 lines
     -> 401 { error, linked: false } when the user has no valid Kroger authorization
```

**In mock mode the whole link flow works with no credentials and nothing registered
anywhere.** `/krogerAuthUrl` hands back our own `/krogerCallback` with a fake code, and
`/addToCart` skips the linked check. F6 can be built and demoed end to end today.

`StoreProduct`, `StoreMatch`, and `StoreLocation` live in `packages/shared/src/types.ts`.

### Files both tracks might touch — coordinate first

- `packages/shared/src/types.ts` — additive only, announce, second reviewer
- `packages/shared/src/firebase.ts` — ⚠️ **already changed**: `db` now starts via
  `initializeFirestore` with `persistentLocalCache` instead of `getFirestore`. Behaviour is
  additive (offline reads + queued writes) and affects every team. Needs a second reviewer.
- `.claude/grocery.md` — this file; expect conflicts, resolve by keeping both sides

---

# 🔧 BACKEND TRACK

## Setup (one-time) — ⚠️ ALL FOUR STILL OPEN, and they gate B2 and B4

Nothing below can be done from a code change. These need a human with a browser and a
password manager.

- [ ] `brew install --cask temurin` — no JRE, so Firestore and Auth emulators cannot start.
      The Functions emulator runs fine on its own (that is how B1 was verified), but
      **anything that must actually persist** — the OAuth handshake, `cartBatches`,
      `productPrefs` — cannot be tested end-to-end until this is installed.
- [ ] `firebase login` — the CLI is unauthenticated
- [ ] Copy `functions/.env.example` → `functions/.env`, add the real Kroger client ID/secret.
      Two new vars live there now: `KROGER_REDIRECT_URI` and `APP_ALLOWED_ORIGINS`.
- [ ] Register the `/krogerCallback` URL as a redirect URI in the Kroger dev portal. It must
      match `KROGER_REDIRECT_URI` **exactly** or authorize fails with an opaque error.
- [ ] Confirm anonymous auth is enabled in the Firebase console

## B1 · Verify `resolveItems` ✅ DONE — it was hanging, not crashing

- [x] Reproduced. The old probe returned no output because the request **never finished**.
- [x] Root cause found, and it was *near* the guess but not it. `getFirestore()` at module
      load is not what hung. With no Firestore emulator, the Admin SDK falls back to
      production and tries to fetch credentials from the GCE metadata server at
      `169.254.169.254`, which on a laptop is `EHOSTDOWN` — then **retries with backoff for
      well over a minute**. `cache.ts` had a `try/catch` promising that a broken cache
      behaves like a cache miss, but a hang is not a throw, so the catch never ran.
- [x] Fixed two ways, in `functions/src/db.ts`:
      **(a)** `db()` initializes lazily, so a config problem can no longer take down every
      function in the codebase at handler-discovery time — including ones that never touch
      Firestore. **(b)** `withDeadline()` puts a 3s bound on every cache call, which is what
      actually makes "degrades to a miss" true instead of aspirational.
- [x] All four fixtures verified over HTTP against the Functions emulator:
      `milk` → `matched`, `bread` → `ambiguous` (5 candidates), `eggs` → `unavailable`,
      `birthday card` → `no_match`. Also pinned as unit tests in
      `functions/src/stores/matching.test.ts`, which need no emulator at all.
- [ ] **Still open:** the `productPrefs` → `chosenBy: 'memory'` path. It is the one branch
      that *requires* a real Firestore read to exercise, so it waits on the JRE.

> Note the shape of the fix: with Firestore unreachable, `resolveItems` now takes ~6s
> (two 3s deadlines) and returns correct results. That is a deliberately loud, correct
> degradation, not the target latency — with Firestore up, the cache answers immediately.

## B2 · Exercise the live Kroger API

Everything so far is `MockStore`. Set `STORE_ADAPTER=kroger`.
**Blocked on setup:** needs the real client ID/secret in `functions/.env`.

- [ ] `findStores` against a real ZIP
- [ ] `searchProducts` with a real `locationId` — **confirm `upc` and `items[].price` are
      present.** Kroger omits price and stock entirely without `filter.locationId`; if the
      shape differs from `functions/src/stores/kroger.ts`, that file is the only thing to fix.
- [ ] Confirm the token helper refreshes rather than 401ing after ~30 minutes
- [ ] Confirm `storeProducts` cache entries are written and hit on the second call

## B3 · Cart push ✅ BUILT — **F6 is unblocked**

New files: `functions/src/cart.ts`, `stores/userTokens.ts`, `oauth-state.ts`,
`cart-lines.ts`. All four endpoints are exported from `index.ts` and load in the emulator.

- [x] User OAuth2 (`scope=cart.basic:write`), separate from client credentials, using the
      `exchangeAuthCode()` / `refreshUserToken()` helpers that already existed.
- [x] `GET /krogerAuthUrl`, `GET /krogerCallback`, `GET /krogerStatus` per the contract.
- [x] Refresh tokens at `users/{uid}/private/kroger`, Admin SDK only, matching the
      deny-all rule that was already written.
- [x] `POST /addToCart` with per-line results.
- [x] `cartBatches/{id}` written per send.
- [ ] **Unverified end-to-end** — the handshake and both Firestore writes need a running
      Firestore emulator (JRE) plus a registered redirect URI. Everything reachable
      *without* those is verified; see the decisions below for what that leaves.

### Three decisions worth reviewing

1. **`addToCart` sends one HTTP request per line, not one batched request.**
   Kroger's `PUT /v1/cart/add` accepts an array but answers 204-or-error for the whole
   call, and there is no read-back to reconcile against. Sending the batch and retrying
   the failures would re-add anything that had already landed — the exact duplication this
   API makes impossible to detect. Per-line costs N calls against a 5,000/day cap, which a
   grocery list will never approach, and it is the only way the per-line `results` the
   contract promises can be honest.

2. **The `redirect` param is origin-allowlisted (`APP_ALLOWED_ORIGINS`).**
   We 302 the browser to a caller-supplied URL at the end of the handshake, which is an
   open redirect unless it is checked. The check is by **origin, not prefix** — a prefix
   test would let `https://our-app.example.com.evil.test` through. `state` carries
   `uid.nonce`; the nonce is stored before redirecting, checked on the way back, and
   deleted whether or not it matched, so a replayed callback finds nothing.

3. **A failed `cartBatches` write does not fail the request.**
   By then the items are already in the user's real cart. Returning an error would invite a
   re-send, and a re-send duplicates. It logs loudly and still returns the `batchId`.

## B4 · Deploy — blocked on `firebase login`

- [ ] Publish `firestore.rules` — written but **not deployed**; prod still has the original
      open-`groceries` rules, so `users/{uid}` reads currently fail
- [ ] Deploy the functions. Nothing has ever been deployed; it has only run in the emulator.
- [ ] Point the frontend at deployed URLs via `VITE_FUNCTIONS_BASE`

## B5 · Backfill script ✅ BUILT

`functions/src/scripts/backfill-keys.ts`. **Dry run by default**; `--apply` writes.

```
npm run backfill -w functions              # report only
npm run backfill -w functions -- --apply   # write
```

- [x] Fills `key` from `normalizeKey(name)` on docs that have none.
- [x] Fills `category` **only** from a store match the doc already carries. It never
      guesses. A keyword table mapping `milk` → `dairy` would be a second unreviewed
      contract living in a throwaway script, and a wrong category is worse than a missing
      one — aisle grouping already handles absent, but it cannot detect wrong.
- [x] **Never rewrites an existing `key`.** Other collections may already join on it, and
      `normalizeKey` is still pending the all-hands. Disagreements are reported as drift
      for a human to look at — which doubles as a detector for the `dozen-egg` / `egg`
      collision in the gotchas below.
- [x] Skips (loudly) any doc whose name normalizes to nothing, rather than inventing a key.
- [x] Decision logic is unit-tested in `backfill-keys.test.ts` — it touches someone's real
      family list, so its behaviour is pinned down without needing to run it.
- [ ] **Not yet run against real data** — needs credentials or the Firestore emulator.

---

# 🎨 FRONTEND TRACK

All under `apps/web/src/routes/grocery/` unless noted. **F1–F5 are complete.**

## F1 · Give `unresolved` items an affordance ✅

`MatchChip` used to return `null` for `unresolved`, so a plain-text item had no route to
the store at all. Now **every row has exactly one opener** in the chip slot, and all of
them open the same item sheet:

| Row state | Opener |
|---|---|
| Store connected, unresolved | quiet `Find` |
| No store connected | quiet `⋯` |
| Matched / ambiguous / out of stock / not found / not sold | the status itself |
| Resolving / sent | plain text, not tappable |

Each carries an `aria-label` naming the item, because `Find` and `⋯` say nothing on their
own in a list of twenty rows.

## F2 · Call `resolveItems` ✅ — `useMatchSync.ts`

Batches unresolved rows (cap 50, `RESOLVE_BATCH_LIMIT`), writes results back through
`setMatch`, and announces the outcome through an `aria-live` region on the page.

Three decisions worth knowing before changing it:

- **`resolving` is never written to Firestore.** It is a fact about *this tab's* network
  request. Persisting it would strand rows mid-spinner whenever a tab closes at the wrong
  moment, and would show every other client a spinner for a request they are not making.
  `GroceryPage` layers it on for display instead.
- **Checked rows are skipped.** They are already in the basket, and Products is capped near
  10,000 calls/day across the whole account.
- **An `attempted` set prevents retry storms.** Every Firestore snapshot re-runs the effect;
  without it, an unreachable store would be hammered once per keystroke elsewhere on the
  page. It is cleared on a store switch, and `retry(id)` re-arms a single row for the
  "check the store again" path.

Resolution failure is deliberately silent (console only). The list is fully usable
unmatched, and a toast per snapshot while the store is down is worse than no store at all.

## F3 · Call `rememberChoice` ✅

Fires on a user correction in the item sheet, keyed on `row.name` — **the same text
`resolveItems` sends**, which is what makes the memory hit next time. Best-effort with a
`.catch`: a failed memory costs a better guess later, never the choice just made.

## F4 · Store-switch invalidation ✅

`isStaleMatch()` in `matchState.ts`, applied by `useMatchSync`, with a banner on the page.
Stale matches reset to `unresolved`, and F2 immediately re-resolves them at the new store.

**Two statuses deliberately survive a switch**: `not_sold` (a statement about the item, not
the store) and `sent` (a record of something that actually happened, and it shows no price).
This is the load-bearing logic of the whole feature — get it wrong and it silently destroys
good data — so it lives in a pure module with tests rather than inside the Firestore layer.

## F5 · Smaller gaps ✅

- **`MatchPicker.tsx` → `ItemSheet.tsx`.** It is no longer only about matching: it now holds
  the amount editor, the package stepper, and the product picker. It **opens without a store
  connected** — editing an amount has nothing to do with Kroger, and gating it would make the
  list worse for anyone who never connects a store.
- **Amount editing** (quantity + unit) saves on blur and on close, not per keystroke: a
  number input passes through states like `""` and `"1."` that nobody means to store.
- **`cartQuantity` stepper** with the pack size beside it (`1 gal each`), which is the entire
  point — 2 lb of chicken against a 1.5 lb package is 2 packages, not 2 lb.
- **Upsert-by-key** in `data.ts`. Adding a duplicate bumps the existing row and toasts
  "Already on your list — now 3 lb milk". Only merges **unchecked** rows (a checked row is
  done; changing it behind the user is wrong) and only when units are compatible — `2 lb` and
  `3 cup` stay separate rows rather than becoming a nonsense `5`.
- **`persistentLocalCache`** in `packages/shared/src/firebase.ts` *(shared file — announced
  below)*. Multi-tab manager, with a try/catch fallback to `getFirestore()` because
  `initializeFirestore` throws on Vite HMR re-runs.
- **`disconnect` wired** into `StorePicker` as "Shop without a store".
- **`safeKey()`** in `data.ts`: `normalizeKey` throws on a name with no identifying words
  ("???"). A key is a nice-to-have on a grocery row, so a weird name now loses cross-app
  matching rather than losing the item.

## F6 · Cart UI — ✅ unblocked, B3 is built

> Backend note: build against `STORE_ADAPTER=mock` and the entire link → send flow works
> with no credentials. Send only `matched` items — `/addToCart` rejects the whole call
> with a 400 naming the offending `itemId` if any line has no `upc`, which is deliberate:
> an unmatched item can never reach a cart, and silently dropping it would be worse.

- [ ] `ReviewAndSend.tsx` — sends `matched` items, lists what it skips and why
- [ ] Per-item success/failure
- [ ] **Re-send requires an explicit confirm** naming the reason: Kroger cannot tell us what
      is already in the cart, so sending twice duplicates. Design this in, don't bolt it on.
- [ ] After sending: "Sent 4:12pm" + "Open Kroger cart ↗". **Never** render a claim about
      current cart contents — we cannot know them.
- [ ] Modality selector (pickup/delivery)

## Still owed on the frontend

- [ ] **A browser pass. None of this has been seen rendered.** Keyboard-only through the
      combobox and item sheet, a screen-reader check on the `aria-live` announcement, and a
      phone-width check on the sheet.
- [ ] End-to-end confirmation of F2 — it cannot be trusted until backend **B1** proves
      `resolveItems` actually returns matches.
- [ ] Legacy safety: a `groceries` doc with only `{name, checked, createdAt}` should render,
      check off, delete, and now also resolve.

---

## ⚠️ Corrections to CLAUDE.md — need team sign-off

1. **`POST /addToCart` takes UPC, not `productId`.** CLAUDE.md's endpoint table says
   `{productId, quantity}[]`; the Public API is `PUT /v1/cart/add` with
   `{ items: [{ upc, quantity, modality }] }`. Our code persists `upc` already.
2. **Phase 0 never created `functions/` or `firebase.json`,** though root `package.json`
   already declared the workspace. Grocery built them.
3. **`ensureSignedIn()` was never called.** Now called from `App.tsx` — deliberately
   *without* gating route rendering, since a failed anonymous sign-in must not take down a
   grocery list that predates auth and has open rules.
4. **`packages/shared/src/firebase.ts` now uses `initializeFirestore` + `persistentLocalCache`.**
   Shared file, additive behaviour, needs a second reviewer per the CLAUDE.md rule.

---

## ✅ Already done — don't rebuild these

**Backend:** `StoreAdapter` + `MockStore` (fixtures for every `MatchStatus`), Kroger token
helper with refresh-once-retry on 401, `KrogerStore`, `findStores`, `searchProducts`,
scoring in `matching.ts`, both Firestore caches in `cache.ts`. Plus, now: the four cart
endpoints in `cart.ts`, user-token storage in `stores/userTokens.ts`, lazy Firestore +
deadlines in `db.ts`, the backfill script, and 41 unit tests that need no emulator.

**Frontend:** store picker, type-ahead combobox, `parseEntry` (+9 tests), match chips,
aisle grouping, the item sheet, batch resolution, store-switch invalidation, upsert-by-key,
running price estimate with an explicit unpriced count,
and the React port at full feature parity.

**Contract:** `MatchStatus`, `StoreProduct`, `StoreMatch`, `StoreLocation`, `match?` on
`GroceryItem`, five grocery `Unit` values. `firestore.rules` covering the new collections.

### How matching is meant to work

Two paths, and **both are required**:

1. **Type-ahead** (`AddItemCombobox`) — the primary path; typed items arrive pre-matched.
   Two rules keep it usable: **Enter with nothing highlighted always adds plain text**
   (never hijack Enter to take the top result), and no store connected means no dropdown.
2. **Batch resolve** (`resolveItems`) — items from I1/I2 are written by other teams and
   never touch the input, so they land `unresolved`. ⚠️ Not wired up yet — F2.

`MatchStatus` has eight states because they need different UI and different fixes. The two
that matter most: **`not_sold` is sticky** (otherwise "mom's birthday card" is re-flagged
forever) and **`unavailable` ≠ `no_match`** (found-but-out-of-stock has a substitute action;
found-nothing does not).

---

## Integration duties 🔗

- [ ] **I1 (with Recipe):** accept batched ingredient adds; de-dupe by `key`; return a
      summary of added vs. merged
- [ ] **I2 (with Inventory):** call `has(key)` before adding; show what got skipped and
      offer an "add anyway" override
- [ ] **I4 (with Inventory):** checked-off items flow into the pantry

---

## Gotchas

- ⚠️ **An unreachable Firestore hangs; it does not throw.** The Admin SDK retries the GCE
  metadata server for over a minute, so a missing emulator looks like a dead endpoint
  rather than an error. This ate B1. Every Firestore call on a request path now goes
  through `withDeadline()` in `db.ts` — if you add one, use it, or you are re-introducing
  the same bug in a new place.
- ⚠️ **Never call `getFirestore()` at module load.** The Functions runtime requires the
  bundle to *discover* handlers, so anything that throws at import time takes down every
  function in the codebase, including the ones that never touch Firestore. Use `db()`.
- ⚠️ **`KROGER_REDIRECT_URI` must match the dev-portal registration byte for byte.**
  A mismatch fails at the authorize step with an error that does not say so.
- ⚠️ **The Functions emulator mounts every function at `/`.** `req.path` is always `"/"`,
  so a callback URL cannot be built from it — that produced `http://127.0.0.1:5001/` and
  failed silently. `deriveCallbackUrl()` spells out both URL shapes instead, and
  `FUNCTIONS_EMULATOR` / `GCLOUD_PROJECT` are confirmed present in the emulator.
- ⚠️ **The emulator serves `functions/lib/`, not `src/`.** Run `npm run build -w functions`
  before probing or you will test the previous bundle and trust the result.
- ⚠️ **`whole milk` and `2% milk` both `normalizeKey()` to `milk`.** Two different products,
  one key. This is why the product caches key on **query text, not `ItemKey`** — a per-`key`
  memory would confidently serve whole milk to someone who asked for 2%. It also means I1
  de-dupe and I2 `has(key)` currently treat them as the same item, which is probably wrong.
  Skipped test in `items.test.ts`; needs the all-hands.
- ⚠️ **`a dozen eggs` → `dozen-egg` but `eggs` → `egg`.** `LEADING_UNITS` has no `dozen`.
  Defeats the upsert-by-key merge in `data.ts` and I1 de-dupe — `a dozen eggs` and `eggs`
  land as two rows. One-line fix, deferred pending sign-off.
- Kroger product names are messy. The scorer weights stemmed token *coverage* of the query
  and does **not** penalise extra brand words — "Kroger® 2% Reduced Fat Milk" is a good
  answer to "2% milk". Auto-accept needs ≥0.8 **and** a ≥0.15 gap to the runner-up. A
  silently wrong match is found at checkout, not in the app.
- The client-credentials token expires (~30 min). `token.ts` caches with a 60s margin *and*
  retries once on 401 — a cache without expiry handling gives intermittent 401s that look
  like random failures.
- Prices and stock are per-location and Kroger **omits them entirely** without
  `filter.locationId`. That is why `locationId` lives on `StoreMatch` (see F4).
- Functions bundle via esbuild, inlining `@grocery/shared` raw TS. Import from
  `@grocery/shared/items` or `/types`, **never the package root** — the root barrel pulls in
  the client Firebase SDK. `health.ts` calls `normalizeKey()` on purpose so a broken bundle
  fails the health check instead of producing wrong matches weeks later.
- `STORE_ADAPTER=mock` forces `MockStore` even with credentials. Use it if Kroger is
  rate-limited or down mid-demo.
- `firestore.rules` in test mode expires. Set a reminder or the app dies mid-demo.
- Don't regress the existing app. Whatever else happens, someone's real grocery list has to
  keep working.
