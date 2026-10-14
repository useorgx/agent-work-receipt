import type { AgentWorkSignature } from './types.ts';

/**
 * An Ed25519 public key in any form the SDK can import:
 * - the raw 32 bytes;
 * - a string holding those bytes as canonical unpadded base64url (43 chars)
 *   or as 64 hex digits;
 * - a public JWK `{ kty: 'OKP', crv: 'Ed25519', x }` (other members are
 *   ignored, so a private JWK never imports its private part);
 * - a Web Crypto `CryptoKey` for Ed25519 with the `verify` usage.
 */
export type AgentWorkPublicKey =
  | Uint8Array
  | string
  | AgentWorkEd25519Jwk
  | CryptoKey;

export interface AgentWorkEd25519Jwk {
  kty: 'OKP';
  crv: 'Ed25519';
  x: string;
  kid?: string;
  [member: string]: unknown;
}

export interface AgentWorkPublicKeyResolverInput {
  key_id: string;
  signature: AgentWorkSignature;
}

/**
 * Consumer key-resolution policy. Return null or undefined when no key is
 * known for the signature; it is then reported `not_checked`, never `invalid`.
 * Resolving a key is not a trust decision: signer trust stays separate.
 */
export type AgentWorkPublicKeyResolver = (
  input: AgentWorkPublicKeyResolverInput
) =>
  | AgentWorkPublicKey
  | null
  | undefined
  | Promise<AgentWorkPublicKey | null | undefined>;

export interface AgentWorkJsonWebKeySet {
  keys: readonly unknown[];
}

export interface CreateAgentWorkKeyResolverOptions {
  /** Keys by key id: a map, or a JWKS whose Ed25519 entries carry `kid`. */
  keys?: Readonly<Record<string, AgentWorkPublicKey>> | AgentWorkJsonWebKeySet;
  /** Key tried for any key id the map does not name. */
  fallback?: AgentWorkPublicKey;
}

function subtleCrypto(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(
      'Ed25519 verification requires the Web Crypto API (available in modern browsers and Node.js 20+).'
    );
  }
  return subtle;
}

function base64urlToBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/u.test(value) || value.length % 4 === 1) return null;
  const standard = value.replaceAll('-', '+').replaceAll('_', '/');
  let binary: string;
  try {
    binary = atob(standard.padEnd(Math.ceil(standard.length / 4) * 4, '='));
  } catch {
    return null;
  }
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  // Reject non-canonical spellings (trailing bits set).
  const roundTrip = btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
  return roundTrip === value ? bytes : null;
}

function bytesToBase64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

function isCryptoKey(value: unknown): value is CryptoKey {
  return (
    typeof CryptoKey !== 'undefined' && value instanceof CryptoKey
  );
}

function isJwk(value: unknown): value is AgentWorkEd25519Jwk {
  return (
    !!value &&
    typeof value === 'object' &&
    !(value instanceof Uint8Array) &&
    (value as { kty?: unknown }).kty === 'OKP' &&
    (value as { crv?: unknown }).crv === 'Ed25519' &&
    typeof (value as { x?: unknown }).x === 'string'
  );
}

/** Decode a public key to its raw 32 bytes. Throws on anything else. */
export function decodeAgentWorkEd25519PublicKey(
  key: Exclude<AgentWorkPublicKey, CryptoKey>
): Uint8Array {
  let bytes: Uint8Array | null = null;
  if (key instanceof Uint8Array) bytes = key;
  else if (typeof key === 'string') {
    const trimmed = key.trim();
    bytes = /^[0-9a-fA-F]{64}$/u.test(trimmed)
      ? Uint8Array.from(trimmed.match(/../gu)!, (byte) =>
          Number.parseInt(byte, 16)
        )
      : base64urlToBytes(trimmed);
  } else if (isJwk(key)) bytes = base64urlToBytes(key.x);
  if (!bytes || bytes.length !== 32) {
    throw new TypeError(
      'An Ed25519 public key must be 32 bytes: raw, base64url, hex, or an OKP/Ed25519 JWK.'
    );
  }
  return bytes;
}

/** Import a public key for Web Crypto Ed25519 verification. */
export async function importAgentWorkEd25519PublicKey(
  key: AgentWorkPublicKey
): Promise<CryptoKey> {
  if (isCryptoKey(key)) {
    if (key.algorithm.name !== 'Ed25519' || key.type !== 'public') {
      throw new TypeError('CryptoKey must be an Ed25519 public key.');
    }
    return key;
  }
  const raw = decodeAgentWorkEd25519PublicKey(key);
  // Import through a public-only JWK: it works on every Web Crypto
  // implementation that supports Ed25519, including Node.js 20.
  return subtleCrypto().importKey(
    'jwk',
    { kty: 'OKP', crv: 'Ed25519', x: bytesToBase64url(raw) },
    { name: 'Ed25519' },
    false,
    ['verify']
  );
}

/**
 * Verify an Ed25519 signature over `message` with Web Crypto. Returns false
 * for a well-formed signature that does not verify; throws when the key cannot
 * be imported or the signature is not 64 bytes.
 */
export async function verifyAgentWorkEd25519Signature(
  key: AgentWorkPublicKey,
  message: Uint8Array,
  signature: Uint8Array
): Promise<boolean> {
  if (signature.length !== 64) {
    throw new TypeError('An Ed25519 signature must be 64 bytes.');
  }
  const publicKey = await importAgentWorkEd25519PublicKey(key);
  return subtleCrypto().verify(
    { name: 'Ed25519' },
    publicKey,
    signature as Uint8Array<ArrayBuffer>,
    message as Uint8Array<ArrayBuffer>
  );
}

/**
 * Build a key resolver from a key-id map or a JWKS, with an optional fallback
 * key. JWKS entries that are not OKP/Ed25519 or carry no `kid` are ignored;
 * a key id named twice in a JWKS resolves to no key, rather than guessing.
 */
export function createAgentWorkKeyResolver(
  options: CreateAgentWorkKeyResolverOptions
): AgentWorkPublicKeyResolver {
  const byId = new Map<string, AgentWorkPublicKey | null>();
  const { keys } = options;
  if (keys && Array.isArray((keys as AgentWorkJsonWebKeySet).keys)) {
    for (const entry of (keys as AgentWorkJsonWebKeySet).keys) {
      if (!isJwk(entry) || typeof entry.kid !== 'string') continue;
      byId.set(entry.kid, byId.has(entry.kid) ? null : entry);
    }
  } else if (keys) {
    for (const [id, key] of Object.entries(
      keys as Readonly<Record<string, AgentWorkPublicKey>>
    )) {
      byId.set(id, key);
    }
  }
  return ({ key_id }) =>
    byId.has(key_id) ? byId.get(key_id) : options.fallback;
}
