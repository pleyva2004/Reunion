import { createClient, type ButterbaseClient } from '@butterbase/sdk';

/**
 * Build a Butterbase client patched to strip the SDK's `/v1/<appId>/` path prefix.
 *
 * The SDK constructs paths like `/v1/{appId}/schema` and `/v1/{appId}/{table}`. The
 * Butterbase server this app talks to identifies the app from the bearer token instead
 * and **prepends** its own `/v1/<appId>/` to every incoming path — so leaving the SDK's
 * prefix in place produces a doubled path (`/v1/<id>/v1/<id>/schema`) which 404s.
 *
 * We strip the SDK's prefix before the request leaves the process so the resulting URL
 * matches what the server actually serves.
 */
export function createPatchedClient(opts: {
  appId: string;
  apiUrl: string;
  apiKey: string;
}): ButterbaseClient {
  const bb = createClient({
    appId: opts.appId,
    apiUrl: opts.apiUrl,
    anonKey: opts.apiKey,
    persistSession: false,
  });

  const prefix = `/v1/${opts.appId}`;
  const stripPath = (path: string) =>
    path.startsWith(prefix) ? path.slice(prefix.length) || '/' : path;

  type RequestFn = (method: string, path: string, body?: unknown, headers?: unknown) => unknown;
  const patch = (name: 'request' | 'requestRaw' | 'requestBlob' | 'requestStream') => {
    const inst = bb as unknown as Record<string, RequestFn>;
    const original = inst[name].bind(bb);
    inst[name] = (method, path, body, headers) => original(method, stripPath(path), body, headers);
  };

  patch('request');
  patch('requestRaw');
  patch('requestBlob');
  patch('requestStream');

  return bb;
}
