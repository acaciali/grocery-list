# Grocery List

A shared, real-time grocery list. Plain HTML/CSS/JS with no build step —
items sync live between everyone's browsers through Cloud Firestore.

## Files

- `index.html` — the page.
- `groceries.js` — all app logic (add, check off, delete, clear checked).
  Loads the Firebase SDK as ES modules from the CDN.
- `style.css` — styles.
- `firebase-config.js` — Firebase project identifiers (not secrets; access
  control lives in `firestore.rules`).
- `firestore.rules` — Firestore security rules for the `groceries` collection.

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

No other changes needed — the app creates documents in the `groceries`
collection on first use.

## Data model

One Firestore document per item in the `groceries` collection:

```
{ name: string, checked: boolean, createdAt: serverTimestamp }
```

The list renders unchecked items first (newest first), checked items after.
