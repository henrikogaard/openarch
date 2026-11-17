import { primaryText, type Model } from '@openarch/core';

interface SharePayload {
  v: 2;
  name: string;
  elements: Model['elements'];
  relationships: Model['relationships'];
  viewId?: string;
  nodes?: Model['views'][number]['nodes'];
  edges?: Model['views'][number]['edges'];
}

/** Browsers and chat clients truncate long URLs; refuse rather than emit a broken link. */
export const MAX_SHARE_HASH_LENGTH = 6000;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const base64 =
    typeof Buffer !== 'undefined'
      ? Buffer.from(binary, 'binary').toString('base64')
      : btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary =
    typeof Buffer !== 'undefined'
      ? Buffer.from(base64, 'base64').toString('binary')
      : atob(base64);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function gzip(text: string): Promise<Uint8Array | undefined> {
  if (typeof CompressionStream === 'undefined') return undefined;
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes: Uint8Array): Promise<string | undefined> {
  if (typeof DecompressionStream === 'undefined') return undefined;
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

/**
 * Compact, read-only snapshot encoded into a URL fragment.
 *
 * Uses gzip when the platform provides CompressionStream (all modern
 * browsers) and falls back to plain JSON. The caller must check the returned
 * length — `shareUrl` throws when the result is too long to be a usable link.
 */
export async function createShareHash(model: Model, viewId?: string): Promise<string> {
  const view = viewId ? model.views.find((item) => item.id === viewId) : model.views[0];
  const payload: SharePayload = {
    v: 2,
    name: primaryText(model.name) || 'Shared model',
    elements: model.elements,
    relationships: model.relationships,
    viewId: view?.id,
    nodes: view?.nodes,
    edges: view?.edges,
  };
  const json = JSON.stringify(payload);
  const compressed = await gzip(json);
  if (compressed) return `z${toBase64Url(compressed)}`;
  return `j${toBase64Url(new TextEncoder().encode(json))}`;
}

export async function readShareHash(hash: string): Promise<Model | undefined> {
  try {
    const value = hash.replace(/^#?share=/, '');
    const marker = value[0];
    const bytes = fromBase64Url(value.slice(1));
    const json = marker === 'z' ? await gunzip(bytes) : new TextDecoder().decode(bytes);
    if (!json) return undefined;
    const payload = JSON.parse(json) as SharePayload;
    if ((payload.v !== 2 && payload.v !== 1) || !Array.isArray(payload.elements)) {
      return undefined;
    }
    return {
      id: `shared-${value.slice(0, 8)}`,
      name: [{ lang: 'en', value: payload.name }],
      documentation: [],
      properties: [],
      propertyDefinitions: [],
      elements: payload.elements,
      relationships: payload.relationships,
      views: [
        {
          id: payload.viewId ?? 'shared-view',
          type: 'Diagram',
          name: [{ lang: 'en', value: payload.name }],
          nodes: payload.nodes ?? [],
          edges: payload.edges ?? [],
        },
      ],
    };
  } catch {
    return undefined;
  }
}

export class ShareLinkTooLongError extends Error {
  constructor(
    readonly length: number,
    readonly limit: number,
  ) {
    super(
      `This model is too large for a share link (${length} characters, limit ${limit}). ` +
        'Export AOEF or use server mode to share it instead.',
    );
    this.name = 'ShareLinkTooLongError';
  }
}

export async function shareUrl(
  model: Model,
  viewId?: string,
  baseUrl = typeof window !== 'undefined' ? window.location.href : 'http://localhost/',
): Promise<string> {
  const hash = await createShareHash(model, viewId);
  if (hash.length > MAX_SHARE_HASH_LENGTH) {
    throw new ShareLinkTooLongError(hash.length, MAX_SHARE_HASH_LENGTH);
  }
  return `${baseUrl.split('#')[0]}#share=${hash}`;
}
