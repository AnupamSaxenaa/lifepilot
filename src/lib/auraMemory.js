/**
 * Aura long-term memory
 * ---------------------------------------------------------------------------
 * The old design stored ONE free-text blob and asked the model to "return the
 * memory, updated". Every turn therefore rewrote the entire memory from
 * scratch, so any fact the model forgot to echo was permanently lost, and the
 * blob grew without bound until it dominated the prompt.
 *
 * Here memory is a set of short `key: value` facts:
 *   • Merging replaces a fact when the model restates that key, and KEEPS
 *     facts it simply didn't mention — so nothing silently disappears.
 *   • Facts are capped and evicted oldest-first, bounding prompt cost.
 *   • The rendered text stays the wire format, so `chatWithAura` /
 *     `generatePlan` / `getCoachAdvice` keep their existing string contract and
 *     the cloud column `profiles.ai_memory` stays human-readable.
 */
import { Storage } from '../utils/storage';

const MAX_FACTS = 36;
const MAX_FACT_CHARS = 130;
const MAX_RENDER_CHARS = 1200;

const factsKey = (userId) => `aimemory_facts_${userId}`;
const blobKey = (userId) => `aimemory_${userId}`;

const normalizeKey = (text) => String(text || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

/**
 * Tiebreaker for facts created within the same millisecond.
 *
 * `t` alone is not a total order: `Date.now()` only has millisecond resolution,
 * so several facts learned in one turn share a timestamp. Sorting newest-first
 * is a stable sort, which then leaves same-millisecond facts in insertion order
 * — newest LAST — and eviction at the cap cut the newest fact instead of the
 * stalest one. The counter only has to disambiguate within a millisecond, which
 * by definition happens inside one process, so it does not need to persist.
 */
let factSequence = 0;
const nextSequence = () => {
  factSequence += 1;
  return factSequence;
};

/** Newest first, with a total order so ties can't evict the wrong fact. */
const byRecency = (a, b) => (b?.t || 0) - (a?.t || 0) || (b?.s || 0) - (a?.s || 0);

/**
 * Split a memory blob into facts. Accepts bullet lists, newlines, or a single
 * run-on paragraph (older memories were written that way).
 */
export const parseMemoryText = (text) => {
  const raw = String(text || '').trim();
  if (!raw) return [];

  const pieces = raw
    .split(/\r?\n|(?:^|\s)[-•*]\s+|(?<=[.;])\s+/g)
    .map((piece) => piece.replace(/^[-•*\s]+/, '').trim())
    .filter((piece) => piece.length > 1);

  const facts = [];
  const seen = new Set();

  for (const piece of pieces) {
    const clipped = piece.length > MAX_FACT_CHARS ? `${piece.slice(0, MAX_FACT_CHARS - 1)}…` : piece;
    // Prefer an explicit "key: value" shape; otherwise derive a key from the
    // opening words so restatements of the same topic can overwrite it.
    const match = clipped.match(/^([^:]{2,40}):\s*(.+)$/);
    const key = normalizeKey(match ? match[1] : clipped.split(/\s+/).slice(0, 4).join(' '));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    facts.push({ k: key, v: clipped, t: Date.now(), s: nextSequence() });
  }
  return facts;
};

/** Render facts back to the compact text the prompts expect. */
export const renderMemory = (facts) => {
  if (!Array.isArray(facts) || facts.length === 0) return '';
  const lines = [];
  let total = 0;
  // Newest first: if we have to cut, we cut the stalest knowledge.
  const ordered = [...facts].sort(byRecency);
  for (const fact of ordered) {
    const line = `- ${fact.v}`;
    if (total + line.length + 1 > MAX_RENDER_CHARS) break;
    lines.push(line);
    total += line.length + 1;
  }
  return lines.join('\n');
};

/**
 * Load memory for a user, migrating any legacy blob into facts once.
 * @returns {Promise<{facts: Array, text: string}>}
 */
export const loadMemory = async (userId) => {
  if (!userId) return { facts: [], text: '' };
  try {
    const batch = await Storage.getBatch([factsKey(userId), blobKey(userId)]);
    let facts = batch[factsKey(userId)];

    if (!Array.isArray(facts) || facts.length === 0) {
      // First run on the new format: seed from whatever the blob holds so a
      // returning user keeps everything Aura already knew about them.
      const legacy = batch[blobKey(userId)];
      facts = parseMemoryText(typeof legacy === 'string' ? legacy : '');
      if (facts.length > 0) await Storage.set(factsKey(userId), facts);
    }

    const safe = Array.isArray(facts) ? facts.filter((f) => f && f.v) : [];
    return { facts: safe, text: renderMemory(safe) };
  } catch (error) {
    console.log('[AuraMemory] load failed:', error?.message || error);
    return { facts: [], text: '' };
  }
};

/**
 * Merge the model's returned memory text into stored facts.
 *
 * Restated keys win (the user corrected something), untouched keys survive
 * (the model just didn't mention them this turn). That asymmetry is the whole
 * point: it's what stops Aura forgetting.
 *
 * @returns {Promise<{facts: Array, text: string, changed: boolean}>}
 */
export const mergeMemory = async (userId, incomingText) => {
  const incoming = parseMemoryText(incomingText);
  const current = await loadMemory(userId);

  if (incoming.length === 0) return { ...current, changed: false };

  const byKey = new Map();
  for (const fact of current.facts) {
    if (fact?.k) byKey.set(fact.k, fact);
  }
  let changed = false;
  for (const fact of incoming) {
    const existing = byKey.get(fact.k);
    if (!existing || existing.v !== fact.v) changed = true;
    byKey.set(fact.k, fact);
  }

  let merged = [...byKey.values()].sort(byRecency);
  if (merged.length > MAX_FACTS) {
    merged = merged.slice(0, MAX_FACTS);
    changed = true;
  }

  const text = renderMemory(merged);
  if (!changed) return { facts: merged, text, changed: false };

  if (userId) {
    try {
      await Storage.set(factsKey(userId), merged);
      // Keep the legacy blob in step: dataManager and the cloud column both
      // still read a plain string.
      await Storage.set(blobKey(userId), text);
    } catch (error) {
      console.log('[AuraMemory] save failed:', error?.message || error);
    }
  }
  return { facts: merged, text, changed: true };
};

/** Wipe memory for a user (used by account deletion / manual reset). */
export const clearMemory = async (userId) => {
  if (!userId) return;
  try {
    await Storage.set(factsKey(userId), []);
    await Storage.set(blobKey(userId), '');
  } catch (error) {
    console.log('[AuraMemory] clear failed:', error?.message || error);
  }
};
