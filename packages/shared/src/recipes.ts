/**
 * 🍳 Recipe data layer -- reads, plus the composed pantry-match query.
 *
 * Reads only for now, on purpose. RecipePage.tsx already writes recipes with its own
 * addDoc and works; pulling that write path in here would be a refactor of another
 * screen, not part of this feature. What did not exist was any way to READ the cookbook
 * back, which pantry matching needs.
 *
 * Unlike `inventory`, recipe doc IDs are Firestore's own random ones, not the key -- there
 * is no natural identity for "Sunday chili", and two recipes with the same title are two
 * recipes. So `id` here is load-bearing rather than vestigial: it is what a detail route
 * links to.
 *
 * POC note: single-user, no auth -- one shared cookbook, like groceries and the pantry.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  type FirestoreError,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase.js';
import { getAllKeys } from './inventory.js';
import { asItemKey, normalizeKey } from './items.js';
import { matchRecipes, type MatchOptions, type RecipeMatch } from './matching.js';
import type { Item, Recipe } from './types.js';

const COLLECTION = 'recipes';

/** A recipe as the UI holds it: the document plus the id needed to link to it. */
export type RecipeRow = Recipe & { id: string };

/**
 * ⚠️ TWO WRITERS, ONE COLLECTION. This is an adapter, not a cast.
 *
 * `recipes` holds documents in two different shapes, both live:
 *
 *   vanilla recipes.js   { name, minutes, ingredients: [{amount, name}], steps }
 *   React RecipePage.tsx { title, totalMinutes, ingredients: Item[], steps, tags, ... }
 *
 * The vanilla pages (recipes.html / recipe.html) were never ported and still read and
 * write the old shape against the same collection. So a `data() as Recipe` cast is a lie
 * for roughly half the cookbook: `title` is undefined, and no ingredient has a `key` --
 * which is fatal for matching, because `key` is the entire basis of it.
 *
 * Everything is normalized to the contract HERE, on read, so exactly one file knows the
 * old shape exists and nothing downstream has to care. This is also the migration seam:
 * when the legacy documents are backfilled, delete `LegacyRecipeDoc` and the two `??`
 * fallbacks, and nothing else changes.
 */
interface LegacyRecipeDoc {
  /** The old field for `title`. */
  name?: string;
  /** The old field for `totalMinutes`. */
  minutes?: number | null;
  /** Old ingredients carry free-text `amount` and, crucially, no `key`. */
  ingredients?: unknown;
}

/**
 * Rebuild the ingredient list so every entry satisfies `Item` -- above all, so every entry
 * has a real key. Legacy entries get one derived from their name, which is exactly what
 * normalizeKey() is for and is what lets a recipe saved in 2024 match a pantry photographed
 * today.
 *
 * ⚠️ The legacy free-text `amount` ("2 cups") is NOT carried over. Splitting it into
 * `quantity` + `unit` is parseIngredientLine()'s job -- specified in CLAUDE.md, not yet
 * written -- and hand-rolling a second parser here is precisely the parallel-contract
 * mistake the shared package exists to prevent. Legacy amounts render blank in the React
 * UI until that lands; the vanilla page still shows them.
 */
function toIngredients(raw: unknown): Item[] {
  if (!Array.isArray(raw)) return [];

  const items: Item[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const source = entry as Partial<Item>;

    const name = typeof source.name === 'string' ? source.name.trim() : '';
    if (name === '') continue;

    // Contract documents already carry a key; legacy ones never do.
    let key = typeof source.key === 'string' && source.key !== '' ? source.key : null;
    if (key === null) {
      try {
        key = normalizeKey(name);
      } catch {
        // Nothing identifying survives normalizing ("to taste"). Not matchable, and not
        // worth failing the whole read over -- drop the line and keep the recipe.
        continue;
      }
    }

    items.push({
      key: asItemKey(key),
      name,
      category: source.category ?? 'other',
      quantity: source.quantity ?? null,
      unit: source.unit ?? null,
    });
  }
  return items;
}

function toRow(id: string, data: unknown): RecipeRow {
  const doc = (data ?? {}) as Partial<Recipe> & LegacyRecipeDoc;

  return {
    // Spread first so genuinely optional contract fields (sourceUrl, imageUrl, servings,
    // prepMinutes, cookMinutes, notes, createdAt) survive untouched. The legacy `name` and
    // `minutes` ride along too, which is harmless -- nothing reads them past this point.
    ...(doc as Recipe),
    id,
    title: doc.title ?? doc.name ?? 'Untitled recipe',
    totalMinutes: doc.totalMinutes ?? doc.minutes ?? undefined,
    ingredients: toIngredients(doc.ingredients),
    steps: Array.isArray(doc.steps) ? doc.steps : [],
    tags: Array.isArray(doc.tags) ? doc.tags : [],
    createdBy: doc.createdBy ?? 'single-user',
  };
}

/**
 * Deliberately unordered. Every caller re-sorts anyway (matchRecipes ranks by pantry fit),
 * an orderBy on createdAt would need the serverTimestamp local-echo guard for nothing, and
 * an unconstrained read needs no composite index.
 */
export async function listRecipes(): Promise<RecipeRow[]> {
  const snap = await getDocs(collection(db, COLLECTION));
  return snap.docs.map((d) => toRow(d.id, d.data()));
}

/** One recipe by doc id. `null` rather than a throw -- a dead link is a 404, not a crash. */
export async function getRecipe(id: string): Promise<RecipeRow | null> {
  const snap = await getDoc(doc(db, COLLECTION, id));
  return snap.exists() ? toRow(snap.id, snap.data()) : null;
}

/**
 * Real-time cookbook feed.
 *
 * Pass onError. A listen that fails never delivers a first snapshot, so without one the UI
 * sits on `loading` forever waiting for something that is not coming -- an offline start, a
 * blocked request, or rules that were never published all land here.
 */
export function subscribeToRecipes(
  callback: (recipes: RecipeRow[]) => void,
  onError?: (error: FirestoreError) => void,
): Unsubscribe {
  return onSnapshot(
    collection(db, COLLECTION),
    (snap) => {
      callback(
        snap.docs.map((d) => toRow(d.id, d.data({ serverTimestamps: 'estimate' }))),
      );
    },
    onError,
  );
}

/**
 * ⭐ I5, the whole feature in one call: read the cookbook, read the pantry, rank one
 * against the other.
 *
 * The two reads go in parallel because neither needs the other. This is the one-shot
 * version -- fine for a script, a Cloud Function, or a button press. A screen that should
 * re-rank the instant someone adds milk wants the two subscriptions instead
 * (subscribeToRecipes + subscribeToInventory) with matchRecipes() over the pair.
 */
export async function findRecipeMatches(
  options?: MatchOptions,
): Promise<RecipeMatch<RecipeRow>[]> {
  const [recipes, pantryKeys] = await Promise.all([listRecipes(), getAllKeys()]);
  return matchRecipes(recipes, pantryKeys, options);
}
