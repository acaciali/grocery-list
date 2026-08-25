import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Emulator-backed specs are opt-in: they need `npm run emulators` running.
    // `npm test` runs the pure unit specs only.
    testTimeout: 15_000,
  },
});
