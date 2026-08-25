// Barrel for @grocery/shared.
export * from './types.js';
export * from './items.js';
export * from './firebase.js';
// Inventory data layer. `has()` is Grocery's I2 dependency, `getAllKeys()` is Recipe's I5.
export * from './inventory.js';
export { firebaseConfig } from './firebase-config.js';
