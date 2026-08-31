import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The app's notification surface.
 *
 * window.alert was doing this job, and doing it badly: it blocks the page, it cannot be styled, it
 * shows one message at a time, and whatever string it is handed is what a person reads — which is
 * how raw provider prose ended up in front of operators. A toast renders the same information
 * without freezing the app, and it can stay on screen long enough to copy a voice id out of.
 *
 * Errors and warnings are sticky. A failure an operator has to act on must not disappear while
 * they are reading it; confirmations time out, because nothing is lost when they do.
 */

export type ToastTone = 'error' | 'warning' | 'success' | 'info';

export interface ToastInput {
  tone: ToastTone;
  title: string;
  message?: string;
  /** Overrides the tone's default: errors and warnings persist, confirmations do not. */
  sticky?: boolean;
}

export interface ToastMessage extends ToastInput {
  id: number;
}

const AUTO_DISMISS_MS = 6500;
// Three is what fits above the fold beside the page's own controls. A taller stack of sticky
// errors starts covering the buttons a person needs to press to clear them.
const MAX_VISIBLE = 3;

const TONE_STYLES: Record<ToastTone, { accent: string; label: string; labelText: string; icon: React.ReactNode }> = {
  error: {
    accent: 'bg-red-600',
    label: 'bg-red-50 text-red-700',
    labelText: 'Problem',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v3.75m0 3.75h.008M10.34 3.94l-7.6 13.17A1.92 1.92 0 004.4 20h15.2a1.92 1.92 0 001.66-2.89l-7.6-13.17a1.92 1.92 0 00-3.32 0z" />
      </svg>
    ),
  },
  warning: {
    accent: 'bg-amber-500',
    label: 'bg-amber-50 text-amber-700',
    labelText: 'Heads up',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v3.75m0 3.75h.008M12 21a9 9 0 100-18 9 9 0 000 18z" />
      </svg>
    ),
  },
  success: {
    accent: 'bg-emerald-600',
    label: 'bg-emerald-50 text-emerald-700',
    labelText: 'Done',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M4.5 12.75l5.25 5.25 9.75-11.25" />
      </svg>
    ),
  },
  info: {
    accent: 'bg-cat-black',
    label: 'bg-slate-100 text-slate-600',
    labelText: 'Note',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M11.25 11.25h.75v4.5h.75M12 8.25h.008M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
};

function isSticky(toast: ToastMessage): boolean {
  return toast.sticky ?? (toast.tone === 'error' || toast.tone === 'warning');
}

export interface ToastController {
  toasts: ToastMessage[];
  pushToast: (toast: ToastInput) => number;
  dismissToast: (id: number) => void;
  clearToasts: () => void;
}

export function useToasts(): ToastController {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const nextId = useRef(1);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback((toast: ToastInput) => {
    const id = nextId.current++;
    setToasts((current) => {
      // Pressing a failing button twice should refresh one notice, not stack two identical ones.
      const withoutDuplicate = current.filter(
        (existing) => !(existing.title === toast.title && existing.message === toast.message),
      );
      return [...withoutDuplicate, { ...toast, id }].slice(-MAX_VISIBLE);
    });
    return id;
  }, []);

  const clearToasts = useCallback(() => setToasts([]), []);

  return { toasts, pushToast, dismissToast, clearToasts };
}

function ToastCard({ toast, onDismiss }: { toast: ToastMessage; onDismiss: (id: number) => void }) {
  const tone = TONE_STYLES[toast.tone];

  useEffect(() => {
    if (isSticky(toast)) return;
    const timer = window.setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [toast, onDismiss]);

  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      className="pointer-events-auto w-[min(92vw,26rem)] bg-white/95 backdrop-blur-xl border border-white/60 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.14)] overflow-hidden"
    >
      <div className={`h-[3px] w-full ${tone.accent}`} />
      <div className="px-5 py-4">
        <div className="flex items-start gap-3">
          <span className={`shrink-0 mt-[2px] w-7 h-7 rounded-xl flex items-center justify-center ${tone.label}`}>
            {tone.icon}
          </span>
          <div className="min-w-0 flex-1">
            <span className={`inline-block px-2 py-[3px] rounded-full text-[9px] font-black uppercase tracking-[0.18em] ${tone.label}`}>
              {tone.labelText}
            </span>
            <p className="mt-2 text-[13px] font-black text-cat-black leading-snug">{toast.title}</p>
            {toast.message && (
              // break-words so a voice id that does not fit wraps instead of widening the card.
              <p className="mt-1.5 text-[12px] text-slate-600 leading-relaxed break-words">{toast.message}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            aria-label="Dismiss notification"
            className="shrink-0 -mr-1 -mt-1 w-7 h-7 rounded-lg text-slate-400 hover:text-cat-black hover:bg-slate-100 transition-colors flex items-center justify-center"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export function ToastStack({ toasts, onDismiss }: { toasts: ToastMessage[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div
      // Above the floating nav (z-200) and the logo banner (z-300). The container ignores pointer
      // events so it never blocks the page behind it; each card takes them back.
      className="fixed bottom-6 right-6 z-[400] no-print flex flex-col gap-3 items-end pointer-events-none"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
