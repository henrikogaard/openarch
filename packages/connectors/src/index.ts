import type { Model } from '@openarch/core';

export interface ConnectorConfig {
  /** Jira base URL, e.g. https://company.atlassian.net */
  jiraBaseUrl?: string;
  /** Confluence base URL, e.g. https://company.atlassian.net/wiki */
  confluenceBaseUrl?: string;
  /** Confluence space key to publish into (required for publish). */
  confluenceSpaceKey?: string;
  /** ServiceNow instance URL, e.g. https://company.service-now.com */
  serviceNowUrl?: string;
  /**
   * API credential. Atlassian cloud (Jira/Confluence REST) authenticates with
   * Basic email:apiToken; ServiceNow uses Bearer. The account email is
   * required for the Atlassian connectors.
   */
  accountEmail?: string;
  /** API token (session-only in the UI). */
  token?: string;
}

/**
 * Atlassian cloud APIs reject Bearer auth — they need Basic with
 * `email:apiToken`. ServiceNow keeps Bearer.
 */
function authHeader(config: ConnectorConfig, system: 'jira' | 'confluence' | 'servicenow'): string {
  if (system === 'servicenow' || !config.accountEmail) {
    return `Bearer ${config.token}`;
  }
  const credentials = Buffer
    ? Buffer.from(`${config.accountEmail}:${config.token}`).toString('base64')
    : btoa(unescape(encodeURIComponent(`${config.accountEmail}:${config.token}`)));
  return `Basic ${credentials}`;
}

export function jiraIssueUrl(config: ConnectorConfig, key: string): string | undefined {
  if (!config.jiraBaseUrl || !key.trim()) return undefined;
  // The key is untrusted model text — encode it before it enters a path.
  return `${config.jiraBaseUrl.replace(/\/$/, '')}/browse/${encodeURIComponent(key.trim().toUpperCase())}`;
}

export function confluencePageUrl(config: ConnectorConfig, pageId: string): string | undefined {
  if (!config.confluenceBaseUrl || !pageId.trim()) return undefined;
  return `${config.confluenceBaseUrl.replace(/\/$/, '')}/pages/viewpage.action?pageId=${encodeURIComponent(pageId.trim())}`;
}

/**
 * Convert a full standalone HTML document to a Confluence storage-format
 * fragment: Confluence accepts a constrained XHTML subset, not `<html>`
 * wrappers or stylesheets. The `<style>` block is dropped; body content is kept.
 */
export function standaloneHtmlToStorageFormat(html: string): string {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  return body
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<\/?(?:html|head|body|meta|link)[^>]*>/gi, '')
    .trim();
}

/** Publish a workspace report to Confluence as a new page. Returns the created page id. */
export async function publishToConfluence(
  config: ConnectorConfig,
  title: string,
  html: string,
): Promise<string> {
  if (!config.confluenceBaseUrl || !config.token || !config.accountEmail) {
    throw new Error('Confluence URL, account email, and token are required');
  }
  if (!config.confluenceSpaceKey?.trim()) {
    throw new Error('Confluence space key is required (set it in Settings → Connectors)');
  }
  const body = standaloneHtmlToStorageFormat(html);
  return fetch(`${config.confluenceBaseUrl.replace(/\/$/, '')}/rest/api/content`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: authHeader(config, 'confluence'),
    },
    body: JSON.stringify({
      type: 'page',
      title,
      space: { key: config.confluenceSpaceKey.trim() },
      body: { storage: { value: body, representation: 'storage' } },
    }),
  }).then(async (response) => {
    if (!response.ok) throw new Error(`Confluence publish failed: ${response.status}`);
    const created = (await response.json()) as { id?: string };
    if (!created.id) throw new Error('Confluence did not return a page id');
    return created.id;
  });
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
    {
      headers: { accept: 'application/json', authorization: authHeader(config, 'servicenow') },
      signal: AbortSignal.timeout(20000),
    },
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
