import { lookup } from 'node:dns/promises';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import type { LookupAddress } from 'node:dns';
import { ProviderError } from './provider-error.js';

const blocked = new BlockList();
for (const [ip, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(ip, prefix, 'ipv4');
export function publicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  // Accept global unicast IPv6 only; reject mapped IPv4, ULA, link-local, multicast and docs.
  return (
    family === 6 &&
    /^[23]/i.test(address) &&
    !address.toLowerCase().startsWith('2001:db8:')
  );
}
export function assertStoreUrl(url: URL, localTest = false) {
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(hostname);
  if (
    url.username ||
    url.password ||
    url.hash ||
    (localTest
      ? process.env.NODE_ENV === 'production' ||
        !loopback ||
        !['http:', 'https:'].includes(url.protocol)
      : url.protocol !== 'https:' ||
        (url.port !== '' && url.port !== '443') ||
        (isIP(hostname) !== 0 && !publicAddress(hostname)) ||
        loopback ||
        ['local', 'internal', 'lan', 'home', 'arpa'].some(
          (s) => hostname === s || hostname.endsWith('.' + s),
        ))
  ) {
    throw new ProviderError(
      'CONFIGURATION',
      'Store address is not allowed by the outbound network policy.',
    );
  }
}
export async function checkedAddresses(
  hostname: string,
  localTest = false,
  resolve: (host: string) => Promise<LookupAddress[]> = (host) =>
    lookup(host, { all: true, verbatim: true }),
) {
  const addresses = await resolve(hostname);
  if (
    !addresses.length ||
    addresses.some((row) =>
      localTest
        ? !['127.0.0.1', '::1'].includes(row.address)
        : !publicAddress(row.address),
    )
  ) {
    throw new ProviderError(
      'CONFIGURATION',
      'Store DNS resolution is blocked by the outbound network policy.',
    );
  }
  return addresses;
}
/** Resolve and validate inside socket lookup, then connect to those exact IPs. No DNS check/fetch race. */
export function safeStoreFetch(localTest = false): typeof globalThis.fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assertStoreUrl(url, localTest);
    const pinnedLookup: LookupFunction = (host, options, callback) => {
      void checkedAddresses(host, localTest).then(
        (addresses) => {
          if (options.all) callback(null, addresses);
          else callback(null, addresses[0]!.address, addresses[0]!.family);
        },
        () =>
          callback(new Error('Outbound DNS policy rejected address'), '', 4),
      );
    };
    return new Promise<Response>((resolve, reject) => {
      const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
        url,
        {
          method: 'GET',
          lookup: pinnedLookup,
          agent: false,
          ...(init?.signal ? { signal: init.signal } : {}),
          headers: { Accept: 'application/json' },
        },
        (response) => {
          if (
            (response.statusCode ?? 500) >= 300 &&
            (response.statusCode ?? 500) < 400
          ) {
            response.destroy();
            reject(
              new ProviderError('NETWORK', 'Store redirects are disabled.'),
            );
            return;
          }
          if (response.statusCode === 204 || response.statusCode === 205) {
            response.destroy();
            reject(
              new ProviderError(
                'INVALID_RESPONSE',
                'Store returned an empty response.',
              ),
            );
            return;
          }
          const headers = new Headers();
          for (const [key, value] of Object.entries(response.headers))
            if (value !== undefined)
              headers.set(key, Array.isArray(value) ? value.join(',') : value);
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              response.on('data', (chunk) => {
                controller.enqueue(new Uint8Array(chunk));
                response.pause();
              });
              response.on('end', () => controller.close());
              response.on('error', () =>
                controller.error(new Error('Upstream body interrupted')),
              );
              response.pause();
            },
            pull() {
              response.resume();
            },
            cancel() {
              response.destroy();
            },
          });
          resolve(
            new Response(stream, {
              status: response.statusCode ?? 500,
              headers,
            }),
          );
        },
      );
      request.on('error', () =>
        reject(new ProviderError('NETWORK', 'Store request failed.')),
      );
      request.end();
    });
  };
}
export async function boundedProviderJson(
  response: Response,
  signal: AbortSignal,
  maxBytes = 4 * 1024 * 1024,
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader)
    throw new ProviderError('INVALID_RESPONSE', 'Missing upstream body.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes)
        throw new ProviderError(
          'INVALID_RESPONSE',
          'Upstream response exceeds the size limit.',
        );
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally {
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
