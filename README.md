# Kitchen Loop

A shared kitchen app: a real-time grocery list, a per-user pantry, and
recipes. React + Vite + Tailwind on the front end, Cloud
Firestore for storage and live sync. There is no server to run — a static
host such as GitHub Pages is enough.

**Run it for your own use:** see [docs/SETUP.md](docs/SETUP.md). You
create a free Firebase project, paste its config into one file, and deploy.
Your data stays in your own project.

**New to Firebase?** [docs/FIREBASE-BASICS.md](docs/FIREBASE-BASICS.md)
explains the concepts this project uses: projects, Firestore, live
updates, security rules, and quotas.

## Repository layout

- `apps/web/` — the React app. Routes live in `apps/web/src/routes/`
  (`grocery`, `inventory`, `recipe`).
- `packages/shared/` — the Firebase setup, the item contract, shared types,
  and their tests. `packages/shared/src/firebase-config.ts` holds the
  Firebase project identifiers.
- `functions/` — optional Cloud Functions, for features that need a secret
  or a CORS proxy. The core app works without them.
- `firestore.rules` — the Firestore security rules. This file is the source
  of truth. After a change merges to `main`, paste the file into
  Firestore → Rules in the console and click **Publish**.
- `.github/workflows/deploy.yml` — builds `apps/web` and deploys it to
  GitHub Pages on every push to `main`.
- `index.html`, `groceries.js`, `style.css`, `firebase-config.js` — the
  original vanilla version of the grocery list, kept during the port.
  New work goes in `apps/web`.

## Development

```sh
npm ci          # install all workspaces
npm run dev     # start the web app on http://localhost:5173
npm test        # run the shared package tests
npm run emulators  # optional: local Firestore + Auth emulator suite
```

The dev server talks to the live shared Firestore project. To develop
against a local throwaway database instead, start the emulators and set
`VITE_USE_EMULATORS=true` in `apps/web/.env.local`.

## Color scheme

The palette (Almond Silk, Light Coral, Soft Blush, Celadon, Cotton Candy)
is defined once, in the `@theme` block of `apps/web/src/index.css`. New
features use the semantic Tailwind classes, not hex values:

- `bg-bg` page background, `bg-surface` cards and inputs
- `text-ink` primary text, `text-ink-soft` secondary text
- `bg-accent` / `border-accent` primary actions and active states
- `bg-positive` success and "done" states
- `bg-warn` / `text-warn` errors and destructive actions
- `border-line` borders and dividers, `rounded-card` card corners

The raw palette names (`bg-almond-silk`, `text-celadon`, ...) also exist
for the rare case that a feature means one exact color. The vanilla pages
mirror the same values as CSS variables in `style.css` (`var(--accent)`,
...); keep the two files in sync.

## Data model

- `groceries/{id}` — one document per list item:
  `{ name, checked, createdAt }`. The list is shared by everyone who uses
  the same Firebase project.
- `inventory/{key}` — one document per pantry item, keyed by the normalized
  item key, so adding something you already have updates it instead of
  duplicating it. Shared by everyone on the project, like the grocery list.
