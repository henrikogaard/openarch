import type { Model } from '@openarch/core';

/** Result of reading an Archi `.archimate` archive. */
export interface ArchiImportResult {
  model: Model;
  warnings: string[];
}
