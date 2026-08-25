const states = ['loading', 'empty', 'error', 'review', 'saving', 'success'];

function showState(name) {
  for (const s of states) {
    document.getElementById(`state-${s}`).hidden = s !== name;
  }
}

function populateForm(recipe) {
  document.getElementById('field-title').value = recipe.title || '';
  document.getElementById('field-servings').value = recipe.servings || '';
  document.getElementById('field-prepTime').value = formatDuration(recipe.prepTime);
  document.getElementById('field-cookTime').value = formatDuration(recipe.cookTime);
  document.getElementById('field-totalTime').value = formatDuration(recipe.totalTime);
  document.getElementById('field-ingredients').value = arrayToLines(recipe.ingredients || []);
  document.getElementById('field-instructions').value = arrayToLines(recipe.instructions || []);
}

function collectFormFields(sourceUrl) {
  return {
    title: document.getElementById('field-title').value,
    servings: document.getElementById('field-servings').value,
    prepTime: document.getElementById('field-prepTime').value,
    cookTime: document.getElementById('field-cookTime').value,
    totalTime: document.getElementById('field-totalTime').value,
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

    populateForm(result);
    showState('review');
  } catch (err) {
    document.getElementById('error-message').textContent =
      err && err.message ? err.message : 'Something went wrong.';
    showState('error');
  }
}

async function submitRecipe(event) {
  event.preventDefault();
  showState('saving');
  try {
    const payload = buildPayload(collectFormFields(currentSourceUrl));
    const response = await fetch(BACKEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Server responded with ${response.status}`);
    showState('success');
  } catch (err) {
    document.getElementById('error-message').textContent =
      err && err.message ? err.message : 'Could not save the recipe.';
    showState('error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  scrapeActiveTab();
  document.getElementById('retry-empty').addEventListener('click', scrapeActiveTab);
  document.getElementById('retry-error').addEventListener('click', scrapeActiveTab);
  document.getElementById('cancel-review').addEventListener('click', () => window.close());
  document.getElementById('close-success').addEventListener('click', () => window.close());
  document.getElementById('state-review').addEventListener('submit', submitRecipe);
});
