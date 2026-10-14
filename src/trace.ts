import { canonicalizeAgentWorkJson } from './integrity.ts';
import type { AgentWorkTraceCommitment } from './types.ts';

export const AGENT_WORK_TRACE_COMMITMENT_CONSTRUCTION =
  'awr-trace-merkle/v1' as const;

/*
 * awr-trace-merkle/v1 (docs/v0.3.md):
 *   leaf_i  = SHA-256(0x00 || UTF-8(RFC 8785 canonical JSON of span_i))
 *   leaves are sorted ascending by byte value (duplicates kept), so the root
 *   does not depend on the order spans were exported in;
 *   root    = RFC 6962 Merkle tree hash over the sorted leaves:
 *             MTH([])    = SHA-256("")
 *             MTH([h])   = h
 *             MTH(h[n])  = SHA-256(0x01 || MTH(h[0:k]) || MTH(h[k:n])),
 *                          k = largest power of two < n.
 * The root is lowercase hex.
 */

async function sha256Bytes(bytes: Uint8Array): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error(
      'SHA-256 requires the Web Crypto API (available in modern browsers and Node.js 20+).'
    );
  }
  return new Uint8Array(
    await subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)
  );
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  for (let i = 0; i < Math.min(left.length, right.length); i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i];
  }
  return left.length - right.length;
}

const LEAF_PREFIX = Uint8Array.of(0);
const NODE_PREFIX = Uint8Array.of(1);

async function merkleTreeHash(leaves: readonly Uint8Array[]): Promise<Uint8Array> {
  if (leaves.length === 0) return sha256Bytes(new Uint8Array());
  if (leaves.length === 1) return leaves[0];
  let k = 1;
  while (k * 2 < leaves.length) k *= 2;
  const [left, right] = await Promise.all([
    merkleTreeHash(leaves.slice(0, k)),
    merkleTreeHash(leaves.slice(k)),
  ]);
  return sha256Bytes(concat(NODE_PREFIX, left, right));
}

/** Compute the awr-trace-merkle/v1 root (lowercase hex) over JSON span records. */
export async function computeAgentWorkTraceCommitmentRoot(
  spans: readonly unknown[]
): Promise<string> {
  const encoder = new TextEncoder();
  const leaves = await Promise.all(
    spans.map((span) =>
      sha256Bytes(concat(LEAF_PREFIX, encoder.encode(canonicalizeAgentWorkJson(span))))
    )
  );
  leaves.sort(compareBytes);
  const root = await merkleTreeHash(leaves);
  return Array.from(root, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Build a trace commitment for the given spans. Spans are hashed, never embedded. */
export async function createAgentWorkTraceCommitment(
  traceId: string,
  spans: readonly unknown[],
  extra: Pick<AgentWorkTraceCommitment, 'trace_ref' | 'committed_at'> = {}
): Promise<AgentWorkTraceCommitment> {
  return {
    trace_id: traceId,
    algorithm: 'sha256',
    construction: AGENT_WORK_TRACE_COMMITMENT_CONSTRUCTION,
    root: await computeAgentWorkTraceCommitmentRoot(spans),
    leaf_count: spans.length,
    ...extra,
  };
}

/** True when `spans` reproduce the commitment's root (and leaf_count, if declared). */
export async function verifyAgentWorkTraceCommitment(
  commitment: AgentWorkTraceCommitment,
  spans: readonly unknown[]
): Promise<boolean> {
  if (commitment.algorithm !== 'sha256') return false;
  if (
    commitment.construction !== undefined &&
    commitment.construction !== AGENT_WORK_TRACE_COMMITMENT_CONSTRUCTION
  ) {
    return false;
  }
  if (commitment.leaf_count !== undefined && commitment.leaf_count !== spans.length) {
    return false;
  }
  return (await computeAgentWorkTraceCommitmentRoot(spans)) === commitment.root;
}
