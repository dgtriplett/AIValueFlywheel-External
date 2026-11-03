/**
 * ConfirmModal + useConfirm — async confirmation dialog that works inside
 * Databricks Apps iframes (the browser's `window.confirm()` is silently
 * dismissed there).
 *
 * Usage:
 *   const { confirm, ConfirmHost } = useConfirm();
 *
 *   async function onDelete() {
 *     if (!(await confirm({
 *       title: 'Delete use case?',
 *       message: 'This cannot be undone.',
 *       danger: true,
 *       confirmLabel: 'Delete',
 *     }))) return;
 *     // proceed
 *   }
 *
 *   return <>{ConfirmHost}{...rest}</>;
 */
import React, { useCallback, useRef, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface PendingState extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

export function useConfirm() {
  const [pending, setPending] = useState<PendingState | null>(null);
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback((opts: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
      setPending({ ...opts, resolve });
    });
  }, []);

  const close = useCallback((ok: boolean) => {
    const r = resolverRef.current;
    resolverRef.current = null;
    setPending(null);
    if (r) r(ok);
  }, []);

  const ConfirmHost = pending ? (
    <ConfirmModal
      options={pending}
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    />
  ) : null;

  return { confirm, ConfirmHost };
}

interface ConfirmModalProps {
  options: ConfirmOptions;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({ options, onConfirm, onCancel }) => {
  const danger = !!options.danger;
  // Keyboard shortcuts: Esc cancels, Enter confirms.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, onConfirm]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={options.title}
        className="w-full max-w-md rounded-xl border border-navy-500 bg-navy-800 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-navy-600">
          <div className="flex items-start gap-3">
            {danger && (
              <div className="w-8 h-8 rounded-lg bg-lava/15 border border-lava/30 flex items-center justify-center">
                <AlertTriangle className="w-4 h-4 text-lava" />
              </div>
            )}
            <h2 className="text-sm font-semibold text-heading pt-1">{options.title}</h2>
          </div>
          <button
            onClick={onCancel}
            className="text-navy-400 hover:text-heading"
            title="Cancel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {options.message && (
          <div className="px-5 py-4 text-sm text-slate-300 leading-relaxed">
            {options.message}
          </div>
        )}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-navy-600">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-sm border border-navy-500 text-slate-300 hover:text-heading hover:border-navy-400"
          >
            {options.cancelLabel || 'Cancel'}
          </button>
          <button
            onClick={onConfirm}
            autoFocus
            className={
              'px-3 py-1.5 rounded-lg text-sm font-medium ' +
              (danger
                ? 'bg-lava hover:bg-lava-600 text-heading'
                : 'bg-electric hover:bg-electric-400 text-heading')
            }
          >
            {options.confirmLabel || 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
};
