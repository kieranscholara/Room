import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import {
  InventoryError,
  inventoryEndpoint,
  MAX_SNAPSHOT_BYTES,
  parseInventorySnapshot,
  type InventorySnapshot,
} from './index';

function encryptionKey(encoded: string | undefined): Buffer {
  if (!encoded || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw new InventoryError('credentials_unavailable');
  const key = Buffer.from(encoded, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encoded)
    throw new InventoryError('credentials_unavailable');
  return key;
}
export function encryptionConfigured(encoded: string | undefined) {
  try {
    encryptionKey(encoded);
    return true;
  } catch {
    return false;
  }
}
export function encryptInventoryToken(token: string, encodedKey: string | undefined, organisationId: string) {
  if (
    !token ||
    token.length > 4096 ||
    Array.from(token).some((character) => [0, 10, 13].includes(character.charCodeAt(0)))
  )
    throw new InventoryError('credentials_unavailable');
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(encodedKey), nonce);
  cipher.setAAD(Buffer.from(`roomsell:inventory:v1:${organisationId}`));
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return `v1.${nonce.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}
export function decryptInventoryToken(
  envelope: string,
  encodedKey: string | undefined,
  organisationId: string,
) {
  try {
    const [version, nonce, tag, ciphertext, extra] = envelope.split('.');
    if (version !== 'v1' || extra || !nonce || !tag || !ciphertext) throw new Error('Invalid envelope');
    const nonceBytes = Buffer.from(nonce, 'base64url');
    const tagBytes = Buffer.from(tag, 'base64url');
    if (nonceBytes.length !== 12 || tagBytes.length !== 16) throw new Error('Invalid envelope');
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(encodedKey), nonceBytes);
    decipher.setAAD(Buffer.from(`roomsell:inventory:v1:${organisationId}`));
    decipher.setAuthTag(tagBytes);
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString(
      'utf8',
    );
  } catch {
    throw new InventoryError('credentials_unavailable');
  }
}

/** Conservative address policy; IPv6 transition mechanisms cannot tunnel private IPv4. */
export function isPublicInventoryAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (version !== 6 || !/^[23][0-9a-f]{3}:/i.test(address)) return false;
  const [first, secondText = '0'] = address.split(':');
  const firstWord = Number.parseInt(first, 16);
  const secondWord = Number.parseInt(secondText || '0', 16);
  return (
    !(firstWord === 0x2001 && (secondWord < 0x200 || secondWord === 0xdb8)) &&
    firstWord !== 0x2002 &&
    firstWord !== 0x3fff
  );
}
export async function resolveInventoryEndpoint(
  endpoint: string,
  options: { lookup?: typeof lookup; timeoutMs?: number } = {},
) {
  const url = inventoryEndpoint(endpoint);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: { address: string; family: number }[];
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      addresses = isIP(hostname)
        ? [{ address: hostname, family: isIP(hostname) }]
        : await Promise.race([
            (options.lookup ?? lookup)(hostname, { all: true, verbatim: true }),
            new Promise<never>((_resolve, reject) => {
              timer = setTimeout(
                () => reject(new InventoryError('provider_unavailable')),
                options.timeoutMs ?? 5000,
              );
            }),
          ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch {
    throw new InventoryError('provider_unavailable');
  }
  if (!addresses.length || addresses.some((item) => !isPublicInventoryAddress(item.address)))
    throw new InventoryError('endpoint_rejected');
  return { url, address: addresses[0] };
}

export type InventoryTransport = (endpoint: string, token: string) => Promise<Uint8Array>;
export async function secureProviderRequest(
  endpoint: string,
  token: string,
  body?: Uint8Array,
): Promise<Uint8Array> {
  const startedAt = Date.now();
  const { url, address } = await resolveInventoryEndpoint(endpoint);
  return new Promise<Uint8Array>((resolve, reject) => {
    const fail = (error: InventoryError) => {
      reject(error);
    };
    const request = httpsRequest(
      url,
      {
        method: body ? 'POST' : 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json', 'Content-Length': body.byteLength } : {}),
        },
        // The TCP connection uses the already-checked address. TLS still verifies
        // the endpoint hostname, closing the validation-to-connect DNS race.
        lookup: (_hostname, options, callback) => {
          if (typeof options === 'object' && options.all) callback(null, [address]);
          else callback(null, address.address, address.family);
        },
      },
      (response) => {
        if (
          response.statusCode !== 200 ||
          !/^application\/json(?:\s*;|$)/i.test(response.headers['content-type'] ?? '')
        ) {
          response.destroy();
          request.destroy();
          fail(new InventoryError('provider_unavailable'));
          return;
        }
        if (Number(response.headers['content-length'] ?? 0) > MAX_SNAPSHOT_BYTES) {
          response.destroy();
          request.destroy();
          fail(new InventoryError('invalid_snapshot'));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.byteLength;
          if (size > MAX_SNAPSHOT_BYTES) {
            response.destroy();
            request.destroy();
            fail(new InventoryError('invalid_snapshot'));
          } else chunks.push(chunk);
        });
        response.on('end', () => resolve(Buffer.concat(chunks)));
        response.on('error', () => fail(new InventoryError('provider_unavailable')));
      },
    );
    const timer = setTimeout(
      () => {
        request.destroy();
        fail(new InventoryError('provider_unavailable'));
      },
      Math.max(1, 15_000 - (Date.now() - startedAt)),
    );
    request.on('close', () => clearTimeout(timer));
    request.on('error', () => fail(new InventoryError('provider_unavailable')));
    request.end(body);
  });
}
export const secureInventoryTransport: InventoryTransport = (endpoint, token) =>
  secureProviderRequest(endpoint, token);
export async function fetchInventorySnapshot(
  endpoint: string,
  token: string,
  options: { transport?: InventoryTransport; now?: number; lastGeneratedAt?: string | null } = {},
): Promise<InventorySnapshot> {
  inventoryEndpoint(endpoint);
  const bytes = await (options.transport ?? secureInventoryTransport)(endpoint, token);
  if (bytes.byteLength > MAX_SNAPSHOT_BYTES) throw new InventoryError('invalid_snapshot');
  let input: unknown;
  try {
    input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new InventoryError('invalid_snapshot');
  }
  return parseInventorySnapshot(input, options);
}
