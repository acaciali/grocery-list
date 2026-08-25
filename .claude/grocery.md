# 🛒 Grocery — Todo

**MVP:** connect to one store, create a list
**Bonus:** push items into a real cart
**Owns:** `/grocery/`, `/functions/stores.js`, `groceries` collection

> You inherit the only working code in the repo. Your first job is upgrading it without
> breaking it — the existing app is real and in use.

---

## Backend

### Upgrade the existing list
- [ ] Extend `groceries` docs **additively**: keep `name`, `checked`, `createdAt` exactly
      as they are; add `key`, `quantity`, `unit`, `category`, `source`, `sourceId`,
      `storeProductId` as optional
- [ ] Backfill `key` and `category` for existing docs via a one-off script
- [ ] Every read path must tolerate the old shape (missing fields) — don't crash on legacy rows
- [ ] Upsert-by-key: adding a duplicate bumps quantity instead of creating a second row
- [ ] Update `firestore.rules` for the new fields

### Kroger integration
- [ ] **Register at the Kroger developer portal on day one** — approval is not instant and
      it gates the whole MVP
- [ ] Client ID + secret in Cloud Function config, never in the browser
- [ ] Client-credentials OAuth2 token helper, with caching + refresh (tokens are short-lived)
- [ ] `GET /findStores?zip=` → nearby locations
- [ ] `GET /searchProducts?q=&locationId=` → products with name, size, price, image, `productId`
- [ ] **Build behind a `StoreAdapter` interface** with a `MockStore` implementation, so the
      whole UI is buildable and demoable before credentials land — and so store #2 is easy later
- [ ] Cache store lookups (limit is ~1,600/day per Locations endpoint)
- [ ] Debounce search; do not fire on every keystroke

### Cart *(bonus)*
- [ ] User OAuth2 flow — separate from client credentials, requires the user's Kroger login
- [ ] Token storage + refresh handling
- [ ] `POST /addToCart` with `{ productId, quantity }[]`
- [ ] **Mirror cart state in Firestore.** The Public API is write-only: you cannot read the
      cart back or remove items. Our mirror is the only cart state we have.
- [ ] "Sent to cart" timestamp per item + a link out to kroger.com to check out

---

## Frontend

### The list
- [ ] Port today's app to React + TS in Phase 0, keeping every behavior: add, check
      off, delete, clear checked, live sync
- [ ] Show quantity + unit on each row
- [ ] **Group by aisle/category** — the single biggest real-world usability win
- [ ] Source badge: manual vs. from a recipe (link back to the recipe)
- [ ] Inline quantity editing
- [ ] Keep unchecked-first, newest-first ordering; checked items fall to the bottom

### Store connection
- [ ] Store picker: enter ZIP → pick a location → save to `users/{uid}`
- [ ] Show connected store in the header; allow switching
- [ ] Product search UI with images, sizes, prices
- [ ] "Add to list" from a search result, carrying `storeProductId`
- [ ] Handle "no store connected" without breaking the plain list — **the list must stay
      fully usable with zero store integration.** Never let store code become a hard dependency.

### Cart UI *(bonus)*
- [ ] Match each list item to a Kroger product, **show the match, let the user correct it**
- [ ] Running price estimate
- [ ] "Send to Kroger cart" with per-item success/failure
- [ ] Honest empty/error states given we can't read the cart back

---

## Integration duties 🔗

- [ ] **I1 (with Recipe):** accept batched ingredient adds; de-dupe by `key`; return a
      summary of added vs. merged
- [ ] **I2 (with Inventory):** call `has(key)` before adding; show what got skipped and
      offer an "add anyway" override
- [ ] **I4 (with Inventory):** checked-off items flow into the pantry

---

## Gotchas

- Kroger product names are messy (`"Kroger® 2% Reduced Fat Milk, 1 gal"`). Fuzzy matching
  to `key` will be imperfect — **always show the match and let the user fix it.** A confirm
  step is honest, not a cop-out.
- The token from client credentials expires. Cache it *and* handle expiry, or you'll get
  intermittent 401s that look like random failures.
- Prices are per-location. A `locationId` is required for real pricing.
- `firestore.rules` in test mode expires. Set a calendar reminder or the app dies mid-demo.
- Don't regress the existing app. Whatever else happens, someone's real grocery list has to
  keep working.
