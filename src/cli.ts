/**
 * awr-verify: offline Agent Work Receipt verifier.
 *
 *   awr-verify <receipt.json | -> [--key <public-key>] [--keys <jwks.json>] [--json] [--strict]
 *
 * Exit codes (the first that applies):
 *   64  usage error, or a key that cannot be read
 *    1  the receipt cannot be read, is not JSON, has duplicate members, or fails validation
 *    2  integrity failure: content hash mismatch, malformed or unsupported, or any
 *       signature invalid, malformed, unsupported, or errored
 *    3  --strict only: no content hash, a signature that could not be checked, or
 *       no verified signature at all
 *    0  otherwise
 *   70  internal error
 *
 * Signer trust is not evaluated: a verified signature proves the key signed the
 * receipt, not that the key belongs to anyone you trust.
 */
import { createPublicKey } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  verifyAgentWorkReceiptIntegrity,
  type AgentWorkReceiptIntegrityReport,
} from './integrity.ts';
import { assertAgentWorkReceiptJsonHasUniqueMembers } from './rawJson.ts';
import { highestSupportedAgentWorkClaimLevel } from './claims.ts';
import {
  createAgentWorkKeyResolver,
  decodeAgentWorkEd25519PublicKey,
  type AgentWorkEd25519Jwk,
  type AgentWorkJsonWebKeySet,
  type AgentWorkPublicKey,
} from './signature.ts';
import type {
  AgentWorkReceipt,
  AgentWorkReceiptValidationIssue,
} from './types.ts';
import { validateAgentWorkReceipt } from './validator.ts';

export const AWR_VERIFY_EXIT = {
  ok: 0,
  invalid: 1,
  integrity_failure: 2,
  strict_unmet: 3,
  usage: 64,
  internal: 70,
} as const;

export interface AwrVerifyIo {
  readFile(path: string): string;
  readStdin(): string;
  stdout(text: string): void;
  stderr(text: string): void;
}

export interface AwrVerifyResult {
  file: string;
  validation:
    | { ok: true; schema_version: string; claim_level?: string; highest_supported_claim_level: string }
    | { ok: false; issue_count: number; issues: readonly AgentWorkReceiptValidationIssue[] };
  integrity?: AgentWorkReceiptIntegrityReport;
  unresolved_key_ids?: readonly string[];
  error?: string;
  exit_code: number;
}

const USAGE = `Usage: awr-verify <receipt.json | -> [--key <public-key>] [--keys <jwks.json>] [--json] [--strict]

  --key <k>     Ed25519 public key used for every signature: base64url or hex
                raw 32 bytes, or a file holding that, a JWK, or an SPKI PEM.
  --keys <f>    JWKS file; signatures are matched to keys by key_id (kid).
  --json        Print a JSON result instead of text.
  --strict      Also fail (exit 3) without a content hash, or unless every
                signature was checked and at least one verified.

Exit codes: 0 ok, 1 invalid receipt, 2 integrity failure, 3 strict requirement
unmet, 64 usage error, 70 internal error.`;

class UsageError extends Error {}

function parseArgs(argv: readonly string[]) {
  const options: { file?: string; key?: string; keys?: string; json: boolean; strict: boolean; help: boolean } = {
    json: false,
    strict: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (next === undefined) throw new UsageError(`${arg} needs a value.`);
      i += 1;
      return next;
    };
    if (arg === '--key') options.key = value();
    else if (arg === '--keys') options.keys = value();
    else if (arg === '--json') options.json = true;
    else if (arg === '--strict') options.strict = true;
    else if (arg === '-h' || arg === '--help') options.help = true;
    else if (arg.startsWith('-') && arg !== '-') throw new UsageError(`Unknown option ${arg}.`);
    else if (options.file === undefined) options.file = arg;
    else throw new UsageError('Only one receipt file can be verified at a time.');
  }
  if (!options.help && options.file === undefined) throw new UsageError('A receipt file is required.');
  if (options.key !== undefined && options.keys !== undefined) throw new UsageError('Use --key or --keys, not both.');
  return options;
}

/** Read --key: an inline raw key, or a file holding a raw key, a JWK, or an SPKI PEM. */
function readPublicKey(spec: string, io: AwrVerifyIo): AgentWorkPublicKey {
  const inline = (text: string): AgentWorkPublicKey | null => {
    try {
      decodeAgentWorkEd25519PublicKey(text);
      return text.trim();
    } catch {
      return null;
    }
  };
  const direct = inline(spec);
  if (direct) return direct;
  let text: string;
  try {
    text = io.readFile(spec);
  } catch {
    throw new UsageError(`--key is neither a 32-byte base64url/hex key nor a readable file: ${spec}`);
  }
  const fromFile = inline(text);
  if (fromFile) return fromFile;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object') {
      decodeAgentWorkEd25519PublicKey(parsed as AgentWorkEd25519Jwk);
      return parsed as AgentWorkEd25519Jwk;
    }
  } catch {
    // not a JWK; try PEM
  }
  try {
    const jwk = createPublicKey(text).export({ format: 'jwk' });
    if (jwk.kty === 'OKP' && jwk.crv === 'Ed25519' && typeof jwk.x === 'string') {
      return { kty: 'OKP', crv: 'Ed25519', x: jwk.x };
    }
  } catch {
    // fall through
  }
  throw new UsageError(`--key file does not hold an Ed25519 public key: ${spec}`);
}

function readJwks(path: string, io: AwrVerifyIo): AgentWorkJsonWebKeySet {
  let parsed: unknown;
  try {
    parsed = JSON.parse(io.readFile(path));
  } catch {
    throw new UsageError(`--keys is not a readable JSON file: ${path}`);
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { keys?: unknown }).keys)) {
    throw new UsageError(`--keys must be a JWKS with a "keys" array: ${path}`);
  }
  return parsed as AgentWorkJsonWebKeySet;
}

const INTEGRITY_FAILURE_CONTENT = new Set(['mismatch', 'malformed', 'unsupported']);
const INTEGRITY_FAILURE_SIGNATURE = new Set(['invalid', 'malformed', 'unsupported', 'error']);

function formatText(result: AwrVerifyResult): string {
  const lines = [`receipt: ${result.file}`];
  if (result.error) lines.push(`error: ${result.error}`);
  const v = result.validation;
  if (v.ok) {
    lines.push(`validation: ok (${v.schema_version})`);
    lines.push(
      `claim level: ${v.claim_level ?? '(none claimed)'}; highest supported: ${v.highest_supported_claim_level}`
    );
  } else if (!result.error || v.issue_count > 0) {
    lines.push(`validation: FAILED (${v.issue_count} issue${v.issue_count === 1 ? '' : 's'})`);
    for (const i of v.issues) lines.push(`  ${i.path || '/'} [${i.code}] ${i.message}`);
  }
  if (result.integrity) {
    const c = result.integrity.content_hash;
    lines.push(`content hash: ${c.state} (computed sha-256 ${c.computed.encoding} ${c.computed.value})`);
    if (result.integrity.signatures.length === 0) lines.push('signatures: none');
    for (const s of result.integrity.signatures) {
      const unresolved = s.key_id && result.unresolved_key_ids?.includes(s.key_id) ? ' (no key for this key_id)' : '';
      lines.push(`signature ${s.index} [${s.key_id ?? '?'}]: ${s.cryptographic_state}${unresolved}`);
    }
    lines.push('signer trust: not evaluated');
  }
  lines.push(`exit: ${result.exit_code}`);
  return `${lines.join('\n')}\n`;
}

/** Run the verifier; returns the exit code. Exposed for tests and embedding. */
export async function runAwrVerify(argv: readonly string[], io: AwrVerifyIo): Promise<number> {
  let options: ReturnType<typeof parseArgs>;
  let resolverKey: AgentWorkPublicKey | undefined;
  let jwks: AgentWorkJsonWebKeySet | undefined;
  try {
    options = parseArgs(argv);
    if (options.help) {
      io.stdout(`${USAGE}\n`);
      return AWR_VERIFY_EXIT.ok;
    }
    if (options.key !== undefined) resolverKey = readPublicKey(options.key, io);
    if (options.keys !== undefined) jwks = readJwks(options.keys, io);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    io.stderr(`awr-verify: ${error.message}\n\n${USAGE}\n`);
    return AWR_VERIFY_EXIT.usage;
  }

  const file = options.file!;
  const emit = (result: AwrVerifyResult) => {
    io.stdout(options.json ? `${JSON.stringify(result, null, 2)}\n` : formatText(result));
    return result.exit_code;
  };
  const unreadable = (error: string): number =>
    emit({ file, validation: { ok: false, issue_count: 0, issues: [] }, error, exit_code: AWR_VERIFY_EXIT.invalid });

  let raw: string;
  try {
    raw = file === '-' ? io.readStdin() : io.readFile(file);
  } catch (error) {
    return unreadable(`cannot read receipt: ${(error as Error).message}`);
  }
  let value: unknown;
  try {
    assertAgentWorkReceiptJsonHasUniqueMembers(raw);
    value = JSON.parse(raw);
  } catch (error) {
    return unreadable((error as Error).message);
  }

  const validation = validateAgentWorkReceipt(value);
  const result: AwrVerifyResult = {
    file,
    validation: validation.ok
      ? {
          ok: true,
          schema_version: validation.receipt.schema_version,
          ...(validation.receipt.outcome.claim_level ? { claim_level: validation.receipt.outcome.claim_level } : {}),
          highest_supported_claim_level: highestSupportedAgentWorkClaimLevel(validation.receipt),
        }
      : { ok: false, issue_count: validation.issue_count, issues: validation.issues },
    exit_code: AWR_VERIFY_EXIT.ok,
  };

  // Integrity is still reported for an invalid receipt when it can be computed.
  const unresolved = new Set<string>();
  const keyed = resolverKey !== undefined || jwks !== undefined;
  const resolve = keyed
    ? createAgentWorkKeyResolver({ ...(jwks ? { keys: jwks } : {}), ...(resolverKey !== undefined ? { fallback: resolverKey } : {}) })
    : undefined;
  if (value && typeof value === 'object' && !Array.isArray(value)) try {
    result.integrity = await verifyAgentWorkReceiptIntegrity(value as AgentWorkReceipt, {
      resolve_public_key: async (input) => {
        const key = resolve ? await resolve(input) : undefined;
        if (key === undefined || key === null) unresolved.add(input.key_id);
        return key;
      },
    });
  } catch (error) {
    if (validation.ok) {
      result.error = `integrity could not be computed: ${(error as Error).message}`;
      result.exit_code = AWR_VERIFY_EXIT.integrity_failure;
    }
  }
  if (unresolved.size > 0) result.unresolved_key_ids = [...unresolved].sort();

  const integrity = result.integrity;
  const integrityFailed =
    !!integrity &&
    (INTEGRITY_FAILURE_CONTENT.has(integrity.content_hash.state) ||
      integrity.signatures.some((s) => INTEGRITY_FAILURE_SIGNATURE.has(s.cryptographic_state)));
  const strictUnmet =
    options.strict &&
    (!integrity ||
      integrity.content_hash.state !== 'verified' ||
      integrity.signatures.length === 0 ||
      integrity.signatures.some((s) => s.cryptographic_state !== 'verified'));

  if (!validation.ok) result.exit_code = AWR_VERIFY_EXIT.invalid;
  else if (integrityFailed || result.exit_code === AWR_VERIFY_EXIT.integrity_failure) result.exit_code = AWR_VERIFY_EXIT.integrity_failure;
  else if (strictUnmet) result.exit_code = AWR_VERIFY_EXIT.strict_unmet;
  return emit(result);
}

/** The Node.js process binding used by the `awr-verify` bin. */
export const nodeAwrVerifyIo: AwrVerifyIo = {
  readFile: (path) => readFileSync(path, 'utf8'),
  readStdin: () => readFileSync(0, 'utf8'),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};
