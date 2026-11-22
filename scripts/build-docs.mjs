#!/usr/bin/env node
/**
 * OpenArch docs site builder — zero dependencies.
 *
 * Renders docs/*.md (+ README/CONTRIBUTING/CHANGELOG/SECURITY) to
 * apps/docs/index.html with client-side navigation, an accessible-ish clean
 * layout, and no build framework. Client-side highlighting: none; content is
 * escaped and wrapped as <pre> (the docs are plain and code-light).
 * Output convention: docs/index.md → /#slug sections; the site is one page
 * with anchor navigation so GitHub Pages can serve it from anywhere.
 *
 * Usage: node scripts/build-docs.mjs   (CI runs it in docs.yml)
 */
import { readFile, readdir, writeFile, copyFile, mkdir } from 'node:fs/promises';
import { dirname as pathDirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = pathDirname(pathDirname(fileURLToPath(import.meta.url)));
const docsDir = join(root, 'docs');
const outDir = join(root, 'site-dist');

const escape = (value) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').trim();
const slugify = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';

/** Minimal Markdown → HTML (headings, code fences, links, lists, bold; everything escaped). */
function markdownToHtml(markdown, pathPrefix = '.') {
  const lines = markdown.split('\n');
  const out = [];
  let inCode = false;
  let inList = false;
  const inline = (text) =>
    escape(text)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, href) => {
        const src = href.replace(/^(\.\.?\/)?(docs\/)?/, '#').replace(/\.md($|#.*)$/, '$1').replace(/#$/, '');
        return `<a href="${href.startsWith('http') ? escape(href) : src || '#'}">${label}</a>`;
      });
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      out.push(inCode ? '</code></pre>' : '<pre><code>');
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      out.push(escape(line)); // keep code verbatim (escaped)
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      if (inList) { out.push('</ul>'); inList = false; }
      const level = heading[1].length;
      const text = heading[2];
      out.push(`<h${level} id="${slugify(text)}">${inline(text)}</h${level}>`);
      continue;
    }
    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed);
    if (bullet) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    if (inList) { out.push('</ul>'); inList = false; }
    if (/^\|/.test(trimmed)) {
      out.push(`<div class="table-row">${inline(trimmed.replace(/^\||\|$/g, ''))}</div>`);
      continue;
    }
    if (trimmed.startsWith('>')) {
      out.push(`<blockquote>${inline(trimmed.slice(1))}</blockquote>`);
      continue;
    }
    if (trimmed === '---') {
      out.push('<hr>');
      continue;
    }
    if (trimmed === '') {
      out.push('');
      continue;
    }
    void pathPrefix;
    out.push(`<p>${inline(trimmed)}</p>`);
  }
  if (inList) out.push('</ul>');
  if (inCode) out.push('</code></pre>');
  return out.join('\n');
}

const page = async (title, markdown, nav) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)} — OpenArch</title>
<link rel="icon" type="image/svg+xml" href="./icon.svg">
<style>
  :root { --bg:#f5f7fa; --surface:#fff; --border:#dfe5ec; --text:#1f2937; --muted:#667085; --accent:#2563eb; }
  body { margin:0; font:14px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color:var(--text); background:var(--bg); }
  header, .wrap { max-width: 1200px; margin: 0 auto; padding: 0 20px; }
  header { display:flex; align-items:baseline; gap:16px; padding:24px 20px; border-bottom:1px solid var(--border); background:var(--surface); }
  header h1 { font-size:20px; margin:0; }
  header a { color:inherit; text-decoration:none; } header a:hover { color:var(--accent); }
  .layout { display:grid; grid-template-columns: 260px 1fr; gap: 28px; padding: 24px 20px; }
  nav { position:sticky; top:16px; max-height:calc(100vh - 48px); overflow:auto; font-size:13px; }
  nav h3 { margin:14px 0 6px; font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); }
  nav a { display:block; color:var(--text); text-decoration:none; padding:3px 6px; border-radius:6px; }
  nav a:hover { background:var(--accent); color:#fff; }
  main { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:28px 32px; max-width: 900px; }
  article:not(:first-of-type)::before { content:''; display:block; margin-top:56px; border-top:1px solid var(--border); }
  h1,h2,h3 { line-height:1.25; } h1 {font-size:24px;} h2 {font-size:20px; margin-top:36px;} h3 {font-size:16px;}
  pre { background:#0f172a; color:#e2e8f0; padding:14px; border-radius:8px; overflow:auto; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
  p code, li code { background:#eef2f7; padding:1px 5px; border-radius:4px; }
  blockquote { border-left:3px solid var(--accent); margin:12px 0; padding:4px 12px; color:var(--muted); }
  .table-row { font-family:ui-monospace,monospace; font-size:12px; padding:2px 0; border-bottom:1px solid var(--border); }
  table { border-collapse: collapse; }
  @media (max-width: 900px) { .layout { grid-template-columns: 1fr; } nav { position: static; } }
  @media print { nav, header { display: none; } .layout { display:block; } main { border:none; } }
</style>
</head>
<body>
<header>
  <h1><a href="#top">OpenArch</a></h1>
  <span>— open, local-first ArchiMate® 3.2 modelling</span>
</header>
<div class="wrap layout">
<nav id="top">
  <h3>Start here</h3>
  ${nav}
</nav>
<main>
${markdown}
</main>
</div>
</body>
</html>`;

try {
  await mkdir(outDir, { recursive: true });
  const docsFiles = (await readdir(docsDir)).filter((name) => name.endsWith('.md') && !name.includes('test'));
  const rootDocs = ['CONTRIBUTING.md', 'SECURITY.md', 'CHANGELOG.md'];
  const modules = [];
  const navEntries = [];

  const baseURL = 'https://github.com/henrikogaard/openarch/tree/main';
  void baseURL;

  if (!(await readdir(docsDir).then((names)=>names.includes('index.md')).catch(()=>false))) {
    // derive an overview from the README to give the site a home page anchor
    const readme = await readFile(join(root, 'README.md'), 'utf8');
    modules.push({ id: 'overview', title: 'Overview', html: markdownToHtml(readme) });
    navEntries.push('<a href="#overview">Overview</a>');
  }
  for (const name of rootDocs) {
    const markdown = await readFile(join(root, name), 'utf8');
    const title = name.replace('.md', '');
    modules.push({ id: slugify(title), title, html: markdownToHtml(markdown) });
    navEntries.push(`<a href="#${slugify(title)}">${title}</a>`);
  }
  for (const name of docsFiles) {
    const markdown = await readFile(join(docsDir, name), 'utf8');
    const title = name.replace('.md', '');
    // Each docs file becomes its own <article>; anchors keep deep links working.
    modules.push({
      id: slugify(title),
      title,
      html: `<article><h1 id="${slugify(title)}">${escape(title)}</h1>${markdownToHtml(markdown)}</article>`,
    });
    navEntries.push(`<a href="#${slugify(title)}">${escape(title)}</a>`);
  }

  const body = modules.map((module) => module.html).join('\n');
  const nav = navEntries.join('\n');
  await writeFile(join(outDir, 'index.html'), await page('Documentation', body, nav), 'utf8');
  await copyFile(join(root, 'apps/web/public/icon.svg'), join(outDir, 'icon.svg')).catch(() => undefined);
  console.log(`docs site built: ${modules.length} modules → ${join(outDir, 'index.html')}`);
} catch (error) {
  console.error('docs build failed:', error instanceof Error ? error.message : String(error));
  process.exit(1);
}
