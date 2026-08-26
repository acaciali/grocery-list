# Set up Kitchen Loop with your own Firebase project

This guide shows you how to run this app for your own use. You create
your own free Firebase project. Your data stays in your project,
under your control. The app needs no server of its own.

Time estimate: 20 to 30 minutes.

## What you need

- A Google account (for Firebase).
- [Node.js](https://nodejs.org) version 22 or later, which includes `npm`.
- Git, and a GitHub account if you want the optional web deployment.

## Step 1: Get the code

1. Fork this repository on GitHub, or clone it directly:

   ```sh
   git clone https://github.com/acaciali/grocery-list.git
   cd grocery-list
   ```

2. Install the dependencies:

   ```sh
   npm ci
   ```

## Step 2: Create a Firebase project

1. Open the [Firebase console](https://console.firebase.google.com).
2. Click **Create a project** and give it a name, for example `our-kitchen`.
3. When the wizard offers Google Analytics, turn it off. The app does not use it.
4. Wait for the project to be created, then click **Continue**.

## Step 3: Register a web app and copy its config

1. On the project overview page, click the web icon (`</>`) to add a web app.
2. Give it a nickname, for example `kitchen-loop`. Do not select Firebase Hosting.
3. Click **Register app**. The console shows a code snippet that contains a
   `firebaseConfig` object.
4. Copy only the values of that object into
   `packages/shared/src/firebase-config.ts`, in place of the values that are
   there now. Keep the `export const firebaseConfig = { ... }` wrapper.
   You can remove the `measurementId` line if the console shows one.

The result looks like this, with your own values:

```ts
export const firebaseConfig = {
  apiKey: '...',
  authDomain: 'our-kitchen.firebaseapp.com',
  projectId: 'our-kitchen',
  storageBucket: 'our-kitchen.firebasestorage.app',
  messagingSenderId: '...',
  appId: '...',
};
```

These values are project identifiers, not secrets. It is safe to commit them.
Access control comes from the security rules in Step 5.

## Step 4: Create the Firestore database

1. In the console sidebar, open **Build → Firestore Database**.
2. Click **Create database**.
3. Select a location near you. You cannot change the location later.
4. Select **production mode**. Step 5 replaces the rules anyway, and
   production mode is the safe default if you stop here.

## Step 5: Publish the security rules

1. In **Firestore Database**, open the **Rules** tab.
2. Replace the full contents of the editor with the contents of
   [`firestore.rules`](../firestore.rules) from this repository.
3. Click **Publish**.

Warning: do not skip this step. Without these rules, every read and write
from the app is rejected, and the app shows permission errors.

## Step 6: Run the app

```sh
npm run dev
```

Open the printed URL, normally http://localhost:5173. Add a grocery item.
Then open **Firestore Database → Data** in the console. A `groceries`
collection with your item confirms that the setup is complete.

Everyone who runs the app with your config values sees the same grocery
list and the same pantry, live. There are no accounts and no sign-in:
one project is one household. To share the list with others, the simplest path is the web
deployment below, so that nobody has to run a dev server.

The Grocery tab's store features work now, against a demo store built into the
app: connect a store with any ZIP, and search, prices, matching, and sending all
run. They are labelled **Demo**, because the products are fixtures rather than
anything Kroger sells. Step 8 explains what real store data costs and why.

## Step 7 (optional): Deploy to GitHub Pages

This gives you one URL that works on every phone and laptop.

1. Push your fork, with your config from Step 3, to GitHub.
2. In your repository, open **Settings → Pages** and set **Source** to
   **GitHub Actions**.
3. If your repository is not named `grocery-list`, edit
   `.github/workflows/deploy.yml` and change `--base=/grocery-list/` to
   `--base=/YOUR-REPO-NAME/`.
4. Push a commit to `main`, or run the **Deploy to GitHub Pages** workflow
   from the **Actions** tab.
5. The app appears at `https://YOUR-USERNAME.github.io/YOUR-REPO-NAME/`.

Anyone with this URL can read and write your grocery list. That is the
intended trade-off of this simple setup: convenient for a small trusted
group, not suitable for sensitive data.

## Step 8 (optional): connect a real Kroger store

Everything in the Grocery tab works after Step 6, with one honest limitation: the
store is a demo. Search, matching, prices, the account link, and sending all run,
but every product comes from a fixture table that ships with the app, and nothing
ever reaches Kroger. The app labels this: a **Demo** badge sits next to the store
name and the send panel, and a send says so in as many words.

That demo is not a shortcut — it is what the free Firebase Spark plan allows.
Reaching Kroger for real needs a server, because Kroger's API requires a client
secret that would be public in browser JavaScript and sends no CORS headers to a
browser anyway. Our server is the Cloud Functions in `functions/`, and
**deploying any Cloud Function requires the pay-as-you-go Blaze plan.** So live
store data costs a billing account; the demo store costs nothing.

If that trade is fine, skip this step. Nothing else in the app depends on it.

### Turning on the live store

1. Upgrade the project to Blaze in the Firebase console
   (**⚙️ → Usage and billing → Details & settings**). Blaze includes a monthly
   free allotment far larger than this app uses, but it does require a card.
2. Register an app at the [Kroger developer portal](https://developer.kroger.com)
   to get `KROGER_CLIENT_ID` and `KROGER_CLIENT_SECRET`. Product and location
   data need no more than this.
3. Copy `functions/.env.example` to `functions/.env` and fill those in.
4. Deploy: `npm run deploy:functions`.
5. Point the app at the functions instead of the demo, in `apps/web/.env.local`:

   ```sh
   VITE_STORE_MODE=functions
   ```

   Rebuild and redeploy the frontend for this to take effect — Vite compiles env
   values into the bundle. Leaving it unset, or setting `local`, keeps the demo
   store, which is the default everywhere.

To develop against the functions without deploying, run `npm run emulators` and
set the same flag; the emulator runs on your machine and needs no billing.

### Also sending to a real cart

Cart writes need *your* permission on Kroger's own site, which is a different
grant from the one behind product search. That is why search is the baseline and
cart is the extra. Setting it up means:

1. Request the `cart.basic:write` scope for the app you registered above.
2. Register a redirect URI there. It must match, exactly, the value you put in
   `functions/.env` as `KROGER_REDIRECT_URI`:
   - local: `http://127.0.0.1:5001/YOUR-PROJECT-ID/us-central1/krogerCallback`
   - deployed: `https://us-central1-YOUR-PROJECT-ID.cloudfunctions.net/krogerCallback`
3. Add `KROGER_REDIRECT_URI` to `functions/.env`.
4. Set `APP_ALLOWED_ORIGINS` to the origins the app is served from, comma
   separated, for example `https://YOUR-USERNAME.github.io`. This is the
   allowlist for where Kroger's callback may send the browser back to, so an
   unlisted origin fails the link rather than redirecting somewhere unexpected.
   It defaults to the local dev server, so local linking needs no entry.

Then open the grocery list, connect a store, and use **Link your Kroger
account** in the send panel.

Two things about this are worth knowing before you rely on it. Kroger's public
API can add to a cart but never read it back or remove from it, so the app
reports what it sent and when, and cannot show you what is in your cart —
check the Kroger app for that. And sending the same item twice adds it twice;
items already sent are excluded from the next send for exactly that reason.

Without credentials, the functions themselves still answer from the same mock
store the browser uses, linking round trip included — so a deployed function with
no Kroger app behind it is testable rather than broken.

## Step 9 (optional): Enable the shelf scanner

📸 **Scan a shelf** in the Inventory tab sends the photo to Claude and gets back
candidate pantry items. The frontend needs no configuration for this: it posts to
the `analyzeShelf` Cloud Function for the `projectId` in
`packages/shared/src/firebase-config.ts`. What it needs is that function to exist.

Like the live store in Step 8, this needs the pay-as-you-go Blaze plan, because
it deploys a Cloud Function. It also needs an
[Anthropic API key](https://console.anthropic.com), which is billed separately.
Unlike the store, there is no in-browser substitute that does the real work: this
one calls a model, so the free-plan fallback is canned data (see below).

1. Upgrade the project to Blaze in the Firebase console
   (**⚙️ → Usage and billing → Details & settings**).
2. Store the API key as a Firebase secret. It is never committed and never
   reaches the browser:

   ```sh
   npx firebase functions:secrets:set ANTHROPIC_API_KEY
   ```

3. Deploy the function:

   ```sh
   npm run deploy:functions
   ```

4. Reload the app and scan a shelf. The review screen says
   "Read from your photo by …" and names the model that read it.

### Running it against the local emulator instead

To iterate on the function without deploying, put the key in a local file
(gitignored) and run the emulator:

```sh
echo 'ANTHROPIC_API_KEY=sk-ant-...' > functions/.secret.local
npm run emulators
```

Then create `apps/web/.env.local` and point the frontend at it:

```sh
VITE_FUNCTIONS_EMULATOR=true
```

Values in `apps/web/.env.local` are compiled into the built JavaScript and are
public. Never put an API key there — that is what the Cloud Function is for.

### Working without the scanner

Set `VITE_SHELF_STUB=true` in `apps/web/.env.local` to get a fixed demo shelf
with no network call and no API spend. Both the capture screen and the review
grid label themselves as demo data in that mode, so a canned result is never
mistaken for a real one. Manual entry, staples, and everything else in the
Inventory tab work with no function deployed at all.

## Costs

**Steps 1 to 7 cost nothing, and that is the whole app.** The free Firebase Spark
plan covers Firestore and anonymous sign-in, which is all the browser talks to.
Its quotas — 50,000 document reads and 20,000 writes per day — are far more than a
household uses. GitHub Pages hosting is free too.

On that free setup you get: the grocery list, the pantry, recipes, the recipe
clipper, and the whole grocery store surface — search, matching, cart planning,
sending — answered by a demo store inside the browser and labelled as such.

Two optional things need the pay-as-you-go **Blaze** plan, both for the same
reason: they deploy Cloud Functions, and Spark cannot deploy a function at all.

| Optional feature | Why it needs a server |
|---|---|
| Live Kroger store data and cart (Step 8) | Kroger's API needs a client secret, and blocks browsers with no CORS headers |
| 📸 Shelf scanner (Step 9) | The Anthropic API key must never be in browser JavaScript |

Blaze includes a monthly free allotment — 2 million function invocations, well
past anything this app does — so the practical cost of enabling them is usually
$0 plus Anthropic's own per-request charge for the scanner. It does require a card
on file, which is the real reason it is optional here rather than the default.

## Troubleshooting

- **"Missing or insufficient permissions" errors**: the rules from Step 5
  are not published to this project.
- **The app loads but shows no data and adds fail silently**: open the
  browser developer console. A message about an invalid API key means that
  the values in `packages/shared/src/firebase-config.ts` do not match the
  console (Project settings → General → Your apps).
- **A blank page on GitHub Pages**: the `--base` path in
  `.github/workflows/deploy.yml` does not match the repository name. See
  Step 7.
- **The store says "Demo" and the products look invented**: they are. That is
  the free-plan store, and it is the default. Step 8 is how you replace it.
- **`VITE_STORE_MODE=functions` and now the store is broken**: the app is asking
  a Cloud Function that is not there. Either deploy it and stay on Blaze
  (Step 8), run `npm run emulators` for local work, or drop the flag to go back
  to the demo store.
- **The shelf scanner says "isn't deployed yet"**: the `analyzeShelf` function
  is not deployed to this project. See Step 9, or set `VITE_SHELF_STUB=true` in
  `apps/web/.env.local` to use the demo shelf.
- **The shelf scanner says "not configured"**: the function is deployed but
  `ANTHROPIC_API_KEY` is missing or invalid. Re-run the
  `functions:secrets:set` command in Step 9, then redeploy.
- **`npm run dev` fails at startup**: check that `node --version` prints 22
  or later, then run `npm ci` again.
