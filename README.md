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

## Firebase backend

The app is already wired up: `firebase-config.js` points at the shared
hackathon Firebase project (`grocery-list-3dd86`), its Firestore database
exists, and the rules in `firestore.rules` are published. Clone, serve, and
it works — no Firebase setup needed.

To browse the data or edit rules, ask to be added to the project, then open
the [Firebase console](https://console.firebase.google.com) → grocery-list →
Firestore Database. Items live in the `groceries` collection.

If rules change, edit `firestore.rules` here first (so the repo stays the
source of truth), then paste them into Firestore → Rules → Publish.

## Data model

One Firestore document per item in the `groceries` collection:

```
{ name: string, checked: boolean, createdAt: serverTimestamp }
```

The list renders unchecked items first (newest first), checked items after.
