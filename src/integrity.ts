import type {
  AgentWorkContentDigest,
  AgentWorkDigest,
  AgentWorkReceipt,
  AgentWorkSignature,
  JsonValue,
} from './types.ts';
import { hasUnpairedUtf16Surrogate } from './unicode.ts';

export const AGENT_WORK_RECEIPT_INTEGRITY_REPORT_VERSION =
  'agent-work-receipt-integrity-report/v0.1' as const;
export const AGENT_WORK_RECEIPT_SIGNATURE_PROFILE =
  'agent-work-receipt-signature/v0.1' as const;
export const AGENT_WORK_RECEIPT_SIGNATURE_ALGORITHM = 'ed25519' as const;
export const AGENT_WORK_RECEIPT_SIGNATURE_ENCODING = 'base64url' as const;

export type AgentWorkContentHashState =
  | 'not_present'
  | 'verified'
  | 'mismatch'
  | 'unsupported'
  | 'malformed';

export type AgentWorkCryptographicState =
  | 'not_checked'
  | 'verified'
  | 'invalid'
  | 'unsupported'
  | 'malformed'
  | 'error';

export type AgentWorkTrustState =
  | 'not_evaluated'
  | 'trusted'
  | 'untrusted'
  | 'unknown'
  | 'error';

export interface AgentWorkContentHashReport {
  state: AgentWorkContentHashState;
  computed: AgentWorkContentDigest;
  declared?: AgentWorkDigest;
}

export interface AgentWorkSignatureIntegrityReport {
  index: number;
  profile: typeof AGENT_WORK_RECEIPT_SIGNATURE_PROFILE;
  algorithm: string;
  encoding: string;
  key_id?: string;
  cryptographic_state: AgentWorkCryptographicState;
  trust_state: AgentWorkTrustState;
}

/**
 * JSON-only result. Content equality, cryptographic proof, and signer trust are
 * deliberately independent claims and are never collapsed into one boolean.
 */
export interface AgentWorkReceiptIntegrityReport {
  report_version: typeof AGENT_WORK_RECEIPT_INTEGRITY_REPORT_VERSION;
  canonicalization: 'RFC 8785';
  hash_scope: 'receipt_without_integrity';
  content_hash: AgentWorkContentHashReport;
  signatures: readonly AgentWorkSignatureIntegrityReport[];
}

export interface AgentWorkSignatureVerificationInput {
  signature: AgentWorkSignature;
  declared_content_hash: AgentWorkDigest;
  computed_content_hash: AgentWorkContentDigest;
  canonical_content: string;
  signature_payload_canonical_json: string;
  signature_payload: Uint8Array;
  signature_bytes: Uint8Array;
}

export interface AgentWorkSignerTrustInput {
  signature: AgentWorkSignature;
}

export interface VerifyAgentWorkReceiptIntegrityOptions {
  verify_signature?: (
    input: AgentWorkSignatureVerificationInput
  ) => AgentWorkCryptographicState | Promise<AgentWorkCryptographicState>;
  evaluate_signer_trust?: (
    input: AgentWorkSignerTrustInput
  ) => AgentWorkTrustState | Promise<AgentWorkTrustState>;
}

export interface WithAgentWorkReceiptContentHashOptions {
  /** Preserve only when every existing signature is known to cover this content. */
  preserve_signatures?: boolean;
}

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const SHA256_ALGORITHMS = new Set(['sha-256', 'sha256']);
function serializeCanonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) {
      throw new TypeError('RFC 8785 input did not produce canonical JSON.');
    }
    return serialized;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => serializeCanonicalJson(item)).join(',')}]`;
  }
  const object = value as { readonly [key: string]: JsonValue };
  return `{${Object.keys(object)
    .sort()
    .map(
      (key) => `${JSON.stringify(key)}:${serializeCanonicalJson(object[key]!)}`
    )
    .join(',')}}`;
}

function snapshotCanonicalJsonInput(value: unknown): JsonValue {
  const active = new WeakSet<object>();

  function visit(current: unknown, path: string): JsonValue {
    if (current === null || typeof current === 'boolean') return current;
    if (typeof current === 'string') {
      if (hasUnpairedUtf16Surrogate(current)) {
        throw new TypeError(
          `RFC 8785 input contains an unpaired UTF-16 surrogate at ${path}.`
        );
      }
      return current;
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) {
        throw new TypeError(
          `RFC 8785 input contains a non-finite number at ${path}.`
        );
      }
      return current;
    }
    if (!current || typeof current !== 'object') {
      throw new TypeError(
        `RFC 8785 input contains a non-JSON value at ${path}.`
      );
    }
    if (active.has(current)) {
      throw new TypeError(`RFC 8785 input contains a cycle at ${path}.`);
    }
    active.add(current);

    let snapshot: JsonValue;
    if (Array.isArray(current)) {
      for (const key of Object.keys(current)) {
        if (!/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= current.length) {
          throw new TypeError(
            `RFC 8785 input contains a non-JSON array property at ${path}/${key}.`
          );
        }
      }
      const result: JsonValue[] = [];
      for (let index = 0; index < current.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(current, index);
        if (!descriptor) {
          throw new TypeError(
            `RFC 8785 input contains a sparse array entry at ${path}/${index}.`
          );
        }
        if (!('value' in descriptor)) {
          throw new TypeError(
            `RFC 8785 input contains an accessor at ${path}/${index}.`
          );
        }
        result.push(visit(descriptor.value, `${path}/${index}`));
      }
      snapshot = result;
    } else {
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(
          `RFC 8785 input contains a non-JSON object at ${path}.`
        );
      }
      const result = Object.create(null) as Record<string, JsonValue>;
      for (const key of Object.keys(current)) {
        if (hasUnpairedUtf16Surrogate(key)) {
          throw new TypeError(
            `RFC 8785 input contains an invalid object key at ${path}.`
          );
        }
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor || !('value' in descriptor)) {
          throw new TypeError(
            `RFC 8785 input contains an accessor at ${path}/${key}.`
          );
        }
        Object.defineProperty(result, key, {
          value: visit(
            descriptor.value,
            `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`
          ),
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      snapshot = result;
    }
    active.delete(current);
    return snapshot;
  }

  return visit(value, '');
}

/** Canonicalize an interoperable JSON value according to RFC 8785 (JCS). */
export function canonicalizeAgentWorkJson(value: unknown): string {
  const snapshot = snapshotCanonicalJsonInput(value);
  return serializeCanonicalJson(snapshot);
}

/** Canonical receipt content excludes only the entire root integrity member. */
export function canonicalizeAgentWorkReceiptContent(
  receipt: AgentWorkReceipt
): string {
  const content = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(receipt)) {
    if (key === 'integrity') continue;
    const descriptor = Object.getOwnPropertyDescriptor(receipt, key);
    if (!descriptor) continue;
    Object.defineProperty(content, key, descriptor);
  }
  return canonicalizeAgentWorkJson(content);
}

function encodeBase64(bytes: Uint8Array): string {
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const combined = (first << 16) | (second << 8) | third;
    output += BASE64_ALPHABET[(combined >>> 18) & 63];
    output += BASE64_ALPHABET[(combined >>> 12) & 63];
    output +=
      index + 1 < bytes.length ? BASE64_ALPHABET[(combined >>> 6) & 63] : '=';
    output += index + 2 < bytes.length ? BASE64_ALPHABET[combined & 63] : '=';
  }
  return output;
}

function encodeBytes(
  bytes: Uint8Array,
  encoding: NonNullable<AgentWorkDigest['encoding']>
): string {
  if (encoding === 'hex') {
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
      ''
    );
  }
  const base64 = encodeBase64(bytes);
  if (encoding === 'base64') return base64;
  if (encoding === 'base64url') {
    return base64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
  }
  throw new TypeError('Digest encoding must be hex, base64, or base64url.');
}

function decodeBase64Canonical(
  value: string,
  encoding: 'base64' | 'base64url',
  expectedBytes: number
): Uint8Array | null {
  if (encoding === 'base64url' && !/^[A-Za-z0-9_-]+$/u.test(value)) {
    return null;
  }
  if (
    encoding === 'base64' &&
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      value
    )
  ) {
    return null;
  }
  const standard =
    encoding === 'base64url'
      ? value.replaceAll('-', '+').replaceAll('_', '/')
      : value;
  const padded = standard.padEnd(Math.ceil(standard.length / 4) * 4, '=');
  if (padded.length % 4 !== 0) return null;

  const output: number[] = [];
  for (let index = 0; index < padded.length; index += 4) {
    const first = BASE64_ALPHABET.indexOf(padded[index]);
    const second = BASE64_ALPHABET.indexOf(padded[index + 1]);
    const third =
      padded[index + 2] === '='
        ? 0
        : BASE64_ALPHABET.indexOf(padded[index + 2]);
    const fourth =
      padded[index + 3] === '='
        ? 0
        : BASE64_ALPHABET.indexOf(padded[index + 3]);
    if (first < 0 || second < 0 || third < 0 || fourth < 0) return null;
    const combined = (first << 18) | (second << 12) | (third << 6) | fourth;
    output.push((combined >>> 16) & 0xff);
    if (padded[index + 2] !== '=') output.push((combined >>> 8) & 0xff);
    if (padded[index + 3] !== '=') output.push(combined & 0xff);
  }
  const bytes = new Uint8Array(output);
  if (bytes.length !== expectedBytes) return null;
  return encodeBytes(bytes, encoding) === value ? bytes : null;
}

function isDigestEncoding(
  value: unknown
): value is NonNullable<AgentWorkDigest['encoding']> {
  return value === 'hex' || value === 'base64' || value === 'base64url';
}

function isSupportedSha256(digest: AgentWorkDigest): boolean {
  return SHA256_ALGORITHMS.has(digest.algorithm);
}

function decodeSha256Digest(digest: AgentWorkDigest): Uint8Array | null {
  if (!isSupportedSha256(digest)) return null;
  const encoding = digest.encoding ?? 'hex';
  if (!isDigestEncoding(encoding)) return null;
  if (encoding === 'hex') {
    if (!/^[0-9a-fA-F]{64}$/u.test(digest.value)) return null;
    return new Uint8Array(
      digest.value.match(/../gu)!.map((byte) => Number.parseInt(byte, 16))
    );
  }
  return decodeBase64Canonical(digest.value, encoding, 32);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

async function sha256(value: string): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(
      'SHA-256 requires the Web Crypto API (available in modern browsers and Node.js 20+).'
    );
  }
  const digest = await subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  );
  return new Uint8Array(digest);
}

function contentDigest(
  bytes: Uint8Array,
  encoding: NonNullable<AgentWorkDigest['encoding']>
): AgentWorkContentDigest {
  return {
    algorithm: 'sha-256',
    value: encodeBytes(bytes, encoding),
    encoding,
  };
}

/** Compute the portable content digest defined by Agent Work Receipt v0.1. */
export async function hashAgentWorkReceiptContent(
  receipt: AgentWorkReceipt,
  encoding: NonNullable<AgentWorkDigest['encoding']> = 'hex'
): Promise<AgentWorkContentDigest> {
  const canonical = canonicalizeAgentWorkReceiptContent(receipt);
  return contentDigest(await sha256(canonical), encoding);
}

/**
 * Return a copy carrying a deterministic content hash. Existing signatures are
 * removed unless the caller explicitly attests that they still cover it.
 */
export async function withAgentWorkReceiptContentHash(
  receipt: AgentWorkReceipt,
  encoding: NonNullable<AgentWorkDigest['encoding']> = 'hex',
  options: WithAgentWorkReceiptContentHashOptions = {}
): Promise<AgentWorkReceipt> {
  const canonicalContent = canonicalizeAgentWorkReceiptContent(receipt);
  const contentSnapshot = JSON.parse(canonicalContent) as Omit<
    AgentWorkReceipt,
    'integrity'
  >;
  const signatures =
    options.preserve_signatures && receipt.integrity?.signatures
      ? (JSON.parse(
          canonicalizeAgentWorkJson(receipt.integrity.signatures)
        ) as readonly AgentWorkSignature[])
      : undefined;
  const hash = contentDigest(await sha256(canonicalContent), encoding);
  return {
    ...contentSnapshot,
    integrity: {
      content_hash: hash,
      ...(signatures ? { signatures } : {}),
    },
  };
}

/** Decode the canonical 64-byte Ed25519 signature carried by v0.1. */
export function decodeAgentWorkReceiptSignature(
  signature: AgentWorkSignature
): Uint8Array | null {
  if (
    signature.algorithm !== AGENT_WORK_RECEIPT_SIGNATURE_ALGORITHM ||
    signature.encoding !== AGENT_WORK_RECEIPT_SIGNATURE_ENCODING
  ) {
    return null;
  }
  return decodeBase64Canonical(signature.value, 'base64url', 64);
}

/**
 * Build the exact signed message. The protected header binds algorithm, key id,
 * signer, and signing time; the digest is normalized to lowercase hex.
 */
export function canonicalizeAgentWorkReceiptSignaturePayload(
  signature: AgentWorkSignature,
  declaredContentHash: AgentWorkDigest
): string {
  const digestBytes = decodeSha256Digest(declaredContentHash);
  if (!digestBytes) {
    throw new TypeError(
      'Agent Work Receipt signature payload requires a canonical SHA-256 digest.'
    );
  }
  if (
    signature.algorithm !== AGENT_WORK_RECEIPT_SIGNATURE_ALGORITHM ||
    signature.encoding !== AGENT_WORK_RECEIPT_SIGNATURE_ENCODING
  ) {
    throw new TypeError(
      'Agent Work Receipt v0.1 signatures require ed25519 with base64url encoding.'
    );
  }
  return canonicalizeAgentWorkJson({
    content_hash: {
      algorithm: 'sha-256',
      value: encodeBytes(digestBytes, 'hex'),
    },
    profile: AGENT_WORK_RECEIPT_SIGNATURE_PROFILE,
    protected: {
      algorithm: signature.algorithm,
      encoding: signature.encoding,
      key_id: signature.key_id,
      ...(signature.signer ? { signer: signature.signer } : {}),
      ...(signature.signed_at ? { signed_at: signature.signed_at } : {}),
    },
  });
}

const CRYPTOGRAPHIC_CALLBACK_STATES = new Set<AgentWorkCryptographicState>([
  'verified',
  'invalid',
  'unsupported',
  'malformed',
]);
const TRUST_CALLBACK_STATES = new Set<AgentWorkTrustState>([
  'trusted',
  'untrusted',
  'unknown',
]);

/** Verify content, cryptographic proof, and signer trust as separate claims. */
export async function verifyAgentWorkReceiptIntegrity(
  receipt: AgentWorkReceipt,
  options: VerifyAgentWorkReceiptIntegrityOptions = {}
): Promise<AgentWorkReceiptIntegrityReport> {
  const canonicalContent = canonicalizeAgentWorkReceiptContent(receipt);
  const integrity = receipt.integrity
    ? (JSON.parse(
        canonicalizeAgentWorkJson(receipt.integrity)
      ) as AgentWorkReceipt['integrity'])
    : undefined;
  const computedBytes = await sha256(canonicalContent);
  const declared = integrity?.content_hash;
  const declaredEncoding = isDigestEncoding(declared?.encoding)
    ? declared.encoding
    : 'hex';
  const computed = contentDigest(computedBytes, declaredEncoding);
  const declaredBytes = declared ? decodeSha256Digest(declared) : null;

  let contentState: AgentWorkContentHashState;
  if (!declared) contentState = 'not_present';
  else if (!isSupportedSha256(declared)) contentState = 'unsupported';
  else if (!declaredBytes) contentState = 'malformed';
  else
    contentState = bytesEqual(declaredBytes, computedBytes)
      ? 'verified'
      : 'mismatch';

  const signatures = await Promise.all(
    (integrity?.signatures ?? []).map(async (signature, index) => {
      let cryptographicState: AgentWorkCryptographicState = 'not_checked';
      const supportedProfile =
        signature.algorithm === AGENT_WORK_RECEIPT_SIGNATURE_ALGORITHM &&
        signature.encoding === AGENT_WORK_RECEIPT_SIGNATURE_ENCODING;
      const signatureBytes = supportedProfile
        ? decodeAgentWorkReceiptSignature(signature)
        : null;

      if (!supportedProfile) {
        cryptographicState = 'unsupported';
      } else if (!signatureBytes || !declared || !declaredBytes) {
        cryptographicState = 'malformed';
      } else if (options.verify_signature) {
        try {
          const signaturePayloadCanonicalJson =
            canonicalizeAgentWorkReceiptSignaturePayload(signature, declared);
          const candidate = await options.verify_signature({
            signature,
            declared_content_hash: declared,
            computed_content_hash: computed,
            canonical_content: canonicalContent,
            signature_payload_canonical_json: signaturePayloadCanonicalJson,
            signature_payload: new TextEncoder().encode(
              signaturePayloadCanonicalJson
            ),
            signature_bytes: signatureBytes,
          });
          cryptographicState = CRYPTOGRAPHIC_CALLBACK_STATES.has(candidate)
            ? candidate
            : 'error';
        } catch {
          cryptographicState = 'error';
        }
      }

      let trustState: AgentWorkTrustState = 'not_evaluated';
      if (options.evaluate_signer_trust) {
        try {
          const candidate = await options.evaluate_signer_trust({ signature });
          trustState = TRUST_CALLBACK_STATES.has(candidate)
            ? candidate
            : 'error';
        } catch {
          trustState = 'error';
        }
      }

      return {
        index,
        profile: AGENT_WORK_RECEIPT_SIGNATURE_PROFILE,
        algorithm: signature.algorithm,
        encoding: signature.encoding,
        ...(signature.key_id ? { key_id: signature.key_id } : {}),
        cryptographic_state: cryptographicState,
        trust_state: trustState,
      } satisfies AgentWorkSignatureIntegrityReport;
    })
  );

  return {
    report_version: AGENT_WORK_RECEIPT_INTEGRITY_REPORT_VERSION,
    canonicalization: 'RFC 8785',
    hash_scope: 'receipt_without_integrity',
    content_hash: {
      state: contentState,
      computed,
      ...(declared ? { declared } : {}),
    },
    signatures,
  };
}
