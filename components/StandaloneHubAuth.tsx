import React, { useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';
import { hubApiFetch } from '../services/hubApi.ts';

const HANDOFF_START_PATH = '/auth/start';

export function isStandaloneHubHost(hostname?: string): boolean {
  const candidate = hostname || (typeof window === 'undefined' ? '' : window.location.hostname);
  return candidate === 'sellparts.fixmyiron.com'
    || candidate === 'iron-hub-flash-pro-6-0.pages.dev';
}

type AccessState = 'checking' | 'authenticated' | 'unavailable';

function returnPath(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function beginSuiteHandoff(): void {
  window.location.replace(`${HANDOFF_START_PATH}?return_to=${encodeURIComponent(returnPath())}`);
}

function StandaloneAccessGate({ children }: { children: React.ReactNode }) {
  const [accessState, setAccessState] = useState<AccessState>('checking');

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12_000);

    void hubApiFetch('/api/hub-session', {
      cache: 'no-store',
      signal: controller.signal,
    }).then((response) => {
      if (response.ok) {
        setAccessState('authenticated');
        return;
      }

      if (response.status === 401) {
        beginSuiteHandoff();
        return;
      }

      setAccessState('unavailable');
    }).catch(() => setAccessState('unavailable')).finally(() => window.clearTimeout(timeout));

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, []);

  if (accessState === 'authenticated') {
    return (
      <>
        <button
          type="button"
          aria-label="Exit standalone Iron Hub"
          title="Exit standalone Iron Hub"
          onClick={() => window.location.assign('/auth/logout')}
          className="fixed right-3 top-3 z-[500] no-print inline-flex h-9 items-center gap-2 border border-white/20 bg-cat-black px-3 text-xs font-bold uppercase tracking-wide text-white shadow-lg transition-colors hover:border-cat-yellow hover:text-cat-yellow"
        >
          <LogOut size={16} aria-hidden="true" />
          <span>Exit</span>
        </button>
        {children}
      </>
    );
  }

  if (accessState === 'unavailable') {
    return (
      <div className="min-h-screen bg-cat-black flex items-center justify-center p-6 text-center">
        <div className="max-w-md space-y-4">
          <p className="text-cat-yellow text-xs font-black uppercase tracking-widest">Workspace unavailable</p>
          <h1 className="text-2xl font-black uppercase text-white">Iron Hub could not verify access</h1>
          <button
            type="button"
            onClick={beginSuiteHandoff}
            className="border border-cat-yellow bg-cat-yellow px-4 py-2 text-sm font-black uppercase text-cat-black"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cat-black flex items-center justify-center text-cat-yellow text-xs font-black uppercase tracking-widest">
      Loading secure workspace...
    </div>
  );
}

export function StandaloneHubAuth({ children }: { children: React.ReactNode }) {
  return <StandaloneAccessGate>{children}</StandaloneAccessGate>;
}
