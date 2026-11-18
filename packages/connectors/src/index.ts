import type { Model } from '@openarch/core';

export interface ConnectorConfig {
  /** Jira base URL, e.g. https://company.atlassian.net */
  jiraBaseUrl?: string;
  /** Confluence base URL, e.g. https://company.atlassian.net/wiki */
  confluenceBaseUrl?: string;
  /** ServiceNow instance URL, e.g. https://company.service-now.com */
  serviceNowUrl?: string;
  /** Bearer token for the connector APIs (session-only in the UI). */
  token?: string;
}

export function jiraIssueUrl(config: ConnectorConfig, key: string): string | undefined {
  if (!config.jiraBaseUrl || !key.trim()) return undefined;
  return `${config.jiraBaseUrl.replace(/\/$/, '')}/browse/${key.trim().toUpperCase()}`;
}

export function confluencePageUrl(config: ConnectorConfig, pageId: string): string | undefined {
  if (!config.confluenceBaseUrl || !pageId.trim()) return undefined;
  return `${config.confluenceBaseUrl.replace(/\/$/, '')}/pages/viewpage.action?pageId=${encodeURIComponent(pageId.trim())}`;
}

/** Publish a view's HTML to Confluence as a new page. Returns the created page id. */
export async function publishToConfluence(
  config: ConnectorConfig,
  title: string,
  html: string,
  spaceKey: string,
): Promise<string> {
  if (!config.confluenceBaseUrl || !config.token) throw new Error('Confluence URL and token are required');
  const response = await fetch(`${config.confluenceBaseUrl.replace(/\/$/, '')}/rest/api/content`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${config.token}`,
    },
    body: JSON.stringify({
      type: 'page',
      title,
      space: { key: spaceKey },
      body: { storage: { value: html, representation: 'storage' } },
    }),
  });
  if (!response.ok) throw new Error(`Confluence publish failed: ${response.status}`);
  const created = (await response.json()) as { id?: string };
  if (!created.id) throw new Error('Confluence did not return a page id');
  return created.id;
}

/** Read-only ServiceNow CMDB lookup by name; returns a CI record or undefined. */
export async function fetchServiceNowCi(
  config: ConnectorConfig,
  name: string,
): Promise<{ sys_id: string; name: string; [key: string]: unknown } | undefined> {
  if (!config.serviceNowUrl || !config.token) throw new Error('ServiceNow URL and token are required');
  const query = encodeURIComponent(`name=${name}`);
  const response = await fetch(
    `${config.serviceNowUrl.replace(/\/$/, '')}/api/now/table/cmdb_ci?sysparm_query=${query}&sysparm_limit=1`,
    { headers: { accept: 'application/json', authorization: `Bearer ${config.token}` } },
  );
  if (!response.ok) throw new Error(`ServiceNow lookup failed: ${response.status}`);
  const data = (await response.json()) as { result?: Array<Record<string, unknown>> };
  const record = data.result?.[0];
  return record ? (record as { sys_id: string; name: string }) : undefined;
}

/** Element property key used to store external links. */
export function linkPropertyKey(system: 'jira' | 'confluence' | 'servicenow'): string {
  return `link:${system}`;
}

export function elementLinks(model: Model, elementId: string): Array<{ system: string; value: string }> {
  const element = model.elements.find((candidate) => candidate.id === elementId);
  if (!element) return [];
  return linksOfElement(element);
}

export function linksOfElement(element: { properties: Array<{ key: string; value: string }> }): Array<{ system: string; value: string }> {
  return element.properties
    .filter((property) => property.key.startsWith('link:'))
    .map((property) => ({ system: property.key.slice(5), value: property.value }));
}
