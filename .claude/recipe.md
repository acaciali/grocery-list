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
