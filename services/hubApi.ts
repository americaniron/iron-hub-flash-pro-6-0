type TokenGetter = () => Promise<string | null>;

let tokenGetter: TokenGetter | null = null;

export function setHubApiTokenGetter(getter: TokenGetter | null): void {
  tokenGetter = getter;
}

function isSameOriginHubApi(input: RequestInfo | URL): boolean {
  if (typeof window === 'undefined') return false;

  try {
    const requestUrl = input instanceof Request
      ? new URL(input.url)
      : new URL(typeof input === 'string' ? input : input.toString(), window.location.origin);
    return requestUrl.origin === window.location.origin && requestUrl.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

export async function hubApiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);

  if (tokenGetter && isSameOriginHubApi(input) && !headers.has('Authorization')) {
    try {
      const token = await tokenGetter();
      if (token) headers.set('Authorization', `Bearer ${token}`);
    } catch {
      // The Worker remains the source of truth and returns a safe 401 if the
      // active Clerk session cannot provide a current token.
    }
  }

  return fetch(input, {
    ...init,
    headers,
    credentials: init.credentials ?? 'same-origin',
  });
}
