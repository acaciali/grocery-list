import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const $form = document.getElementById("recipe-form");
const $name = document.getElementById("recipe-name");
const $servings = document.getElementById("recipe-servings");
const $minutes = document.getElementById("recipe-time");
const $ingredients = document.getElementById("ingredient-list");
const $addIngredient = document.getElementById("add-ingredient");
const $steps = document.getElementById("recipe-steps");
const $save = document.getElementById("save-recipe");
const $status = document.getElementById("status");

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

function addIngredientRow(focus = false) {
  const $row = document.createElement("li");
  $row.className = "ingredient-row";
  $row.innerHTML = `
    <input
      class="ingredient-amount"
      type="text"
      placeholder="2 cups"
      aria-label="Amount"
    />
    <input
      class="ingredient-name"
      type="text"
      placeholder="black beans"
      aria-label="Ingredient"
    />
    <button
      class="ingredient-remove"
      type="button"
      data-action="remove-ingredient"
      aria-label="Remove ingredient"
    >&times;</button>`;
  $ingredients.appendChild($row);
  if (focus) $row.querySelector(".ingredient-amount").focus();
}

function resetIngredients(rows = 3) {
  $ingredients.innerHTML = "";
  for (let i = 0; i < rows; i++) addIngredientRow();
}

// Rows where the ingredient name is blank are treated as unused and dropped,
// so the three starter rows never force the cook to fill them all in.
function readIngredients() {
  return [...$ingredients.querySelectorAll(".ingredient-row")]
    .map(($row) => ({
      amount: $row.querySelector(".ingredient-amount").value.trim(),
      name: $row.querySelector(".ingredient-name").value.trim(),
    }))
    .filter((ing) => ing.name !== "");
}

function readSteps() {
  return $steps.value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

function readNumber($el) {
  const n = Number.parseInt($el.value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function saveRecipe(e) {
  e.preventDefault();

  const name = $name.value.trim();
  if (!name) {
    $name.focus();
    return;
  }

  const ingredients = readIngredients();
  if (ingredients.length === 0) {
    toast("Add at least one ingredient", "error");
    $ingredients.querySelector(".ingredient-name").focus();
    return;
  }

  $save.disabled = true;
  try {
    await addDoc(collection(db, "recipes"), {
      name,
      servings: readNumber($servings),
      minutes: readNumber($minutes),
      ingredients,
      steps: readSteps(),
      createdAt: serverTimestamp(),
    });
    $form.reset();
    resetIngredients();
    $name.focus();
    toast("Recipe saved");
  } catch (err) {
    console.error(err);
    toast("Couldn't save", "error");
  } finally {
    $save.disabled = false;
  }
}

$form.addEventListener("submit", saveRecipe);

$form.addEventListener("reset", () => {
  // reset() clears the inputs but leaves the rows we appended, so rebuild them.
  resetIngredients();
});

$addIngredient.addEventListener("click", () => addIngredientRow(true));

$ingredients.addEventListener("click", (e) => {
  const remove = e.target.closest("[data-action='remove-ingredient']");
  if (!remove) return;
  const rows = $ingredients.querySelectorAll(".ingredient-row");
  if (rows.length === 1) {
    // Keep one row on the page; just empty it out.
    rows[0].querySelectorAll("input").forEach(($i) => ($i.value = ""));
    return;
  }
  remove.closest(".ingredient-row").remove();
});

resetIngredients();
