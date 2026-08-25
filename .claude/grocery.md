# 🛒 Grocery — Todo

**MVP:** connect to one store, create a list
**Bonus:** push items into a real cart
**Owns:** `/grocery/`, `/functions/stores.ts`, `groceries` collection

> You inherit the only working code in the repo. Your first job is upgrading it without
> breaking it — the existing app is real and in use.

---

## 📍 Where this stands

Backend and frontend for **store connection, search, and matching are built**. Cart push is
not. Nothing has run against the live Kroger API — every result so far is `MockStore`.

`npm run typecheck` and `npm run build` clean. `npm run test` green (19 shared + 9 web).

**Resume at:** `resolveItems` verification (see Backend → Kroger integration below).

**Environment blockers, both one-time:**
- Java is not installed → Firestore/Auth emulators cannot start, only Functions.
  `brew install --cask temurin`
- `firebase login` has not been run
- `firestore.rules` has not been deployed

---

## ⚠️ Corrections to CLAUDE.md — need team sign-off

1. **`POST /addToCart` takes UPC, not `productId`.** CLAUDE.md's endpoint table says
   `{productId, quantity}[]`. The Kroger Public API is `PUT /v1/cart/add` with
   `{ items: [{ upc, quantity, modality }] }`. Our code persists `upc` on every match
   already, but the doc should be fixed before someone builds to it.
2. **Phase 0 never created `functions/` or `firebase.json`,** although root `package.json`
   already declared `"functions"` as a workspace and `npm run emulators` already referenced
   the functions emulator. Grocery built them, since Grocery needed them first.
3. **`ensureSignedIn()` was never called** anywhere, so `currentUid()` threw. Now called from
   `App.tsx` — deliberately *without* gating route rendering, because a failed anonymous
   sign-in must not take down a grocery list that predates auth and has open rules.

---

## Backend

### Upgrade the existing list
- [x] Extend `groceries` docs **additively**: `name`, `checked`, `createdAt` unchanged; added
      `key`, `quantity`, `unit`, `category`, `source`, `sourceId`, `storeProductId`, `match`
- [ ] Backfill `key` and `category` for existing docs via a one-off script
- [x] Every read path tolerates the old shape — no field is required
- [ ] Upsert-by-key: adding a duplicate bumps quantity instead of creating a second row
- [x] Update `firestore.rules` for the new fields *(written, **not deployed**)*

### Kroger integration
- [x] Registered — credentials in hand
- [x] Client ID + secret read from Functions env, never the browser (`functions/.env.example`)
- [x] Client-credentials token helper with caching + refresh-once-retry on 401 (`token.ts`)
- [x] `GET /findStores?zip=`
- [x] `GET /searchProducts?q=&locationId=`
- [x] **`StoreAdapter` interface with `MockStore`** — fixtures cover every `MatchStatus`:
      clean match, 5-way ambiguous, out-of-stock, zero-result, and a slow response
- [x] Cache store lookups *(per-session in `StorePicker`; durable shared cache still TODO)*
- [x] Debounce search — 250ms + `AbortController` per keystroke
- [ ] ⚠️ **`POST /resolveItems` — written but UNVERIFIED.** The probe returned no output and
      was never diagnosed. Start here. Also `POST /rememberChoice` alongside it.

### Cart *(bonus)* — not started
- [ ] User OAuth2 flow. *Helpers already exist:* `exchangeAuthCode()` and `refreshUserToken()`
      in `functions/src/stores/token.ts`. Needs a registered redirect URI.
- [ ] Token storage at `users/{uid}/private/kroger` — Admin SDK only. The rule denying all
      client access to `users/{uid}/private/**` is already written.
- [ ] `POST /addToCart`. *`KrogerStore.addToCart()` already exists* and sends `upc`.
- [ ] **Mirror cart state in Firestore** (`cartBatches`) — rule already written
- [ ] "Sent to cart" timestamp per item + link out to kroger.com

---

## Frontend

All under `apps/web/src/routes/grocery/`, reusing the existing Tailwind tokens.

### The list
- [x] Ported to React + TS with every behavior intact: add, check off, delete, clear checked,
      live sync
- [x] Show quantity + unit on each row
- [x] **Group by aisle/category** — in real shopping order, not alphabetical, and only once
      there are ≥4 unchecked items (grouping two items helps nobody)
- [x] Source badge for recipe items *(no link back yet — needs a recipe route to link to)*
- [ ] Inline quantity editing
- [x] Unchecked-first, newest-first; checked items fall to the bottom

### Store connection
- [x] Store picker: ZIP → pick a location → save to `users/{uid}` (`StorePicker.tsx`)
- [x] Connected store in the header, tappable to switch
- [x] Product search UI with images, sizes, prices
- [x] "Add to list" from a search result, carrying the full match
- [x] **"No store connected" degrades cleanly** — no dropdown, no spinner, no error; the input
      behaves exactly as it did before. The list is fully usable with zero store integration.
- [ ] Store-switch invalidation banner ("Store changed · N items need re-checking")

### Cart UI *(bonus)*
- [x] Match shown per row and correctable (`MatchChip.tsx` + `MatchPicker.tsx`)
- [x] Running price estimate — with an explicit count of unpriced items, never a partial
      total presented as complete
- [ ] "Send to Kroger cart" with per-item success/failure
- [ ] Honest empty/error states given we can't read the cart back

### How matching actually works

`grocery.md` said "show the match and let the user correct it" but never said *when* matching
happens. It happens two ways:

1. **Type-ahead** (`AddItemCombobox.tsx`) — the primary path. Items you type arrive already
   matched. Two rules keep it from fighting fast typing: **Enter with nothing highlighted
   always adds plain text** (never hijack Enter to take the top result), and no store
   connected means no dropdown at all.
2. **Batch resolve** (`POST /resolveItems`) — required regardless, because items from I1 and
   I2 are written by other teams and never touch the input. They land `unresolved`.

`MatchStatus` distinguishes eight states because they need different UI and different fixes.
The two that matter most: **`not_sold` is sticky** (otherwise "mom's birthday card" gets
re-flagged forever) and **`unavailable` ≠ `no_match`** (found-but-out-of-stock has a
substitute action; found-nothing doesn't).

---

## Integration duties 🔗

- [ ] **I1 (with Recipe):** accept batched ingredient adds; de-dupe by `key`; return a
      summary of added vs. merged
- [ ] **I2 (with Inventory):** call `has(key)` before adding; show what got skipped and
      offer an "add anyway" override
- [ ] **I4 (with Inventory):** checked-off items flow into the pantry

---

## Gotchas

- ⚠️ **`whole milk` and `2% milk` both `normalizeKey()` to `milk`.** Two genuinely different
  products, one key. This is why our product caches key on **query text, not `ItemKey`** — a
  per-`key` memory would confidently serve whole milk to someone who asked for 2%. It also
  means I1 de-dupe and I2 `has(key)` currently treat them as the same item, which is probably
  wrong. Recorded as a skipped test in `items.test.ts`; needs the all-hands.
- ⚠️ **`a dozen eggs` → `dozen-egg` but `eggs` → `egg`.** `LEADING_UNITS` has no `dozen`.
  Two keys for one thing defeats upsert-by-key and I1 de-dupe. One-line fix, deferred because
  `normalizeKey` is pending sign-off. Also a skipped test.
- Kroger product names are messy. Our scorer weights stemmed token *coverage* of the query and
  does **not** penalise extra brand words on the product side — "Kroger® 2% Reduced Fat Milk"
  is a good answer to "2% milk". Auto-accept needs ≥0.8 **and** a ≥0.15 gap to the runner-up;
  everything else asks. A silently wrong match is found at checkout, not in the app.
- The client-credentials token expires (~30 min). `token.ts` caches with a 60s margin *and*
  retries once on 401 — a cache without expiry handling gives intermittent 401s that look
  like random failures.
- Prices and stock are per-location, and Kroger **omits them entirely** unless
  `filter.locationId` is passed. That's why `locationId` lives on `StoreMatch` and switching
  stores invalidates matches.
- `firestore.rules` in test mode expires. Set a calendar reminder or the app dies mid-demo.
- Functions bundle via esbuild, inlining `@grocery/shared` raw TS. Import from
  `@grocery/shared/items` or `/types`, **never the package root** — the root barrel pulls in
  the client Firebase SDK. `health.ts` calls `normalizeKey()` on purpose so a broken bundle
  shows up as a failed health check instead of a wrong match weeks later.
- `STORE_ADAPTER=mock` forces `MockStore` even with credentials present. Use it if Kroger is
  rate-limited or down mid-demo.
- Don't regress the existing app. Whatever else happens, someone's real grocery list has to
  keep working.
