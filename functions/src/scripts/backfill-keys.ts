/**
 * One-off backfill: give legacy `groceries` docs a `key`, and a `category` where we
 * actually know one.
 *
 * The read paths already tolerate both being absent, so this is cleanup rather than a
 * blocker -- but until it runs, every pre-contract doc is invisible to de-dupe by `key`
 * (I1) and to the inventory `has(key)` check (I2).
 *
 * Dry run by default. Pass --apply to write.
 *
 *   npm run backfill -w functions              # report only
 *   npm run backfill -w functions -- --apply   # write
 *
 * Credentials, pick one:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=grocery-list-3dd86 ...
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json ...
 */
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { normalizeKey } from '@grocery/shared/items';
import type { Category, GroceryItem } from '@grocery/shared/types';

const APPLY = process.argv.includes('--apply');

/** Firestore caps a write batch at 500; leave headroom rather than sit on the limit. */
const BATCH_SIZE = 400;

export interface Plan {
  id: string;
  name: string;
  key?: string;
  category?: Category;
}

export type Decision =
  | { kind: 'update'; plan: Plan; drift?: { stored: string; computed: string } }
  | { kind: 'complete'; drift?: { stored: string; computed: string } }
  | { kind: 'skip'; reason: string };

/**
 * `category` is only filled in from a store match we already made, never guessed.
 *
 * A keyword table mapping "milk" -> dairy would be a second, unreviewed contract living
 * in a throwaway script, and a wrong category is worse than a missing one: aisle grouping
 * already handles absent, but it cannot detect wrong. Where a doc has no match, the
 * category stays unset and the resolver fills it the first time the item is matched.
 */
function categoryFrom(item: GroceryItem): Category | undefined {
  return item.match?.product?.category ?? undefined;
}

/**
 * What this one doc needs, decided without touching Firestore so it can be tested.
 *
 * The rule that matters: an existing `key` is never rewritten. Other collections may
 * already join on it, and normalizeKey is explicitly still pending an all-hands -- so a
 * key that disagrees with today's implementation is reported as drift for a human, not
 * silently "corrected" out from under whatever already points at it.
 */
export function decide(id: string, item: GroceryItem): Decision {
  const name = typeof item.name === 'string' ? item.name : '';
  if (!name.trim()) return { kind: 'skip', reason: 'no name to normalize' };

  let computed: string;
  try {
    computed = normalizeKey(name);
  } catch (err) {
    // normalizeKey throws when nothing identifying survives, e.g. a name that is all
    // quantity words. Report it; a human decides what that row was meant to be.
    return { kind: 'skip', reason: err instanceof Error ? err.message : String(err) };
  }

  const drift =
    item.key && item.key !== computed ? { stored: item.key as string, computed } : undefined;

  const plan: Plan = { id, name };
  if (!item.key) plan.key = computed;
  if (!item.category) {
    const category = categoryFrom(item);
    if (category) plan.category = category;
  }

  if (!plan.key && !plan.category) return drift ? { kind: 'complete', drift } : { kind: 'complete' };
  return drift ? { kind: 'update', plan, drift } : { kind: 'update', plan };
}

async function main(): Promise<void> {
  if (getApps().length === 0) initializeApp();
  const db = getFirestore();

  const snap = await db.collection('groceries').get();
  console.log(`groceries: ${snap.size} docs\n`);

  const plans: Plan[] = [];
  const skipped: Array<{ id: string; name: string; reason: string }> = [];
  const drifted: Array<{ id: string; name: string; stored: string; computed: string }> = [];
  let alreadyDone = 0;

  for (const doc of snap.docs) {
    const item = doc.data() as GroceryItem;
    const decision = decide(doc.id, item);
    const name = typeof item.name === 'string' ? item.name : '';

    if (decision.kind === 'skip') {
      skipped.push({ id: doc.id, name, reason: decision.reason });
      continue;
    }
    if (decision.drift) drifted.push({ id: doc.id, name, ...decision.drift });
    if (decision.kind === 'complete') alreadyDone += 1;
    else plans.push(decision.plan);
  }

  for (const p of plans) {
    const fields = [p.key && `key=${p.key}`, p.category && `category=${p.category}`].filter(Boolean);
    console.log(`  ${p.id}  ${JSON.stringify(p.name)}  ->  ${fields.join(', ')}`);
  }

  if (drifted.length > 0) {
    console.log(`\n⚠️  ${drifted.length} doc(s) have a key that disagrees with normalizeKey today.`);
    console.log('   Left untouched -- rewriting a key silently breaks anything joined on it.');
    for (const d of drifted) console.log(`  ${d.id}  ${JSON.stringify(d.name)}  stored=${d.stored}  computed=${d.computed}`);
  }

  if (skipped.length > 0) {
    console.log(`\n⚠️  ${skipped.length} doc(s) skipped:`);
    for (const s of skipped) console.log(`  ${s.id}  ${JSON.stringify(s.name)}  ${s.reason}`);
  }

  console.log(
    `\n${plans.length} to update, ${alreadyDone} already complete, ` +
      `${drifted.length} drifted, ${skipped.length} skipped.`,
  );

  if (!APPLY) {
    console.log('\nDry run. Re-run with --apply to write.');
    return;
  }
  if (plans.length === 0) {
    console.log('\nNothing to write.');
    return;
  }

  for (let i = 0; i < plans.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const p of plans.slice(i, i + BATCH_SIZE)) {
      const update: Record<string, unknown> = {};
      if (p.key) update.key = p.key;
      if (p.category) update.category = p.category;
      batch.update(db.collection('groceries').doc(p.id), update);
    }
    await batch.commit();
    console.log(`wrote ${Math.min(i + BATCH_SIZE, plans.length)}/${plans.length}`);
  }
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
