// Barrel for @grocery/shared.
export * from './types.js';
export * from './items.js';
export * from './firebase.js';
// Inventory data layer. `has()` is Grocery's I2 dependency, `getAllKeys()` is Recipe's I5.
export * from './inventory.js';
// Pantry matching: pure scoring (matching) + the cookbook reads that feed it (recipes).
export * from './matching.js';
export * from './recipes.js';
export { firebaseConfig } from './firebase-config.js';
