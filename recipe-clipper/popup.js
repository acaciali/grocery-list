/**
 * Popup state machine: scrape -> review -> save.
 *
 * Writes straight to Firestore with the same SDK and the same shared normalizeKey() that
 * RecipePage.tsx uses, so a clipped recipe and a typed recipe are the same shape with the
 * same ItemKeys. No backend of our own: saving a recipe needs no secret and Firestore is
 * not CORS-blocked, which is CLAUDE.md's test for what belongs in a Cloud Function.
 *
 * ⚠️ Nothing Firebase is imported at the top of this file ON PURPOSE. @grocery/shared calls
 * initializeApp() at module scope, so a static import would make Firebase a hard dependency
 * of merely OPENING the popup -- and a throw during module evaluation means none of the code
 * below ever registers, leaving the popup frozen on its first panel with the error nowhere
 * the user can see it. Scraping a page needs no database, so it no longer waits for one.
 */
import { arrayToLines, buildRecipe, formatMinutes, isoToMinutes } from './src/form-utils.js';

const states = ['loading', 'empty', 'error', 'review', 'saving', 'success'];

function showState(name) {
  for (const s of states) {
    document.getElementById(`state-${s}`).hidden = s !== name;
  }
}

function showFatal(message) {
  document.getElementById('error-message').textContent = message;
  showState('error');
}

function messageOf(err, fallback) {
  if (!err) return fallback;
  return typeof err === 'string' ? err : err.message || fallback;
}

/**
 * Problems the cook can fix stay on the review form -- bouncing to the error panel would
 * throw away every edit they just made, since the only way back is a fresh scrape.
 */
function showReviewError(message) {
  const el = document.getElementById('review-error');
  el.textContent = message;
  el.hidden = false;
  showState('review');
}

function clearReviewError() {
  document.getElementById('review-error').hidden = true;
}

/** Loaded on first save, not on open. See the header note. */
async function loadFirestore() {
  const [firestore, shared] = await Promise.all([
    import('firebase/firestore'),
    import('@grocery/shared'),
  ]);
  return { ...firestore, db: shared.db };
}

function populateForm(recipe) {
  document.getElementById('field-title').value = recipe.title || '';
  document.getElementById('field-servings').value = recipe.servings || '';
  // Scraped ISO durations become minutes, then friendly text: "85" in a prep-time box is
  // not something a cook reads. buildRecipe parses the text back to minutes on save.
  document.getElementById('field-prepMinutes').value = formatMinutes(isoToMinutes(recipe.prepTime));
  document.getElementById('field-cookMinutes').value = formatMinutes(isoToMinutes(recipe.cookTime));
  document.getElementById('field-totalMinutes').value = formatMinutes(isoToMinutes(recipe.totalTime));
  document.getElementById('field-ingredients').value = arrayToLines(recipe.ingredients || []);
  document.getElementById('field-instructions').value = arrayToLines(recipe.instructions || []);
}

function collectFormFields(sourceUrl) {
  return {
    title: document.getElementById('field-title').value,
    servings: document.getElementById('field-servings').value,
    prepMinutes: document.getElementById('field-prepMinutes').value,
    cookMinutes: document.getElementById('field-cookMinutes').value,
    totalMinutes: document.getElementById('field-totalMinutes').value,
    ingredientsText: document.getElementById('field-ingredients').value,
    instructionsText: document.getElementById('field-instructions').value,
    sourceUrl,
  };
}

let currentSourceUrl = null;

async function scrapeActiveTab() {
  showState('loading');
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) throw new Error('No active tab found.');
    currentSourceUrl = tab.url;

    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['src/recipe-parser.js'],
    });

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => parseRecipe(document, location.href),
    });

    if (!result) {
      showState('empty');
      return;
    }

    clearReviewError();
    populateForm(result);
    showState('review');
  } catch (err) {
    console.error(err);
    showFatal(messageOf(err, 'Something went wrong.'));
  }
}

async function submitRecipe(event) {
  event.preventDefault();
  clearReviewError();
  showState('saving');

  let firestore;
  try {
    firestore = await loadFirestore();
  } catch (err) {
    console.error(err);
    showReviewError("Couldn't start Firebase — see the popup console.");
    return;
  }

  // No sign-in: the app has no auth and `recipes` is open in firestore.rules.
  const built = buildRecipe(collectFormFields(currentSourceUrl), {
    createdAt: firestore.serverTimestamp(),
  });
  if (!built.ok) {
    showReviewError(built.msg);
    return;
  }

  try {
    await firestore.addDoc(firestore.collection(firestore.db, 'recipes'), built.recipe);
    showState('success');
  } catch (err) {
    console.error(err);
    showReviewError("Couldn't save — check your connection and try again.");
  }
}

function init() {
  try {
    document.getElementById('retry-empty').addEventListener('click', scrapeActiveTab);
    document.getElementById('retry-error').addEventListener('click', scrapeActiveTab);
    document.getElementById('cancel-review').addEventListener('click', () => window.close());
    document.getElementById('close-success').addEventListener('click', () => window.close());
    document.getElementById('state-review').addEventListener('submit', submitRecipe);
    scrapeActiveTab();
  } catch (err) {
    console.error(err);
    showFatal(messageOf(err, 'The popup failed to start.'));
  }
}

// A module script is deferred, so check rather than assume: waiting on an event that has
// already fired is exactly how a popup ends up frozen on its first panel.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
