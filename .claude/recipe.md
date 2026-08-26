# 🍳 Recipe — Todo

**MVP:** import recipes from a website, add your own
**Bonus:** AI generates recipes from what's in your inventory
**Owns:** `/recipe/`, `/functions/recipes.js`, `/functions/ai.js`, `recipes` collection

---

## Backend

### Import from a URL
- [ ] `POST /importRecipe` Cloud Function, accepts `{ url }`
- [ ] Server-side fetch of the page (this is why it's a function — CORS blocks the browser)
- [ ] Extract `<script type="application/ld+json">`, find the node where `@type` is `Recipe`
  - [ ] Handle `@graph` arrays — many sites nest the Recipe inside one
  - [ ] Handle `@type` being an array (`["Recipe","NewsArticle"]`)
- [ ] Map schema.org fields → our Recipe shape:
  - `name` → `title`, `image` → `imageUrl`, `recipeYield` → `servings`
  - `recipeIngredient[]` → `ingredients[]`, `recipeInstructions[]` → `steps[]`
  - [ ] `recipeInstructions` comes as strings *or* `HowToStep` objects *or* `HowToSection`
        groups. Handle all three.
- [ ] Run each ingredient line through `parseIngredientLine()` → `{key, name, quantity, unit}`
- [ ] Fallback path for sites with no JSON-LD: microdata, then a clear "couldn't parse,
      here's the manual form prefilled with the title" error
- [ ] Timeout the fetch (5s) and cap response size — don't let a slow site hang the function
- [ ] Return a consistent error shape the frontend can render

### AI generation *(bonus)*
- [ ] `POST /generateRecipe`, accepts `{ ingredients: [key], constraints? }`
- [ ] Anthropic API key in function config, never client-side
- [ ] Prompt returns **strict JSON only** — no prose, no markdown fences
- [ ] Ask for ingredients already in our `{key, name, quantity, unit, category}` shape so
      the result drops straight into the same save path as an imported recipe
- [ ] Validate the JSON before saving; retry once on parse failure
- [ ] Pin a specific model string from https://docs.claude.com/en/docs/about-claude/models
- [ ] Surface a friendly message on rate limit / timeout

---

## Frontend

### Browse & view
- [ ] `routes/recipe/` + real-time `onSnapshot` list, typed as `Recipe[]`
- [ ] Recipe card: image, title, servings, ingredient count
- [ ] Detail view: ingredients list, numbered steps, link back to `sourceUrl`
- [ ] Search / filter by title and tag
- [ ] Empty state: "No recipes yet — paste a link to get started"

### Import flow
- [ ] URL paste box + Import button
- [ ] Loading state — imports take a few seconds and silence feels broken
- [ ] **Preview-before-save screen.** Parsing is imperfect; let the user fix the title,
      servings, and any mangled ingredient line before it hits the database.
- [ ] Clear failure state with a "enter it manually instead" escape hatch

### Manual entry
- [ ] Form: title, servings, ingredients (repeatable rows), steps (repeatable rows)
- [ ] Ingredient row = quantity + unit dropdown (from `UNITS`) + name
- [ ] Paste-a-block shortcut: textarea of ingredient lines → `parseIngredientLine()` each
- [ ] Edit an existing recipe with the same form
- [ ] Delete with confirm

### Bonus UI
- [ ] "What can I make?" — reads `inventory`, calls `/generateRecipe`
- [ ] Show which of your ingredients it used vs. what you'd still need to buy
- [ ] Save generated recipes alongside imported ones, tagged `ai-generated`

---

## 🥫➜🍳 Cook from the pantry

Ranks the cookbook by how well each recipe matches what's actually in the pantry. This is
the INVENTORY ──► RECIPE arrow from CLAUDE.md — the last one in the loop.

### Backend — ✅ done

Not a Cloud Function, deliberately: no secret, no CORS, and both collections are ones the
browser already reads directly. A function here would add a hop, lose real-time, and cost
money to run `Set.has()`. It lives in shared alongside `inventory.ts` instead.

- [x] `packages/shared/src/matching.ts` — pure scoring, no Firestore, no clock
  - `matchRecipes(recipes, pantryKeys, options)` → ranked `RecipeMatch[]`
  - `matchRecipe(recipe, pantryKeys, assumedKeys?)` — one recipe, for the detail screen
  - `missingAcross(matches)` — de-duped shopping list across a selection, ready for I1
  - `COMMON_STAPLES` — salt/pepper/water, opt-in via `assumedKeys`
- [x] `packages/shared/src/recipes.ts` — the cookbook reads that were missing
  - `listRecipes()` · `getRecipe(id)` · `subscribeToRecipes(cb, onError)` → `RecipeRow`
  - `findRecipeMatches(options)` — one-shot: both reads in parallel, then rank
- [x] Tests: `matching.test.ts` (pure, 30 cases), `recipes.test.ts` (Firestore mocked)

**Three sort modes, because "matches the most" has three honest readings:**

| `sort` | Orders by | Answers |
|---|---|---|
| `'missing'` *(default)* | fewest items to buy | "What can I cook tonight?" |
| `'coverage'` | highest fraction of the recipe | fairest across recipe sizes |
| `'matches'` | most ingredients matched | the literal reading — favours long recipes |

Default is `'missing'` because a 20-ingredient curry you have 15 of is not dinner, and a
3-ingredient pasta you have all of is.

### Frontend — todo

Build in this order; each step is demoable on its own.

- [ ] **1. `useRecipeMatches()` hook** in `routes/recipe/`
  - Two subscriptions, not `findRecipeMatches()` — the list must re-rank the moment
    someone adds milk on the Inventory tab. That live re-rank *is* the demo.
  - `subscribeToRecipes` + `subscribeToInventory`, hold both in state, run
    `matchRecipes()` in a `useMemo` over the pair
  - `loading` stays true until **both** have delivered a first snapshot
  - Pass `onError` to both — a failed listen never sends a first snapshot, so without it
    the screen waits forever (same trap `useInventory` already documents)
  - Build the pantry `Set` in the memo, not per recipe
- [ ] **2. "Cook from my pantry" view** — new route section under `routes/recipe/`
  - Recipe card: title, image, **`have`/`total` badge**, and the missing items by name
  - "You have 5 of 7 — you need: cumin, lime" reads better than any percentage
  - Sort control wired to the three `MatchSort` modes, default `'missing'`
  - Filter chips: **Cook now** (`maxMissing: 0`) · **One stop** (`maxMissing: 2`) · All
  - Pass `minMatches: 1` so recipes sharing nothing with the pantry stay off the list
- [ ] **3. Staples toggle** — "Assume I have salt, pepper and water" (default **on**)
  - Pass `COMMON_STAPLES` as `assumedKeys` when checked
  - ⚠️ Render `via: 'assumed'` ingredients differently from `via: 'pantry'` — a dotted
    underline, a "probably" tooltip, anything. The badge must never claim the pantry
    holds something nobody logged. Same rule as the shelf-photo review grid.
- [ ] **4. Empty and near-empty states**
  - Empty pantry → "Add a few things to your pantry and we'll find you something"
    linking to Inventory, *not* a list of every recipe scored 0
  - Empty cookbook → link to the import/manual-entry form
  - Nothing above the `maxMissing` filter → offer to widen it rather than showing nothing
- [ ] **5. I1 handoff** — "Add the missing items to my grocery list"
  - `missingAcross()` on the selected recipes → one de-duped write
  - `source: 'recipe'`, `sourceId: recipe.id` so items stay traceable
  - Confirm what was added vs. already on the list

### ⚠️ Two writers, one `recipes` collection — schema drift is already here

The vanilla pages were **never ported**. `recipes.html` + `recipe-list.js` (browse, live
`onSnapshot`, search, expandable cards) and `recipe.html` + `recipes.js` (add form) still
read and write the same `recipes` collection the React app uses — in a different shape:

| | vanilla `recipes.js` | React `RecipePage.tsx` |
|---|---|---|
| title | `name` | `title` |
| time | `minutes` | `totalMinutes` / `prepMinutes` / `cookMinutes` |
| ingredients | `{ amount: "2 cups", name }` | `Item` — **with `key`** |
| also | — | `tags`, `notes`, `createdBy` |

This is exactly the drift CLAUDE.md says the TypeScript choice exists to prevent, and it
got in through the gap the types don't cover: a `data() as Recipe` cast describes our
writers, not the collection's history.

It bites both directions — `recipe-list.js` reads `recipe.name`, so React-written recipes
already show as **blank-titled cards** on the vanilla page.

- [x] `toRow()` in `packages/shared/src/recipes.ts` is now an **adapter**, not a cast:
      maps `name`→`title`, `minutes`→`totalMinutes`, and derives a `key` for every legacy
      ingredient via `normalizeKey()`. Without that key, matching cannot work at all.
- [x] `matchRecipe()` hardened as a seatbelt: keyless ingredients count as missing
      individually rather than collapsing through the de-dupe Set, and the title tie-break
      is null-safe (two untitled recipes used to throw a TypeError and kill the view).
- [x] **DECIDED (2026-08-26): the contract shape is the one true shape.** All new work
      targets `Recipe` from `packages/shared/src/types.ts`. The vanilla recipe pages stay
      on disk and keep working — nobody is porting them, backfilling them, or deleting
      them. They are simply not a consideration going forward.
      - The adapter in `toRow()` stays. It is what lets old documents keep showing up in
        the React app, and it is the reason the vanilla add form can still write a keyless
        recipe without breaking anything.
      - Nothing new should ever *write* the old shape.
- [ ] Legacy free-text `amount` ("2 cups") is dropped on read — splitting it into
      `quantity` + `unit` needs `parseIngredientLine()`. Legacy amounts render blank in
      React until then; the vanilla page still shows them.
- [ ] README's repo layout lists only `index.html`, `groceries.js`, `style.css`,
      `firebase-config.js` as vanilla leftovers. The four recipe files are missing from
      that list, which is part of why this went unnoticed.

### Known gap to raise at the all-hands ⚠️

Trailing prep phrases fork the key: `"salt and pepper, to taste"` → `salt-and-pepper-to-taste`,
`"parsley, for garnish"` → `parsley-for-garnish`. No staples list can enumerate its way
out — the fix is stripping trailing prep phrases in `normalizeKey()`, which changes
matching for Grocery's `has()` and Inventory's de-dupe too, so it is a shared-contract
decision rather than something this feature should have changed on its own. There is a
skipped test standing on it in `matching.test.ts`; un-skip it when the change lands.

Related and cheaper: `"salt and pepper"` is one line holding two ingredients. Splitting
compound lines belongs in `parseIngredientLine()`, which CLAUDE.md specifies but nobody
has written yet.

---

## Integration duties 🔗

- [ ] **I1 (with Grocery):** "Add ingredients to grocery list" on the detail view
  - [ ] Scale quantities if the user changes servings
  - [ ] Write `source: "recipe"` and `sourceId` so items are traceable
  - [ ] Confirmation showing what was added vs. skipped
- [ ] **I5 (with Inventory):** read `inventory` keys as input to AI generation

---

## Gotchas

- Some sites gate on user-agent or return a JS-only shell. Test against 5 different sites
  early — pick your demo sites before you build, not after.
- `recipeYield` is wildly inconsistent: `"4"`, `"4 servings"`, `["4","4 servings"]`. Normalize it.
- Fractions in ingredient lines come through as unicode (`½`, `¼`) — convert before parsing.
- Recipe images are hotlinked from the source site and can break. Have a placeholder.
- Recipe **text** may be copyrighted. Store the source URL and attribute it; this is a
  personal-use tool, so keep it that way and don't republish scraped content.
