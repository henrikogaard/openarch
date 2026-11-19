import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../i18n';
import { useFocusTrap } from '../useFocusTrap';

export interface CommandItem {
  id: string;
  label: string;
  /** Optional grouping shown as a small heading above the item. */
  group?: string;
  keywords?: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  items: CommandItem[];
  onClose: () => void;
  onRun: (item: CommandItem) => void;
}

function matches(item: CommandItem, query: string): boolean {
  if (!query) return true;
  const haystack = `${item.label} ${item.keywords ?? ''} ${item.group ?? ''}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((token) => haystack.includes(token));
}

/**
 * ⌘K palette: fuzzy search over workspaces, views, elements, and actions.
 * Arrow keys move, Enter runs, Escape closes.
 */
export default function CommandPalette({ open, items, onClose, onRun }: CommandPaletteProps) {
  const trapRef = useRef<HTMLDivElement>(null);
  useFocusTrap(trapRef, open);
  const t = useTranslation();
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => items.filter((item) => matches(item, query)).slice(0, 50), [items, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setHighlighted(0);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => setHighlighted(0), [query]);

  useEffect(() => {
    const highlightedElement = listRef.current?.children[highlighted];
    highlightedElement?.scrollIntoView({ block: 'nearest' });
  }, [highlighted]);

  if (!open) return null;

  const run = (item: CommandItem) => {
    onClose();
    onRun(item);
  };

  return (
    <div ref={trapRef} className="modal-overlay" role="dialog" aria-modal="true" aria-label={t('commandPalette')} onClick={onClose}>
      <div className="command-palette" onClick={(event) => event.stopPropagation()}>
        <input
          ref={inputRef}
          className="command-input"
          type="search"
          placeholder={t('palettePlaceholder')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setHighlighted((current) => Math.min(current + 1, results.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setHighlighted((current) => Math.max(current - 1, 0));
            } else if (event.key === 'Enter' && results[highlighted]) {
              event.preventDefault();
              run(results[highlighted]);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            }
          }}
        />
        <div className="command-list" ref={listRef}>
          {results.length === 0 && <div className="command-empty">{t('noMatches')}</div>}
          {results.map((item, index) => (
            <button
              key={item.id}
              className={`command-item${index === highlighted ? ' highlighted' : ''}`}
              onMouseEnter={() => setHighlighted(index)}
              onClick={() => run(item)}
            >
              {item.group && <span className="command-group">{item.group}</span>}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
