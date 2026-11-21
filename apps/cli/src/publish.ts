import { publishToConfluence, type ConnectorConfig } from '@openarch/connectors';
import { readFile, writeFile } from 'node:fs/promises';

/**
 * Publish a workspace report to Confluence (scheduled publishing = cron this).
 *
 *   openarch publish-confluence <model> \
 *     --url https://company.atlassian.net/wiki \
 *     --space ARCH --email me@company.com --token <api-token> [--title "..."]
 *
 * Credentials come from flags or OPENARCH_CONFLUENCE_* environment variables;
 * nothing is persisted. Exit codes: 0 published, 1 validation/refusal, 2 network.
 */
export async function publish(
  modelPath: string,
  flags: Record<string, string | undefined>,
): Promise<number> {
  const config: ConnectorConfig = {
    confluenceBaseUrl: flags.url ?? process.env.OPENARCH_CONFLUENCE_URL,
    confluenceSpaceKey: flags.space ?? process.env.OPENARCH_CONFLUENCE_SPACE,
    accountEmail: flags.email ?? process.env.OPENARCH_CONFLUENCE_EMAIL,
    token: flags.token ?? process.env.OPENARCH_CONFLUENCE_TOKEN,
  };
  const missing = [
    ['--url', config.confluenceBaseUrl],
    ['--space', config.confluenceSpaceKey],
    ['--email', config.accountEmail],
    ['--token', config.token],
  ]
    .filter(([, value]) => !value)
    .map(([flag]) => flag);
  if (missing.length) {
    console.error(`Missing required configuration: ${missing.join(', ')} (or their OPENARCH_CONFLUENCE_* env variables).`);
    return 1;
  }
  const { exportWorkspaceHtml } = await import('@openarch/reporting');
  const { parseNativeModel } = await import('@openarch/repository');
  const { parseAoef } = await import('@openarch/core');
  const path = modelPath.toLowerCase();
  let model;
  try {
    const text = await readFile(modelPath, 'utf8');
    model = path.endsWith('.json') ? parseNativeModel(text) : parseAoef(text);
  } catch (error) {
    console.error(`Could not read "${modelPath}": ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
  const title = flags.title ?? `${model.name?.[0]?.value ?? 'OpenArch report'} — ${new Date().toISOString().slice(0, 10)}`;
  try {
    const pageId = await publishToConfluence(config, title, exportWorkspaceHtml(model));
    console.log(`Published Confluence page ${pageId}: ${title}`);
    if (flags['page-id-file']) {
      await writeFile(flags['page-id-file'], `${pageId}\n`, 'utf8');
    }
    return 0;
  } catch (error) {
    console.error(`Confluence publish failed: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}
