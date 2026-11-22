/** A real-world resource that can be turned into candidate ArchiMate elements. */
export interface RawResource {
  source: string;
  key: string;
  fields: Record<string, string>;
}

/** A deterministic, reviewable suggestion for a new architecture element. */
export interface Proposal {
  id: string;
  type: string;
  name: string;
  documentation: string;
  source: string;
  confidence: number;
  reason: string;
}

/** The outcome of running the enrichment pipeline over a set of resources. */
export interface EnrichmentResult {
  proposals: Proposal[];
  /** Resources whose key or name matched an existing element (deduped). */
  skipped: number;
}
