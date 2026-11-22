import { type TranslationKey } from '../i18n';
import { useTranslation } from '../i18n';

export const SHORTCUTS: Array<{ keys: string; action: TranslationKey | string }> = [
  { keys: '⌘/Ctrl + K', action: 'Command palette' },
  { keys: '⌘/Ctrl + Z', action: 'Undo' },
  { keys: '⌘/Ctrl + ⇧ + Z', action: 'Redo' },
  { keys: '⌘/Ctrl + C', action: 'Copy selected elements' },
  { keys: '⌘/Ctrl + V', action: 'Paste' },
  { keys: '⌘/Ctrl + D', action: 'Duplicate selection' },
  { keys: 'Delete / Backspace', action: 'Delete selection from the model' },
  { keys: 'Shift + click', action: 'Multi-select' },
  { keys: 'Double-click node', action: 'Rename element on canvas' },
  { keys: 'Double-click edge', action: 'Add bendpoint' },
  { keys: 'Right-click', action: 'Context menu (canvas/node)' },
  { keys: 'Escape', action: 'Close dialog / exit presentation' },
];

/** Single-source-of-truth shortcut cheatsheet; open with the ? key or ⌘/. */
export default function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const t = useTranslation();
  void t;
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <h2>Keyboard shortcuts</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="modal-body">
          <table className="shortcut-table">
            <tbody>
              {SHORTCUTS.map((shortcut) => (
                <tr key={shortcut.keys}>
                  <td className="mono">{shortcut.keys}</td>
                  <td>{shortcut.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
