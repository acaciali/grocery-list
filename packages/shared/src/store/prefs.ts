/**
 * Document-id derivation for remembered product picks.
 *
 * This is shared rather than local to either caller because both the Cloud Function and
 * the browser read and write `users/{uid}/productPrefs`. Two implementations of the same
 * derivation would drift, and the symptom is silent: a user's saved picks would appear to
 * vanish the moment the app switched between the two store modes.
 */

/**
 * Cache and pref keys are the QUERY TEXT, not the shared ItemKey.
 *
 * normalizeKey() deliberately strips descriptors, so "whole milk" and "2% milk" both
 * produce the key `milk`. Keying a product pref on that would confidently serve whole
 * milk to someone who asked for 2%. `key` is the cross-app join column; "what did this
 * search return" is a different question and needs its own key.
 */
export function queryKey(term: string): string {
  return term.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
}

/** A slash is the one character a Firestore document id cannot contain. */
export function prefDocId(term: string): string {
  return queryKey(term).replace(/\//g, '_');
}
