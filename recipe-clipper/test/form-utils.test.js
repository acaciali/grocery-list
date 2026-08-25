const assert = require('assert');
const { linesToArray, arrayToLines, buildPayload, formatDuration } = require('../src/form-utils');

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  - ${name}`);
    passed++;
  } catch (e) {
    console.log(`FAIL  - ${name}`);
    console.log(`        ${e.message}`);
    failed++;
  }
}

test('linesToArray splits on newlines, trims, drops empty lines', () => {
  const result = linesToArray('  1 cup flour  \n\n2 eggs\n   \nSalt');
  assert.deepStrictEqual(result, ['1 cup flour', '2 eggs', 'Salt']);
});

test('linesToArray returns empty array for blank input', () => {
  assert.deepStrictEqual(linesToArray('   '), []);
  assert.deepStrictEqual(linesToArray(''), []);
});

test('arrayToLines joins with newlines', () => {
  assert.strictEqual(arrayToLines(['a', 'b', 'c']), 'a\nb\nc');
});

test('arrayToLines handles empty array', () => {
  assert.strictEqual(arrayToLines([]), '');
});

test('buildPayload trims text fields and splits list fields', () => {
  const payload = buildPayload({
    title: '  Cookies  ',
    servings: ' 24 ',
    prepTime: ' PT15M ',
    cookTime: ' PT10M ',
    totalTime: '',
    ingredientsText: '2 cups flour\n1 cup sugar',
    instructionsText: 'Mix.\nBake.',
    sourceUrl: 'https://example.com/recipe',
  });

  assert.deepStrictEqual(payload, {
    title: 'Cookies',
    servings: '24',
    prepTime: 'PT15M',
    cookTime: 'PT10M',
    totalTime: null,
    ingredients: ['2 cups flour', '1 cup sugar'],
    instructions: ['Mix.', 'Bake.'],
    sourceUrl: 'https://example.com/recipe',
  });
});

test('buildPayload converts blank optional fields to null', () => {
  const payload = buildPayload({
    title: 'Soup',
    servings: '',
    prepTime: '',
    cookTime: '',
    totalTime: '',
    ingredientsText: 'Water',
    instructionsText: 'Boil.',
    sourceUrl: 'https://example.com/soup',
  });

  assert.strictEqual(payload.servings, null);
  assert.strictEqual(payload.prepTime, null);
  assert.strictEqual(payload.cookTime, null);
  assert.strictEqual(payload.totalTime, null);
});

test('formatDuration renders hours and minutes', () => {
  assert.strictEqual(formatDuration('PT1H25M'), '1 hr 25 min');
  assert.strictEqual(formatDuration('PT2H'), '2 hrs');
  assert.strictEqual(formatDuration('PT30M'), '30 min');
  assert.strictEqual(formatDuration('PT1H'), '1 hr');
});

test('formatDuration handles days and seconds', () => {
  assert.strictEqual(formatDuration('P1DT2H'), '1 day 2 hrs');
  assert.strictEqual(formatDuration('P2D'), '2 days');
  assert.strictEqual(formatDuration('PT45S'), '45 sec');
  // Seconds alongside bigger units are noise, so they're dropped.
  assert.strictEqual(formatDuration('PT1H25M30S'), '1 hr 25 min');
});

test('formatDuration blanks out empty and zero durations', () => {
  assert.strictEqual(formatDuration(null), '');
  assert.strictEqual(formatDuration(''), '');
  assert.strictEqual(formatDuration('  '), '');
  assert.strictEqual(formatDuration('PT0M'), '');
  assert.strictEqual(formatDuration('PT'), '');
});

test('formatDuration passes through text it does not recognize', () => {
  assert.strictEqual(formatDuration('45 minutes'), '45 minutes');
  assert.strictEqual(formatDuration('about an hour'), 'about an hour');
  // Weeks and months aren't in our grammar -- better raw than wrong.
  assert.strictEqual(formatDuration('P1W'), 'P1W');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
