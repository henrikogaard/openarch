import type { RawResource } from './types';

export interface SourceFile {
  path: string;
  content: string;
}

/** Return the file-name portion of a path using forward or back slashes. */
function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

/** Return the lower-cased extension without a leading dot. */
function extension(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

/**
 * Pure "Git repo reader" adapter: turn path/content pairs (from a repo scan, a
 * drop zone or an API) into raw resources. No filesystem or network access, so
 * this works unchanged in the browser and in Node.
 */
export function filesToResources(files: SourceFile[]): RawResource[] {
  return files.map(({ path, content }) => {
    const name = basename(path);
    const ext = extension(name);
    return {
      source: 'git-files',
      key: path,
      fields: {
        path,
        name,
        ext,
        content,
      },
    };
  });
}
