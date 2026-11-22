import { createStore, get, set, del } from 'idb-keyval';

/**
 * Crash journal: an IndexedDB mirror of the in-memory model, written after
 * every commit (throttled). If the app dies before autosave, the next load
 * offers to recover the unsaved work.
 */
const journalStore = createStore('openarch-journal', 'entries');

export interface JournalEntry {
  modelId: string;
  /** ISO time the snapshot was written (journal clock). */
  stamped: string;
  model: unknown; // full model JSON
}

const THROTTLE_MS = 400;

export function journalWrite(
  model: { id: string },
  serialize: () => string,
): void {
  const key = model.id;
  const now = Date.now();
  const last = journalWrite.last.get(key) ?? 0;
  if (now - last < THROTTLE_MS) {
    window.clearTimeout(journalWrite.timer.get(key));
    journalWrite.timer.set(
      key,
      window.setTimeout(() => {
        journalWrite.last.set(key, Date.now());
        void set(
          key,
          {
            modelId: key,
            stamped: new Date().toISOString(),
            model: serialize(),
          } satisfies JournalEntry,
          journalStore,
        ).catch(() => undefined);
      }, THROTTLE_MS),
    );
    return;
  }
  journalWrite.last.set(key, now);
  void set(
    key,
    {
      modelId: key,
      stamped: new Date().toISOString(),
      model: serialize(),
    } satisfies JournalEntry,
    journalStore,
  ).catch(() => undefined);
}
journalWrite.last = new Map<string, number>();
journalWrite.timer = new Map<string, number>();

/** Read a journal entry newer than the last successful save (else undefined). */
export async function journalRead(
  modelId: string,
  lastSavedAt: string | null,
): Promise<JournalEntry | undefined> {
  try {
    const entry = await get<JournalEntry>(modelId, journalStore);
    if (!entry || typeof entry.model !== 'string') return undefined;
    // The recovery prompt only fires when the journal holds work the
    // repository does not already have.
    if (!lastSavedAt) return entry;
    return Date.parse(entry.stamped) > Date.parse(lastSavedAt) ? entry : undefined;
  } catch {
    return undefined;
  }
}

/** Resolve a journal recovery: parse the stored JSON or fail cleanly. */
export function journalParse(entry: JournalEntry, parse: (json: string) => unknown): unknown | undefined {
  try {
    return parse(String(entry.model));
  } catch {
    return undefined;
  }
}

/** Drop the journal for a model (after a successful save or recovery). */
export function journalClear(modelId: string): void {
  void del(modelId, journalStore).catch(() => undefined);
}
