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

## Step 8 (optional): Enable the shelf scanner

📸 **Scan a shelf** in the Inventory tab sends the photo to Claude and gets back
candidate pantry items. The frontend needs no configuration for this: it posts to
the `analyzeShelf` Cloud Function for the `projectId` in
`packages/shared/src/firebase-config.ts`. What it needs is that function to exist.

This is the one feature that requires the pay-as-you-go Blaze plan, because it
deploys a Cloud Function. It also needs an
[Anthropic API key](https://console.anthropic.com), which is billed separately.

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

Everything above runs on the free Firebase Spark plan. Its Firestore
quotas (50,000 reads and 20,000 writes per day) are far more than personal
use needs. The optional Cloud Functions in `functions/` are the one exception:
deployment of functions requires the pay-as-you-go Blaze plan. The grocery,
pantry, and recipe features work without them.

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
- **The shelf scanner says "isn't deployed yet"**: the `analyzeShelf` function
  is not deployed to this project. See Step 8, or set `VITE_SHELF_STUB=true` in
  `apps/web/.env.local` to use the demo shelf.
- **The shelf scanner says "not configured"**: the function is deployed but
  `ANTHROPIC_API_KEY` is missing or invalid. Re-run the
  `functions:secrets:set` command in Step 8, then redeploy.
- **`npm run dev` fails at startup**: check that `node --version` prints 22
  or later, then run `npm ci` again.
