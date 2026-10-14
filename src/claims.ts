import {
  AGENT_WORK_RECEIPT_CLAIM_LEVELS,
  type AgentWorkActor,
  type AgentWorkClaimLevel,
  type AgentWorkReceipt,
  type AgentWorkReceiptValidationIssue,
  type AgentWorkVerificationCheck,
} from './types.ts';

/**
 * v0.3 claim-level rules. Each level has its own supporting fields; claiming a
 * level requires the support of every level up to and including it.
 *
 * - executed: at least one action with status `completed`.
 * - observed: at least one `outcome.effects[]` entry with coverage `enforced`
 *   or `observed_only` that cites evidence.
 * - checked: `verification.status` is `passed` or `partial`, and at least one
 *   check is `passed`, cites evidence, has a verifier (its own
 *   `verifier.actor`, else `verification.verifier`), and — when the work is
 *   consequential — that verifier is not the receipt actor.
 * - accepted: `outcome.acceptance` is `accepted`, with `occurred_at`, by a
 *   `human` actor who is not the receipt actor.
 * - outcome_observed: at least one `outcome.metrics[]` entry with
 *   `observed_at` and evidence, or one `outcome.expected_results[]` entry with
 *   status `within` or `outside` and evidence.
 */

/** Work is consequential unless the producer sets `intent.consequential: false`. */
export function isAgentWorkConsequential(receipt: AgentWorkReceipt): boolean {
  return receipt.intent.consequential !== false;
}

/** Two actors are the same identity when both type and id are equal. */
export function isSameAgentWorkIdentity(
  left: Pick<AgentWorkActor, 'type' | 'id'>,
  right: Pick<AgentWorkActor, 'type' | 'id'>
): boolean {
  return left.type === right.type && left.id === right.id;
}

/** The check's own verifier identity, falling back to the receipt-level verifier. */
export function effectiveAgentWorkCheckVerifier(
  receipt: AgentWorkReceipt,
  check: AgentWorkVerificationCheck
): AgentWorkActor | undefined {
  return check.verifier?.actor ?? receipt.verification.verifier;
}

export function compareAgentWorkClaimLevels(
  left: AgentWorkClaimLevel,
  right: AgentWorkClaimLevel
): number {
  return (
    AGENT_WORK_RECEIPT_CLAIM_LEVELS.indexOf(left) -
    AGENT_WORK_RECEIPT_CLAIM_LEVELS.indexOf(right)
  );
}

function issue(
  path: string,
  code: string,
  message: string
): AgentWorkReceiptValidationIssue {
  return { path, code: `semantic.${code}`, message };
}

const UNSUPPORTED = 'claim_level_unsupported';

/** Issues that keep one level (on its own, not cumulatively) from being supported. */
function levelIssues(
  receipt: AgentWorkReceipt,
  level: AgentWorkClaimLevel
): AgentWorkReceiptValidationIssue[] {
  switch (level) {
    case 'asserted':
      return [];
    case 'executed':
      return receipt.actions.some(({ status }) => status === 'completed')
        ? []
        : [issue('/actions', UNSUPPORTED, 'Claim level executed requires at least one completed action.')];
    case 'observed':
      return (receipt.outcome.effects ?? []).some(
        (effect) => effect.coverage !== 'outside_coverage' && effect.evidence_ids.length > 0
      )
        ? []
        : [issue('/outcome/effects', UNSUPPORTED, 'Claim level observed requires an effect with enforced or observed_only coverage that cites evidence.')];
    case 'checked': {
      const found: AgentWorkReceiptValidationIssue[] = [];
      const { verification } = receipt;
      if (verification.status !== 'passed' && verification.status !== 'partial') {
        found.push(issue('/verification/status', UNSUPPORTED, 'Claim level checked requires verification status passed or partial.'));
      }
      const consequential = isAgentWorkConsequential(receipt);
      let selfVerifiedIndex = -1;
      const qualifies = verification.checks.some((check, index) => {
        if (check.status !== 'passed' || check.evidence_ids.length === 0) return false;
        const verifier = effectiveAgentWorkCheckVerifier(receipt, check);
        if (!verifier) return false;
        if (consequential && isSameAgentWorkIdentity(verifier, receipt.actor)) {
          if (selfVerifiedIndex < 0) selfVerifiedIndex = index;
          return false;
        }
        return true;
      });
      if (!qualifies) {
        if (selfVerifiedIndex >= 0) {
          const check = verification.checks[selfVerifiedIndex];
          found.push(
            issue(
              check.verifier ? `/verification/checks/${selfVerifiedIndex}/verifier/actor` : '/verification/verifier',
              'self_verification',
              'A check verified by the receipt actor cannot support claim level checked for consequential work.'
            )
          );
        } else {
          found.push(issue('/verification/checks', UNSUPPORTED, 'Claim level checked requires a passed check with evidence and a verifier.'));
        }
      }
      return found;
    }
    case 'accepted': {
      const acceptance = receipt.outcome.acceptance;
      if (!acceptance || acceptance.status !== 'accepted' || !acceptance.occurred_at || acceptance.actor?.type !== 'human') {
        return [issue('/outcome/acceptance', UNSUPPORTED, 'Claim level accepted requires an accepted outcome.acceptance with occurred_at by a human actor.')];
      }
      return isSameAgentWorkIdentity(acceptance.actor, receipt.actor)
        ? [issue('/outcome/acceptance/actor', 'self_acceptance', 'The receipt actor cannot accept its own work.')]
        : [];
    }
    case 'outcome_observed': {
      const metric = (receipt.outcome.metrics ?? []).some(
        (m) => m.observed_at !== undefined && (m.evidence_ids?.length ?? 0) > 0
      );
      const expected = (receipt.outcome.expected_results ?? []).some(
        (r) => (r.status === 'within' || r.status === 'outside') && r.evidence_ids.length > 0
      );
      return metric || expected
        ? []
        : [issue('/outcome/metrics', UNSUPPORTED, 'Claim level outcome_observed requires an observed outcome metric or expected result with evidence.')];
    }
  }
}

/**
 * Issues that keep `claimed` from being supported: the missing support of
 * every level up to and including it.
 */
export function agentWorkClaimLevelIssues(
  receipt: AgentWorkReceipt,
  claimed: AgentWorkClaimLevel
): AgentWorkReceiptValidationIssue[] {
  const last = AGENT_WORK_RECEIPT_CLAIM_LEVELS.indexOf(claimed);
  return AGENT_WORK_RECEIPT_CLAIM_LEVELS.slice(0, last + 1).flatMap((level) =>
    levelIssues(receipt, level)
  );
}

/**
 * The strongest level this receipt's fields support, whatever it claims.
 * Useful for producers choosing a claim and for hosts re-deriving one.
 */
export function highestSupportedAgentWorkClaimLevel(
  receipt: AgentWorkReceipt
): AgentWorkClaimLevel {
  let highest: AgentWorkClaimLevel = 'asserted';
  for (const level of AGENT_WORK_RECEIPT_CLAIM_LEVELS) {
    if (levelIssues(receipt, level).length > 0) break;
    highest = level;
  }
  return highest;
}
