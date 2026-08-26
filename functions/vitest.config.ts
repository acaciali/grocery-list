import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Specs here are deliberately Firestore-free. Anything needing the Admin SDK belongs
    // behind `npm run emulators`, which currently needs a JRE not everyone has installed.
    include: ['src/**/*.test.ts'],
  },
});
