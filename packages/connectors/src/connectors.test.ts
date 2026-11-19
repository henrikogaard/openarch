import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  confluencePageUrl,
  elementLinks,
  fetchServiceNowCi,
  jiraIssueUrl,
  linkPropertyKey,
  publishToConfluence,
} from './index';
import { createSampleModel } from '@openarch/core';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('connector helpers', () => {
  it('builds Jira/Confluence links', () => {
    const config = { jiraBaseUrl: 'https://co.atlassian.net/', confluenceBaseUrl: 'https://co.atlassian.net/wiki' };
    expect(jiraIssueUrl(config, 'claims-12')).toBe('https://co.atlassian.net/browse/CLAIMS-12');
    expect(confluencePageUrl(config, '123')).toContain('pageId=123');
    expect(jiraIssueUrl({}, 'X-1')).toBeUndefined();
  });

  it('publishes a page to Confluence and returns the page id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: '98765' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const id = await publishToConfluence(
      { confluenceBaseUrl: 'https://co.atlassian.net/wiki', token: 't', accountEmail: 'a@b.c', confluenceSpaceKey: 'ARCH' },
      'Overview',
      '<p>hi</p>',
    );
    expect(id).toBe('98765');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://co.atlassian.net/wiki/rest/api/content');
    expect(JSON.parse(String(init.body)).body.storage.value).toBe('<p>hi</p>');
  });

  it('looks up a ServiceNow CI read-only', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: [{ sys_id: 'abc', name: 'claims-portal' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const ci = await fetchServiceNowCi({ serviceNowUrl: 'https://co.service-now.com', token: 't' }, 'claims-portal');
    expect(ci?.sys_id).toBe('abc');
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toContain('/api/now/table/cmdb_ci');
    expect(url).toContain('cmdb_ci');
  });

  it('reads element links from properties', () => {
    const model = createSampleModel();
    const portal = model.elements.find((e) => e.id === 'e-portal')!;
    portal.properties.push({ key: linkPropertyKey('jira'), value: 'CLAIMS-12' });
    const links = elementLinks(model, 'e-portal');
    expect(links).toEqual([{ system: 'jira', value: 'CLAIMS-12' }]);
  });
});

describe('connector auth + storage format', () => {
  it('publishes with Basic auth (Atlassian), configured space, and fragment body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: '111' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const id = await publishToConfluence(
      {
        confluenceBaseUrl: 'https://co.atlassian.net/wiki',
        confluenceSpaceKey: 'ARCH',
        accountEmail: 'me@co.com',
        token: 'tok',
      },
      'Report',
      '<!doctype html><html><head><style>body{}</style></head><body><h1>Hi</h1><p>x</p></body></html>',
    );
    expect(id).toBe('111');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://co.atlassian.net/wiki/rest/api/content');
    const auth = String(init.headers && (init.headers as Record<string, string>).authorization);
    expect(auth.startsWith('Basic ')).toBe(true);
    expect(auth).not.toContain('Bearer');
    const body = JSON.parse(String(init.body));
    expect(body.space.key).toBe('ARCH');
    // Storage format: fragment only, no document wrappers or styles.
    expect(body.body.storage.value).toBe('<h1>Hi</h1><p>x</p>');
  });

  it('refuses to publish without a configured space key', async () => {
    await expect(
      publishToConfluence(
        { confluenceBaseUrl: 'https://x', accountEmail: 'a@b.c', token: 't' },
        'T',
        '<body>x</body>',
      ),
    ).rejects.toThrow(/space key/);
  });

  it('URL-encodes untrusted Jira keys into browse links', () => {
    const url = jiraIssueUrl({ jiraBaseUrl: 'https://x/' }, 'AB/../evil?a=1');
    expect(url).toBe('https://x/browse/' + encodeURIComponent('AB/../EVIL?A=1'));
  });
});
