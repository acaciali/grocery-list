/**
 * schema.org gives times as ISO 8601 durations ("PT1H25M"), which is unreadable
 * in a form field. Turn it into "1 hr 25 min". Anything that isn't a duration we
 * recognize is passed through untouched -- plenty of sites write "45 minutes"
 * into the field directly, and mangling that would be worse than leaving it.
 */
const ISO_DURATION = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

function pluralize(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function formatDuration(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  const match = ISO_DURATION.exec(raw.toUpperCase());
  if (!match) return raw;

  const days = Number(match[1] || 0);
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  const seconds = Number(match[4] || 0);
  // "PT0M" and a bare "PT" both mean the site had no real number for us.
  if (!days && !hours && !minutes && !seconds) return '';

  const parts = [];
  if (days) parts.push(pluralize(days, 'day'));
  if (hours) parts.push(pluralize(hours, 'hr'));
  if (minutes) parts.push(`${minutes} min`);
  // Seconds only matter when they're the whole duration; otherwise they're noise.
  if (seconds && !days && !hours && !minutes) parts.push(`${Math.round(seconds)} sec`);
  return parts.join(' ');
}

function linesToArray(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function arrayToLines(arr) {
  return (arr || []).join('\n');
}

function orNull(value) {
  const trimmed = String(value || '').trim();
  return trimmed === '' ? null : trimmed;
}

function buildPayload(fields) {
  return {
    title: orNull(fields.title),
    servings: orNull(fields.servings),
    prepTime: orNull(fields.prepTime),
    cookTime: orNull(fields.cookTime),
    totalTime: orNull(fields.totalTime),
    ingredients: linesToArray(fields.ingredientsText),
    instructions: linesToArray(fields.instructionsText),
    sourceUrl: fields.sourceUrl,
  };
}

if (typeof module !== 'undefined') {
  module.exports = { linesToArray, arrayToLines, buildPayload, formatDuration };
}
