# Recipe Clipper

A Chrome extension that scrapes the recipe off the page you're on and saves it straight to
the `recipes` collection — the same one RecipePage's manual form writes to.

## Adding it to Chrome

It has a build step, so you load `dist/`, **not** this folder.

```
npm install                                # once, from the repo root
npm run build -w @grocery/recipe-clipper
```

1. Open `chrome://extensions` (paste it in the address bar).
2. Turn on **Developer mode**, top right.
3. Click **Load unpacked** and select **`recipe-clipper/dist`**.
4. Pin it to the toolbar via the puzzle-piece icon.

Then open a recipe page and click the 🧑‍🍳 chef icon.

⚠️ If you loaded this extension before the build step existed, **Remove it and Load
unpacked again from `dist/`**. Chrome's ↻ button re-reads whichever path you first picked,
so reloading will not move it.

Rebuild after editing (`npm run dev -w @grocery/recipe-clipper` watches), then reopen the
popup. For `public/manifest.json` changes, rebuild and hit ↻.

## Why the build step

The popup imports `@grocery/shared` so ingredient lines run through the real
`normalizeKey()` — the same function RecipePage uses. That's what makes a clipped recipe and
a typed recipe match the same pantry item. A hand-copied normalizer here would drift the
first time the all-hands changes the real one.

This folder deliberately has no `manifest.json` (it lives in `public/`), so Chrome refuses
it outright instead of loading a popup whose bare `import` specifiers can't resolve.

## Notes

- **Times** are stored as `prepMinutes`/`cookMinutes`/`totalMinutes` — whole numbers, per the
  contract. Sites emit ISO 8601 (`PT1H25M`); the form shows "1 hr 25 min" and converts back
  on save, since "85" isn't something a cook reads.
- **`createdBy`** is the literal `'single-user'`, matching `SINGLE_USER` in RecipePage.tsx.
  The app has no auth; when accounts arrive these rows are found by that value, so the two
  surfaces must write the same string.
- **No sign-in**, because `recipes` is open in `firestore.rules`.
