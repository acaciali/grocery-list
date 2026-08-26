import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore,
  collection,
  query,
  orderBy,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const state = { recipes: [], loaded: false, search: "" };

// Which cards are expanded. Kept outside the DOM so a live snapshot update
// doesn't collapse a recipe someone is reading.
const expanded = new Set();

const $list = document.getElementById("recipe-list");
const $searchForm = document.getElementById("search-form");
const $search = document.getElementById("recipe-search");
const $status = document.getElementById("status");

const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );

let statusTimer = null;
function toast(msg, kind = "info") {
  $status.textContent = msg;
  $status.dataset.kind = kind;
  $status.hidden = false;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    $status.hidden = true;
  }, 2000);
}

function summary(recipe) {
  const bits = [];
  if (recipe.servings) {
    bits.push(`${recipe.servings} serving${recipe.servings === 1 ? "" : "s"}`);
  }
  if (recipe.minutes) bits.push(`${recipe.minutes} min`);
  const count = recipe.ingredients?.length ?? 0;
  if (count) bits.push(`${count} ingredient${count === 1 ? "" : "s"}`);
  return bits.join(" · ");
}

function matches(recipe, needle) {
  if (!needle) return true;
  const haystack = [
    recipe.name,
    ...(recipe.ingredients ?? []).map((i) => i.name),
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

function detailHtml(recipe) {
  const ingredients = recipe.ingredients ?? [];
  const steps = recipe.steps ?? [];

  const ingredientHtml = ingredients.length
    ? `<ul class="recipe-ingredients">${ingredients
        .map(
          (ing) =>
            `<li>${
              ing.amount ? `<span class="amount">${esc(ing.amount)}</span> ` : ""
            }${esc(ing.name)}</li>`,
        )
        .join("")}</ul>`
    : `<p class="recipe-none">No ingredients listed.</p>`;

  const stepHtml = steps.length
    ? `<ol class="recipe-steps">${steps
        .map((step) => `<li>${esc(step)}</li>`)
        .join("")}</ol>`
    : `<p class="recipe-none">No instructions listed.</p>`;

  return `
    <div class="recipe-detail">
      <h3>Ingredients</h3>
      ${ingredientHtml}
      <h3>Instructions</h3>
      ${stepHtml}
    </div>`;
}

function render() {
  if (!state.loaded) {
    $list.innerHTML = `<li class="grocery-empty">Loading recipes…</li>`;
    return;
  }

  if (state.recipes.length === 0) {
    $list.innerHTML = `<li class="grocery-empty">No recipes yet.
      <a href="./recipe.html">Add the first one.</a></li>`;
    return;
  }

  const needle = state.search.trim().toLowerCase();
  const shown = state.recipes.filter((r) => matches(r, needle));

  if (shown.length === 0) {
    $list.innerHTML = `<li class="grocery-empty">Nothing matches “${esc(
      state.search.trim(),
    )}”.</li>`;
    return;
  }

  $list.innerHTML = shown
    .map((recipe) => {
      const open = expanded.has(recipe.id);
      const meta = summary(recipe);
      return `
        <li class="recipe-card ${open ? "open" : ""}" data-id="${esc(recipe.id)}">
          <button
            class="recipe-head"
            data-action="expand"
            data-id="${esc(recipe.id)}"
            aria-expanded="${open}"
          >
            <span class="recipe-heading">
              <span class="recipe-name">${esc(recipe.name)}</span>
              ${meta ? `<span class="recipe-meta">${esc(meta)}</span>` : ""}
            </span>
            <span class="recipe-chevron" aria-hidden="true"></span>
          </button>
          ${open ? detailHtml(recipe) : ""}
        </li>`;
    })
    .join("");
}

$list.addEventListener("click", (e) => {
  const head = e.target.closest("[data-action='expand']");
  if (!head) return;
  const id = head.dataset.id;
  if (expanded.has(id)) {
    expanded.delete(id);
  } else {
    expanded.add(id);
  }
  render();
});

$searchForm.addEventListener("submit", (e) => e.preventDefault());

$search.addEventListener("input", () => {
  state.search = $search.value;
  render();
});

onSnapshot(
  query(collection(db, "recipes"), orderBy("createdAt", "desc")),
  (snap) => {
    state.recipes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    state.loaded = true;
    // Drop expansion state for recipes that no longer exist.
    const ids = new Set(state.recipes.map((r) => r.id));
    for (const id of expanded) {
      if (!ids.has(id)) expanded.delete(id);
    }
    render();
  },
  (err) => {
    console.error(err);
    state.loaded = true;
    state.recipes = [];
    $list.innerHTML = `<li class="grocery-empty">Couldn't load recipes.</li>`;
    toast("Couldn't load recipes", "error");
  },
);

render();
