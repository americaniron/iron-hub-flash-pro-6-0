import React, { useEffect, useState } from 'react';
import {
  ClerkProvider,
  SignIn,
  SignedIn,
  SignedOut,
  UserButton,
  useAuth,
} from '@clerk/clerk-react';
import { setHubApiTokenGetter } from '../services/hubApi.ts';

const CLERK_JS_URL = 'https://cdn.jsdelivr.net/npm/@clerk/clerk-js@5/dist/clerk.browser.js';

function isValidPublishableKey(value: string | undefined): value is string {
  if (typeof value !== 'string') return false;
  const parts = value.split('_');
  if (parts.length !== 3 || parts[0] !== 'pk' || !['live', 'test'].includes(parts[1]) || !/^[A-Za-z0-9_-]+={0,2}$/.test(parts[2])) {
    return false;
  }

  try {
    const encoded = parts[2].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '='));
    return decoded.endsWith('$') && decoded.slice(0, -1).includes('.');
  } catch {
    return false;
  }
}

export function isStandaloneHubHost(hostname?: string): boolean {
  const candidate = hostname || (typeof window === 'undefined' ? '' : window.location.hostname);
  return candidate === 'sellparts.fixmyiron.com'
    || candidate === 'iron-hub-flash-pro-6-0.pages.dev';
}

function StandaloneTokenBridge({ children }: { children: React.ReactNode }) {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const [tokenBridgeState, setTokenBridgeState] = useState<'unknown' | 'signed-in' | 'signed-out'>('unknown');

  useEffect(() => {
    setHubApiTokenGetter(isSignedIn ? () => getToken() : null);
    setTokenBridgeState(isSignedIn ? 'signed-in' : 'signed-out');
    return () => setHubApiTokenGetter(null);
  }, [getToken, isSignedIn]);

  if (!isLoaded || tokenBridgeState !== (isSignedIn ? 'signed-in' : 'signed-out')) {
    return (
      <div className="min-h-screen bg-cat-black flex items-center justify-center text-cat-yellow text-xs font-black uppercase tracking-widest">
        Loading secure workspace...
      </div>
    );
  }

  return (
    <>
      <SignedOut>
        <main className="min-h-screen bg-cat-black flex items-center justify-center p-6">
          <SignIn
            routing="hash"
            forceRedirectUrl="/"
            signUpForceRedirectUrl="/"
            signUpUrl="https://suite.fixmyiron.com/sign-up"
          />
        </main>
      </SignedOut>
      <SignedIn>
        <div className="fixed right-3 top-3 z-[500] no-print">
          <UserButton afterSignOutUrl="/" />
        </div>
        {children}
      </SignedIn>
    </>
  );
}

export function StandaloneHubAuth({ children }: { children: React.ReactNode }) {
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;

  if (!isValidPublishableKey(publishableKey)) {
    return (
      <div className="min-h-screen bg-cat-black flex items-center justify-center p-6 text-center">
        <div className="max-w-md space-y-4">
          <p className="text-cat-yellow text-xs font-black uppercase tracking-widest">Authentication configuration required</p>
          <h1 className="text-2xl font-black uppercase text-white">Iron Hub cannot start sign-in</h1>
          <p className="text-sm leading-relaxed text-slate-300">This deployment is missing its Clerk publishable key. Contact the workspace administrator.</p>
        </div>
      </div>
    );
  }

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      clerkJSUrl={CLERK_JS_URL}
      afterSignOutUrl="/"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
      signInForceRedirectUrl="/"
      signUpForceRedirectUrl="/"
    >
      <StandaloneTokenBridge>{children}</StandaloneTokenBridge>
    </ClerkProvider>
  );
}
