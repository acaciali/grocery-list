# Firebase basics

This document explains the Firebase concepts that this project uses. It is
written for someone who never used Firebase before. For setup steps, see
[SETUP.md](SETUP.md).

## What Firebase is

Firebase is a set of backend services from Google. An app talks to these
services directly from the browser, through a JavaScript SDK. There is no
server code to write for the common cases: the database, live updates, and
access control all come from the service.

This project uses one Firebase service for almost everything: **Cloud
Firestore**, the database. A second service, **Cloud Functions**, is
scaffolded but optional.

## Projects

A Firebase *project* is the top-level container. It holds one database, its
security rules, and the usage quotas. This repository's shared project is
`grocery-list-3dd86`. When you self-host, you create your own project, and
your data lives there.

One project is one shared world. Every browser that runs this app with the
same config values sees the same grocery list, live.

## The config object

`packages/shared/src/firebase-config.ts` holds the *config object*: the
project ID, an API key, and a few more identifiers. The SDK uses these
values to find your project.

The config object is an address, not a password. It is safe to commit and
safe to ship in a public web page. What each visitor can do is controlled
by the security rules, not by the config.

## Cloud Firestore: the database

Firestore is a NoSQL database. There are no tables and no SQL. Instead:

- A **document** is one record: a small set of named fields, like a JSON
  object. Example: one grocery item is one document with the fields
  `name`, `checked`, and `createdAt`.
- A **collection** is a named group of documents. This project uses three:
  `groceries`, `inventory`, and `recipes`.
- Each document has an **ID** inside its collection. Firestore can generate
  a random ID (the grocery list does this), or the code can choose the ID
  (the pantry uses the normalized item name, so one item is one document).

Firestore does not enforce a schema. Nothing stops a client from writing a
document with different fields. In this project, the TypeScript types in
`packages/shared/src/types.ts` are the schema by convention.

You can browse and edit all data by hand in the
[Firebase console](https://console.firebase.google.com) under
**Firestore Database → Data**. This is very useful for debugging.

## Reads, writes, and live updates

The SDK gives the app functions such as `addDoc`, `updateDoc`, `deleteDoc`,
and `getDocs`. Each call is one network request to Firestore.

The special power of Firestore is `onSnapshot`. It *subscribes* to a query.
Firestore then pushes every change to the app, within about a second, with
no polling. That is the whole real-time mechanism of this app. For an
example, see the `onSnapshot` call in
`apps/web/src/routes/grocery/GroceryPage.tsx`: when any person adds an
item, every open browser gets the new list automatically.

## Security rules

Because the browser talks to the database directly, the browser cannot be
trusted. **Security rules** are the only gate. They are a short text file
that Firestore evaluates on its servers for every read and write. A request
that no rule allows is rejected.

The rules for this project live in [`firestore.rules`](../firestore.rules)
at the repository root. They currently allow full read and write on the
three collections for everyone. That is a deliberate choice for a
single-household app with no accounts. The comments in the file record the
reasons.

Two important properties of rules:

- Rules are **default-deny**. A collection with no matching rule rejects
  everything. If the app shows "Missing or insufficient permissions", the
  published rules are the first thing to check.
- The repository file is only a copy. Rules take effect when you **publish**
  them to the project: console → **Firestore Database → Rules** → paste →
  **Publish**. Keep the repository file as the source of truth, and publish
  after each change that reaches `main`.

## Authentication

Firebase Authentication manages user sign-in and gives each user a stable
ID that rules can check. This project used anonymous sign-in at one point
and then removed it: the current app has no accounts, and the rules do not
check a user. If per-user data comes back (see the history notes in
`firestore.rules`), Authentication is the service that provides it.

## The emulator suite

The emulator suite runs a local, throwaway copy of Firestore and
Authentication on your machine. It is the safe way to test rule changes or
destructive code without touching the shared database.

1. Start it with `npm run emulators` (this needs the `firebase-tools`
   package and Java).
2. Set `VITE_USE_EMULATORS=true` in `apps/web/.env.local`.
3. Run `npm run dev`. The app now talks to the emulator.

The emulator UI at http://localhost:4000 shows the local data. All local
data is deleted when the emulator stops.

## Cloud Functions

Cloud Functions are small pieces of server code that Firebase runs for you.
They exist for the cases a browser must not handle: API secrets and CORS
proxies. This project uses them in `functions/` for exactly two optional
things — live Kroger store data and the shelf scanner — because both need a
secret that would be public in browser JavaScript.

Deploying any Function requires the paid Blaze plan, so nothing that matters
depends on one: the grocery list, the pantry, and recipes all talk straight to
Firestore, and the store surface falls back to a demo store that runs in the
browser. See [SETUP.md](./SETUP.md) Step 8. Everything else in this document
works on the free plan.

## Quotas and cost

The free **Spark plan** includes 50,000 document reads and 20,000 writes
per day, per project. Personal use stays far below this. If every Firestore
call suddenly fails for everyone at the same time, check
**console → Usage** first: a runaway loop in code can use the full daily
quota, and the project then rejects requests until the daily reset
(midnight US Pacific time).

## Glossary

| Term | Meaning |
| --- | --- |
| Project | Top-level container: one database, one set of rules, one quota. |
| Config object | Public identifiers that point the SDK at a project. |
| Document | One record, a set of named fields. |
| Collection | A named group of documents. |
| `onSnapshot` | An SDK subscription that pushes live changes to the app. |
| Security rules | Server-side gate that allows or rejects each request. |
| Publish | The console action that makes edited rules take effect. |
| Emulator suite | A local, throwaway Firestore and Auth for development. |
| Spark / Blaze | The free plan / the pay-as-you-go plan. |

## Where to learn more

- [Firestore data model](https://firebase.google.com/docs/firestore/data-model)
- [Security rules guide](https://firebase.google.com/docs/firestore/security/get-started)
- [Web SDK reference](https://firebase.google.com/docs/reference/js)
