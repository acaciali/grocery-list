# PLAN.md — One Project, Three Teams

Read [CLAUDE.md](./CLAUDE.md) first for architecture and the data contract.

---

## The idea in one picture ✨

We are not building three apps. We are building one loop, and each team owns one arc of it:

```
        ┌─────────────────────────────────────────────┐
        │                                             │
        ▼                                             │
   ┌─────────┐  ingredients   ┌─────────┐  list   ┌───┴────┐
   │ RECIPE  │ ─────────────► │ GROCERY │ ──────► │ KROGER │
   └─────────┘                └─────────┘         └────────┘
        ▲                          │                   │
        │  "what can I make?"      │ checked off       │ bought
        │                          ▼                   │
   ┌─────────────────────────────────────────────┐     │
   │                 INVENTORY                   │ ◄───┘
   └─────────────────────────────────────────────┘
```

Every arrow in that diagram is an **integration milestone** (I1–I5 below). The MVPs
build the boxes; the integrations build the arrows. A demo with three polished boxes and
no arrows is three demos. A demo with rough boxes and working arrows is a product.

**Plan the arrows in from the start.** They are the part teams always leave for the last
day, and they are the part that requires two teams to agree.

---

## Phase 0 — Shared foundation 🚧 ALL HANDS, BLOCKING

**Nobody starts feature work until this is done.** It is a few hours of work and it
prevents days of rework. Do it together, in one room or one call.

### Project + data
- [ ] Create a fresh Firebase project; Firestore in test mode is fine to start
- [ ] Enable Firebase Auth (anonymous or Google — needed for `users/{uid}` and Kroger linking)
- [ ] Publish `firestore.rules`; export the existing `groceries` data if we want to keep it

### Scaffold the stack
- [ ] npm workspaces monorepo: `packages/shared`, `apps/web`, `functions`
- [ ] `apps/web` — Vite + React + TypeScript + Tailwind, three empty routes and a nav
- [ ] `functions` — Firebase Functions in TypeScript, one deployed hello-world endpoint
- [ ] `packages/shared` wired into both, with `npm run typecheck` green
- [ ] `.gitignore` for `.env`, `node_modules`, `.firebase`, `dist`
- [ ] Firebase emulator suite running locally so nobody develops against prod

### Port the existing app
- [ ] Move the current grocery list into `apps/web/src/routes/grocery/` as React + TS
- [ ] Verify add / check off / delete / clear-checked / live sync all still work
- [ ] ~150 lines total. Half a day. **Do it now, not in Phase 2.**

### ⭐ Write the contract, together
- [ ] `packages/shared/src/types.ts` — `Item`, `Recipe`, `InventoryItem`, `GroceryItem`,
      `Unit`, `Category`, branded `ItemKey`
- [ ] `packages/shared/src/items.ts` — `normalizeKey()`, `parseIngredientLine()`
- [ ] Whiteboard 15 real ingredient strings and agree on what each normalizes to.
      *This conversation is the single highest-leverage hour of the project.*
- [ ] Agree on the Tailwind theme (colors, spacing, type scale) so three surfaces look
      like one app

### Unblock the long poles
- [ ] Register a Kroger developer account — **day one**, approval is not instant and it
      gates the Grocery MVP
- [ ] Get an Anthropic API key into Functions config (Recipe AI + Inventory vision)

**Exit criteria:** every teammate can clone, `npm install`, `npm run dev`, see the nav,
add a grocery item that persists, and get a clean `npm run typecheck`.

---

## Phase 1 — MVPs in parallel

Three teams, three folders, no blocking. Each team builds against `shared/items.js` and
**stubs the other teams' pieces** rather than waiting on them.

| Team | Ships by end of Phase 1 |
|---|---|
| Recipe | Paste a URL → parsed recipe saved and displayed. Manual recipe form works. |
| Inventory | Add / edit / delete pantry items with quantity, unit, location. Grouped list. |
| Grocery | Kroger store picker + product search. Existing list upgraded to the Item shape. |

Full checklists: [recipe](./docs/todos/recipe.md) · [inventory](./docs/todos/inventory.md) · [grocery](./docs/todos/grocery.md)

**Mid-phase checkpoint (do not skip):** each team demos for 5 minutes and shows one real
Firestore document. Compare them side by side. If the shapes have drifted, fix it *now*
— reconciling three divergent schemas in Phase 2 is the classic way this kind of project
falls apart.

---

## Phase 2 — Integrations (the arrows) 🔗

Each integration is owned by **two** teams. Pair on them; do not throw them over the wall.

**I1 · Recipe → Grocery** *(Recipe + Grocery)*
"Add missing ingredients to list" button on a recipe. Writes to `groceries` with
`source: "recipe"` and `sourceId`. De-dupe by `key`: if it is already on the list,
bump quantity instead of adding a second row.

**I2 · Inventory → Grocery** *(Inventory + Grocery)*
Before adding, check `inventory` for each `key` via `has(key)`. Already own it? Skip it
and tell the user what was skipped, with an "add anyway" override. This is the feature
that makes the app feel smart, and it is cheap once `key` is trustworthy.

**I3 · Grocery → Kroger** *(Grocery)*
Map list items to Kroger `productId` via search. Show the match and let the user correct
it — auto-matching groceries is genuinely hard and a confirm step is honest, not lazy.

**I4 · Grocery → Inventory** *(Grocery + Inventory)*
Checking an item off writes it into `inventory`. Closes the loop. Small change, huge
demo moment.

**Exit criteria:** you can go recipe → list → cart → pantry without touching the console.

---

## Phase 3 — Bonuses

Order matters: I4 first, because Inventory→Recipe AI is only impressive if the pantry has
real data in it.

- 📸 **Shelf photo → bulk add** *(Inventory)* — capture or pick a photo, downscale in a
  canvas, send to a Cloud Function calling Claude vision, get back candidate items as
  strict JSON, show a **review grid**, bulk-upsert what the user confirms. This is now the
  primary Inventory bonus.
- **Barcode scanning** *(Inventory, extra)* — `BarcodeDetector` with a ZXing fallback.
  UPC → Open Food Facts → prefilled item. Nice for precision on packaged goods once the
  photo flow works.
- **AI recipe generation** *(Recipe)* — read the user's `inventory`, send keys to a Cloud
  Function calling the Claude API, ask for strict JSON matching the Recipe shape, save it
  like any other recipe. Because the output uses the same shape, I1 works on it for free.
  *That is the payoff for the Phase 0 contract work.*
- **Add to Kroger cart** *(Grocery)* — user OAuth, then push items. Remember the cart is
  write-only; mirror state locally.

---

## Phase 4 — Polish and demo

- [ ] Empty states for all three surfaces (a blank app demos badly)
- [ ] Loading and error states on every network call — imports and store lookups are slow
- [ ] Tighten `firestore.rules` off test mode before anything goes public
- [ ] Mobile check: this is a phone app in real life
- [ ] Seed a demo account with 2 recipes and ~15 pantry items
- [ ] **Rehearse the loop once, start to finish, on the real device you will demo on**
- [ ] README with setup steps for a new contributor

---

## Risk register 🎯

| Risk | Why it bites | What we do |
|---|---|---|
| Kroger API approval is slow | Blocks the Grocery MVP entirely | Register day one. Build behind a `StoreAdapter` interface with a `MockStore` so the UI is testable without credentials. |
| Ingredient matching is fuzzy | "2 cups whole milk" vs "Whole Milk, Gallon" | One shared `normalizeKey`. Always show the match and let users correct it. |
| Vision misidentifies shelf items | Bad pantry data silently breaks I2 and I5 | Mandatory review screen. Pre-check high-confidence only. Never auto-save. |
| Three teams drift on schema | Integrations fail in Phase 2 | Shared TS types + branded `ItemKey` make drift a compile error. Plus the Phase 1 checkpoint. |
| Merge conflicts in shared files | Constant, morale-killing | Route-folder ownership + Tailwind (no shared CSS to collide) + announce `packages/shared` edits. |
| Secrets leak into the client | Real, public consequences | All third-party calls go through Cloud Functions. `.env` gitignored on day one. |
| Bonuses eat MVP time | Demo has flash but no substance | MVPs and I1–I4 first. Bonuses are genuinely optional. |

---

## Definition of done, per feature

0. `npm run typecheck` passes with no `any`
1. Works against the real Firestore project, not local state
2. Reads and writes the shared Item shape
3. Has a loading state and an error state
4. Usable on a phone screen
5. Another teammate has run it on their own machine
