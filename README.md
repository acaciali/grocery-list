# Grocery List

A shared, real-time grocery list and recipe box. Plain HTML/CSS/JS with no
build step — everything syncs live between everyone's browsers through Cloud
Firestore.

## Files

- `index.html` — the grocery list page.
- `groceries.js` — grocery list logic (add, check off, delete, clear checked).
  Loads the Firebase SDK as ES modules from the CDN.
- `recipes.html` — browse all saved recipes.
- `recipe-list.js` — recipe list logic (live list, search, expand a card).
- `recipe.html` — form for adding a new recipe.
- `recipes.js` — recipe form logic (dynamic ingredient rows, save).
- `style.css` — styles for all three pages.
- `firebase-config.js` — Firebase project identifiers (not secrets; access
  control lives in `firestore.rules`).
- `firestore.rules` — Firestore security rules for the `groceries` and
  `recipes` collections.

## Run it locally

ES modules do not load from `file://`, so serve the directory over HTTP:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000.

## ⚠️ Point it at your own Firebase project first

`firebase-config.js` currently points at the original private project, which
holds a real family grocery list. Before the group starts hacking:

1. Create a new project at the [Firebase console](https://console.firebase.google.com)
   (Firestore in test mode is fine for a hackathon).
2. Add a Web App to the project and copy its config object over the one in
   `firebase-config.js`.
3. Publish `firestore.rules` to the new project (Firestore → Rules, or
   `firebase deploy --only firestore:rules`).

No other changes needed — the app creates documents in the `groceries` and
`recipes` collections on first use.

## Data model

One Firestore document per item in the `groceries` collection:

```
{ name: string, checked: boolean, createdAt: serverTimestamp }
```

The list renders unchecked items first (newest first), checked items after.

One Firestore document per recipe in the `recipes` collection:

```
{
  name: string,
  servings: number | null,
  minutes: number | null,
  ingredients: [{ amount: string, name: string }],
  steps: [string],
  createdAt: serverTimestamp
}
```

`servings` and `minutes` are optional and stored as `null` when left blank.
Ingredient rows with a blank name are dropped on save, and `steps` comes from
splitting the instructions textarea on newlines.

`recipes.html` lists recipes newest first and filters client-side on recipe
name and ingredient names, so search needs no Firestore index.
