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
      { confluenceBaseUrl: 'https://co.atlassian.net/wiki', token: 't' },
      'Overview',
      '<p>hi</p>',
      'ARCH',
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
