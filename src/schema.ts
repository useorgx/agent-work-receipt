import schemaJson from '../schema/agent-work-receipt.v0.1.schema.json' with {
  type: 'json',
};
import schemaJsonV02 from '../schema/agent-work-receipt.v0.2.schema.json' with {
  type: 'json',
};

import {
  AGENT_WORK_RECEIPT_SCHEMA_ID,
  AGENT_WORK_RECEIPT_SCHEMA_ID_V02,
  AGENT_WORK_RECEIPT_SCHEMA_VERSION,
  AGENT_WORK_RECEIPT_SCHEMA_VERSION_V02,
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

const v02 = schemaJsonV02 as Record<string, unknown>;
if (
  v02.$id !== AGENT_WORK_RECEIPT_SCHEMA_ID_V02 ||
  (v02.properties as Record<string, { const?: unknown }> | undefined)?.schema_version?.const !== AGENT_WORK_RECEIPT_SCHEMA_VERSION_V02
) {
  throw new Error('Agent Work Receipt v0.2 schema does not match the SDK.');
}

export const agentWorkReceiptSchema = schemaJson;
export const agentWorkReceiptSchemaV02 = schemaJsonV02;
