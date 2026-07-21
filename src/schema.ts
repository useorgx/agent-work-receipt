import schemaJson from '../schema/agent-work-receipt.v0.1.schema.json' with {
  type: 'json',
};

import {
  AGENT_WORK_RECEIPT_SCHEMA_ID,
  AGENT_WORK_RECEIPT_SCHEMA_VERSION,
} from './types.ts';

const schema = schemaJson as Record<string, unknown>;

if (schema.$id !== AGENT_WORK_RECEIPT_SCHEMA_ID) {
  throw new Error('Agent Work Receipt schema id does not match the SDK.');
}

const schemaVersion = (
  schema.properties as Record<string, { const?: unknown }> | undefined
)?.schema_version?.const;

if (schemaVersion !== AGENT_WORK_RECEIPT_SCHEMA_VERSION) {
  throw new Error('Agent Work Receipt schema version does not match the SDK.');
}

export const agentWorkReceiptSchema = schemaJson;
