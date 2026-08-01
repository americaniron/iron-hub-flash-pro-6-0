const EMBEDDED_HUB_PATH = '/hub-proxy';

export function resolveHubApiInput(input: RequestInfo | URL): RequestInfo | URL {
  if (
    typeof input === 'string' &&
    input.startsWith('/api/') &&
    typeof window !== 'undefined' &&
    window.location.pathname.startsWith(EMBEDDED_HUB_PATH)
  ) {
    return `${EMBEDDED_HUB_PATH}${input}`;
  }
  return input;
}

export async function hubApiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(resolveHubApiInput(input), {
    ...init,
    credentials: init.credentials ?? 'same-origin',
  });
}
