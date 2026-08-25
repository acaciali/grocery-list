# CLAUDE.md

Context for Claude Code and for humans. Read this before touching anything.

---

## What we're building

A closed-loop kitchen app. Three teams, three surfaces, one product:

```
   RECIPE  ──► GROCERY ──► STORE (Kroger)
      ▲            │
      │            ▼
   INVENTORY ◄─────┘
```

You find a recipe → missing ingredients land on your grocery list → the list goes to your
store cart → what you buy lands in your pantry → your pantry suggests the next recipe.
**Every team's output is another team's input.** That is why the data contract below is
non-negotiable.

| Project | MVP | Bonus |
|---|---|---|
| Recipe | Import from a URL + add your own | AI generates recipes from what you have |
| Inventory | Manually log what's in the pantry | 📸 Photograph a shelf → AI guesses the items → bulk add |
| Grocery | Connect to one store, build a list | Push the list into a real cart |

---

## ⭐ The stack

**TypeScript end to end. React + Vite on the front, Firebase Cloud Functions on the back,
Firestore for data.**

The load-bearing choice here is **TypeScript, not React.** Three teams sharing one data
contract is exactly the situation where types stop being ceremony and start being the
thing that holds the project together. A Recipe dev who returns the wrong ingredient shape
gets a red squiggle in their editor instead of an integration bug three weeks later. Our
single biggest project risk is schema drift between teams, and types are the cheapest
possible mitigation.

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript | One `Item` type shared by all three teams *and* the backend |
| Frontend | React + Vite | Component reuse across three surfaces; near-zero Vite config |
| Styling | Tailwind | Utility classes cannot collide — removes the CSS-prefix discipline entirely |
| Backend | Firebase Cloud Functions (TS) | Same language, same types, same deploy as everything else |
| Data | Firestore | Real-time sync for free; already working; fits our key-based lookups |
| Auth | Firebase Auth | Needed anyway for store prefs and Kroger account linking |
| Monorepo | npm workspaces | Built into npm. No Nx/Turborepo needed at this size. |

**Honest tradeoffs:**

- *Firestore* has no joins and limited compound queries. That would hurt a reporting-heavy
  app; our queries are "look up by `key`," which Firestore does very well. If this ever
  outgrows it, the Cloud Functions layer is already the seam to swap behind.
- *Python* is genuinely tempting for recipe scraping — the ecosystem there is more mature.
  We're not taking it as the default because splitting languages means the backend can't
  share the `Item` type with the frontend, which is the whole point. But it's not a locked
  door: Firebase Functions 2nd gen supports Python and Node side by side, so if JSON-LD
  parsing gets ugly we can add **one** Python function without relocating anything else.
- *Svelte* has nicer ergonomics than React. We're picking React for the larger ecosystem,
  easier onboarding, and — practically relevant here — better coverage in the training data
  of the AI tools we're using, which makes Claude Code meaningfully more reliable on it.

**Do this migration in Phase 0, not later.** The current app is ~150 lines across three
files. Porting it is half a day now and a painful mid-sprint detour at any other time.

---

## Current state of the repo

Today it is flat, no-build, vanilla JS:
`index.html`, `groceries.js`, `style.css`, `firebase-config.js`, `firestore.rules`.

⚠️ **`firebase-config.js` still points at a real private family grocery list.** Point it at
a fresh Firebase project before anyone commits. Phase 0, task #1.

---

## Repo layout

```
/packages/shared/src/
  types.ts             ⭐ Item, Recipe, InventoryItem, GroceryItem, Unit, Category
  items.ts             ⭐ normalizeKey(), parseIngredientLine()
  firebase.ts          initialized app + typed db handle
/apps/web/src/
  routes/recipe/       ← Recipe team owns
  routes/inventory/    ← Inventory team owns
  routes/grocery/      ← Grocery team owns
  components/          shared UI — announce before editing
  App.tsx  main.tsx
/functions/src/
  index.ts             exports only
  recipes.ts  stores.ts  vision.ts  ai.ts
/docs/todos/           recipe.md  inventory.md  grocery.md
PLAN.md
```

**Rules that keep us out of merge hell:**

1. Only edit files under your own `routes/` folder. Need something in `packages/shared` or
   `components/`? Post in the team channel first, then edit — additive changes only.
2. One React app with three route sections, not three apps. Shared nav, shared auth,
   one deploy.
3. Tailwind handles styling. No global stylesheets beyond the Tailwind base — this is what
   kills the CSS-collision problem for good.
4. Small PRs, one feature each. Anything touching `packages/shared` gets a second reviewer.

---

## ⭐ The data contract

All three projects speak in **items**, and they only interoperate if the shape matches.

```ts
// packages/shared/src/types.ts

export type Unit = 'g' | 'kg' | 'oz' | 'lb' | 'ml' | 'l'
                 | 'tsp' | 'tbsp' | 'cup' | 'clove' | 'can' | 'pkg';

export type Category = 'produce' | 'dairy' | 'meat' | 'seafood' | 'bakery'
                     | 'pantry' | 'canned' | 'frozen' | 'spices'
                     | 'beverages' | 'other';

/** A branded string. Only normalizeKey() can produce one. */
export type ItemKey = string & { readonly __brand: unique symbol };

export interface Item {
  key: ItemKey;          // normalized identity — how items match ACROSS apps
  name: string;          // display text, whatever the human or site called it
  category: Category;
  quantity?: number | null;
  unit?: Unit | null;
}
```

`key` is the join column of the entire product — it's how a recipe's *"2 cups whole milk"*
matches inventory's *"Whole milk"* matches Kroger's *"Kroger® Whole Milk Gallon"*.

The branded `ItemKey` type is doing real work: because `ItemKey` is not assignable from a
plain `string`, passing an un-normalized value where a key belongs is a **compile error**.
The rule "always use `normalizeKey()`" stops being a convention people forget and becomes
something the compiler enforces. 💗

```ts
// packages/shared/src/items.ts
export function normalizeKey(raw: string): ItemKey;   // the only source of ItemKey
export function parseIngredientLine(line: string): Item;
```

Adding a `Unit` or `Category` value is fine; changing or removing one breaks the other two
teams, so announce it.

### Firestore collections

`groceries` already exists and is live — **extend it additively so today's app keeps working**:

```ts
// groceries/{id}
interface GroceryItem {
  name: string; checked: boolean; createdAt: Timestamp;   // existing, unchanged
  key?: ItemKey; quantity?: number | null; unit?: Unit | null; category?: Category;
  source?: 'manual' | 'recipe' | 'inventory';
  sourceId?: string | null;          // trace + de-dupe
  storeProductId?: string | null;
}

// inventory/{id}
// Presence-based: we track WHETHER you have something, not how much.
interface InventoryItem {
  key: ItemKey; name: string; category: Category;
  location: 'pantry' | 'fridge' | 'freezer';
  addedVia: 'manual' | 'photo' | 'barcode' | 'grocery';
  confidence?: number | null;        // 0–1, only when addedVia === 'photo'
  quantity?: number | null; unit?: Unit | null;
  upc?: string | null; expiresAt?: Timestamp | null; updatedAt: Timestamp;
}

// recipes/{id}
interface Recipe {
  title: string; sourceUrl?: string; imageUrl?: string; servings?: number;
  ingredients: Item[]; steps: string[]; tags: string[];
  createdBy: string; createdAt: Timestamp;
}

// users/{uid}
interface UserPrefs { storeLocationId?: string; storeName?: string; zip?: string; }
```

---

## Architecture: where does code go?

The browser talks straight to Firestore for our own data — fast, real-time, free. Keep that.

**Put it in a Cloud Function when either is true:**

- 🔑 **It needs a secret.** Kroger client secret, Anthropic API key. Anything in browser JS
  is public. No exceptions, not even "just for the demo."
- 🚧 **CORS will block it.** You cannot `fetch()` allrecipes.com or Kroger's API from a
  browser. The function is our proxy.

All three teams hit this on day one. It is not a bug, it is the design.

| Endpoint | Owner | Purpose |
|---|---|---|
| `POST /importRecipe` | Recipe | `{url}` → fetch page, parse JSON-LD, return `Recipe` |
| `POST /generateRecipe` | Recipe | `{keys[]}` → Claude API → `Recipe` *(bonus)* |
| `POST /analyzeShelf` | Inventory | `{image}` → Claude vision → candidate `Item[]` *(bonus)* |
| `GET /lookupBarcode` | Inventory | `?upc=` → Open Food Facts *(extra)* |
| `GET /findStores` | Grocery | `?zip=` → nearby Kroger locations |
| `GET /searchProducts` | Grocery | `?q=&locationId=` → Kroger product search |
| `POST /addToCart` | Grocery | `{items[]}` → Kroger cart *(bonus)* |

Functions import types from `packages/shared`, so a handler returning the wrong shape fails
to compile. Secrets go in Firebase config / `.env`, **never** in the repo.

---

## Gotchas worth knowing before you start

**Recipe import — don't scrape the DOM.** Nearly every recipe site embeds
`<script type="application/ld+json">` with schema.org `"@type": "Recipe"` — clean
structured data, same code for every site, doesn't break on redesigns. DOM fallback only.

**Kroger's cart is one-way.** On the Public API you can add items to a cart but not read it
back or remove items — that needs the Partner API, which means a contract with Kroger. Keep
our own cart mirror in Firestore and treat "send to cart" as fire-and-forget. Design the UI
around that from day one rather than discovering it at 2am.

**Kroger rate limits** are roughly 10,000 calls/day for Products, 1,600/day per endpoint for
Locations, 5,000/day for Cart. Generous, but cache store lookups and debounce search.

**Kroger has two auth modes.** Client-credentials OAuth2 covers product and location data;
cart operations need user-based authorization. That is exactly why search is MVP and cart is
bonus.

**Camera:** `getUserMedia` requires HTTPS or `localhost`. It silently fails on a LAN IP like
`192.168.1.5:5173`. Use localhost or a tunnel.

**Shelf photos: resize before you send.** Claude's standard image tier caps at 1568px on the
long edge and ~1568 visual tokens; anything larger is downscaled server-side, adding latency
for zero accuracy gain. Downscale client-side with a canvas to ~1568px long edge before
base64-encoding. Don't overcorrect — edges under 200px degrade recognition. Formats: JPEG,
PNG, GIF, WebP (**not HEIC**, which is what iPhones shoot; the canvas step converts it).

**Vision output is a suggestion, not a fact.** Anthropic's docs say not to use Claude for
tasks needing perfect precision without human oversight. A wrong pantry entry silently
breaks I2 and I5, so **the review screen is mandatory** — never write a guess straight to
Firestore.

**Firestore `serverTimestamp()`** is `null` on the local echo before the server round-trips.
Guard your sort so the list doesn't flicker.

---

## Conventions

- `camelCase` for TS, `PascalCase` for components, `kebab-case` for files
- No `any`. If you're reaching for it, the contract is probably wrong — raise it.
- Branches: `recipe/import-from-url`, `grocery/kroger-search`, `inventory/shelf-capture`
- Commits: `recipe: parse JSON-LD from imported URLs`
- `npm run dev` (Vite), `npm run emulators` (Firebase), `npm run typecheck` before pushing

---

## Working with Claude Code on this repo

- Point it at this file plus the relevant `docs/todos/*.md`.
- Tell it to **read `packages/shared/src/types.ts` before writing any feature code** so it
  uses the real contract instead of inventing a parallel one. This is the #1 failure mode,
  and typechecking catches it if the instruction doesn't.
- Cloud Functions and Firestore rules are easy to get subtly wrong. Have it explain a rule
  before you deploy it.
- For AI features, pin an explicit model string from
  https://docs.claude.com/en/docs/about-claude/models rather than guessing one.

---

## Where to go next

- 📋 [PLAN.md](./PLAN.md) — phased plan and integration milestones
- ✅ [docs/todos/recipe.md](./docs/todos/recipe.md) · [inventory.md](./docs/todos/inventory.md) · [grocery.md](./docs/todos/grocery.md)
