import { createSampleModel } from '@openarch/core';
import { describe, expect, it } from 'vitest';
import {
  createShareHash,
  MAX_SHARE_HASH_LENGTH,
  readShareHash,
  ShareLinkTooLongError,
  shareUrl,
} from './share';

describe('shareable snapshots', () => {
  it('round-trips a model through a URL fragment', async () => {
    const model = createSampleModel();
    const hash = await createShareHash(model, model.views[0].id);
    const restored = await readShareHash(`#share=${hash}`);
    expect(restored).toBeDefined();
    expect(restored?.elements).toHaveLength(model.elements.length);
    expect(restored?.relationships).toHaveLength(model.relationships.length);
    expect(restored?.views[0].nodes).toHaveLength(model.views[0].nodes.length);
  });

  it('rejects malformed hashes', async () => {
    expect(await readShareHash('#share=not-a-real-payload')).toBeUndefined();
  });

  it('refuses to produce a link that clients would truncate', async () => {
    const model = createSampleModel();
    // High-entropy names so gzip cannot compress the payload below the limit.
    model.elements = Array.from({ length: 400 }, () => ({
      id: `element-${crypto.randomUUID()}`,
      type: 'ApplicationComponent',
      name: [{ lang: 'en', value: crypto.randomUUID() }],
      documentation: [],
      properties: [],
    }));
    await expect(shareUrl(model)).rejects.toBeInstanceOf(ShareLinkTooLongError);
  });

  it('keeps a small model well under the limit', async () => {
    const model = createSampleModel();
    const hash = await createShareHash(model);
    expect(hash.length).toBeLessThan(MAX_SHARE_HASH_LENGTH);
  });
});

describe('share link reader guards', () => {
  it('rejects oversized fragments instead of decompressing them', async () => {
    const huge = '#share=' + 'a'.repeat(70_000);
    expect(await readShareHash(huge)).toBeUndefined();
  });
});
