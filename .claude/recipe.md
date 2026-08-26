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

### Frontend — ✅ done

Built in this order; each step demoable on its own. Lives at `/recipe/cook`, reached from
the cookbook.

- [x] **1. `useRecipeMatches()` hook** — `routes/recipe/useRecipeMatches.ts`
  - Two subscriptions, not `findRecipeMatches()`: `useRecipes` + `useInventory`, with
    `matchRecipes()` in a `useMemo` over the pair. Add milk on the Pantry tab and the list
    re-ranks while you watch it.
  - The pantry side goes through `useInventory()` → the `pantry` store, **not**
    `subscribeToInventory()` directly. That store is the seam that makes `VITE_PANTRY=local`
    work; going around it would make this the one screen you cannot develop offline.
  - `loading` stays true until both feeds deliver a first snapshot; both underlying hooks
    already pass `onError`, so a failed listen clears `loading` instead of hanging.
  - An unreadable pantry blocks the screen rather than ranking against an empty Set —
    "you have none of this" is a confident wrong answer.
  - `maxMissing` is deliberately *not* a hook option, so the view can still count what sits
    just outside the filter and offer to widen it (step 4).
- [x] **2. "Cook from my pantry" view** — `routes/recipe/CookFromPantryPage.tsx`
  - Card: title, image, `have`/`total` badge, and "You have 5 of 7 — you need: cumin, lime"
  - Sort control over all three `MatchSort` modes, labelled as the question rather than the
    metric ("Fewest to buy", not `missingCount` ascending)
  - Chips **Cook now** (0) · **One stop** (≤2) · **All**, defaulting to One stop — Cook now
    alone is empty on a thin pantry and reads as a broken screen. Counts come off the full
    ranked list, so "Cook now 0" says there is nothing rather than looking like a bug.
  - `minMatches: 1`, so recipes sharing nothing with the pantry stay on `/recipe`
- [x] **3. Staples toggle** — default **on**, passes `COMMON_STAPLES` as `assumedKeys`
  - `via: 'assumed'` ingredients render as their own dotted-underline line and are never
    folded into the badge. Same rule as the shelf-photo review grid: a guess reads as a guess.
- [x] **4. Empty and near-empty states** — four, each pointing somewhere
  - no cookbook → new recipe · empty pantry → add to pantry · nothing overlapping → add
    more staples · nothing inside the filter → a button that widens it
- [x] **5. I1 handoff** — select recipes, one `addRecipeIngredients()` call per selected
      recipe with that recipe's **disjoint** share of the list
  - `planMissingByRecipe()` in `cookFromPantry.ts` is `missingAcross()`'s de-dupe with the
    attribution kept, so a shared ingredient is bought once *and* every row still lands with
    a `sourceId` tracing to a real recipe. A single combined write would have to pick one
    recipe id and lie about the rest.
  - Writes are sequential, not `Promise.all` — `planAdds` re-reads the list to decide
    add-vs-merge, so a concurrent call would plan against rows the first had not written yet.
  - No confirm sheet here, unlike the detail view: that sheet exists to *show* the pantry
    cross-check, and on this screen the cross-check is the screen.
- [x] Tests on the pure helpers: `cookFromPantry.test.ts` (`npm test -w apps/web`, node env)

### Also done here — the `data() as Recipe` casts are gone

`useRecipes` and `RecipeDetailPage` each had their own `onSnapshot` / `getDoc` plus a cast.
Both now go through `subscribeToRecipes` / `getRecipe`, so every document passes through
`toRow()`. Legacy recipes open with a real title and with keys derived from their ingredient
names — which is what lets the existing add-to-groceries sheet match them at all.

### ⚠️ Raise on the shared side

`missingAcross()` keys its Map on `item.key`, so **every keyless ingredient collapses under
`undefined`** and only the first survives. Unreachable through `toRow()`, which derives a key
on read, but a hand-edited document would silently lose ingredients off a shopping list.
`planMissingByRecipe()` keeps them instead, with a test standing on the divergence.

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
