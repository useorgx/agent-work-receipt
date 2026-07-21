import type { AgentWorkReceipt } from './types.ts';
import {
  AGENT_WORK_RECEIPT_MAX_INPUT_DEPTH,
  parseAgentWorkReceipt,
} from './validator.ts';

function pointerSegment(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1');
}

export class AgentWorkReceiptDuplicateMemberError extends SyntaxError {
  readonly path: string;
  readonly member: string;

  constructor(path: string, member: string) {
    const memberPath = `${path}/${pointerSegment(member)}`;
    super(`Duplicate JSON object member at ${memberPath}.`);
    this.name = 'AgentWorkReceiptDuplicateMemberError';
    this.path = memberPath;
    this.member = member;
  }
}

/**
 * Scan raw JSON before JSON.parse discards duplicate object member names.
 * Escaped and unescaped spellings of the same decoded name are duplicates.
 */
export function assertAgentWorkReceiptJsonHasUniqueMembers(
  source: string
): void {
  let index = 0;

  const fail = (): never => {
    throw new SyntaxError(`Invalid JSON near character ${index}.`);
  };
  const skipWhitespace = () => {
    while (/\s/u.test(source[index] ?? '')) index += 1;
  };
  const parseString = (): string => {
    if (source[index] !== '"') fail();
    const start = index;
    index += 1;
    while (index < source.length) {
      const code = source.charCodeAt(index);
      if (code === 0x22) {
        index += 1;
        return JSON.parse(source.slice(start, index)) as string;
      }
      if (code < 0x20) fail();
      if (code === 0x5c) {
        index += 1;
        if (index >= source.length) fail();
        if (source[index] === 'u') {
          if (!/^[0-9a-fA-F]{4}$/u.test(source.slice(index + 1, index + 5))) {
            fail();
          }
          index += 5;
          continue;
        }
      }
      index += 1;
    }
    return fail();
  };

  const parseValue = (path: string, depth: number): void => {
    if (depth > AGENT_WORK_RECEIPT_MAX_INPUT_DEPTH) {
      throw new SyntaxError(
        `JSON nesting exceeds ${AGENT_WORK_RECEIPT_MAX_INPUT_DEPTH} levels.`
      );
    }
    skipWhitespace();
    const token = source[index];
    if (token === '"') {
      parseString();
      return;
    }
    if (token === '{') {
      index += 1;
      skipWhitespace();
      const members = new Set<string>();
      if (source[index] === '}') {
        index += 1;
        return;
      }
      while (index < source.length) {
        const member = parseString();
        if (members.has(member)) {
          throw new AgentWorkReceiptDuplicateMemberError(path, member);
        }
        members.add(member);
        skipWhitespace();
        if (source[index] !== ':') fail();
        index += 1;
        parseValue(`${path}/${pointerSegment(member)}`, depth + 1);
        skipWhitespace();
        if (source[index] === '}') {
          index += 1;
          return;
        }
        if (source[index] !== ',') fail();
        index += 1;
        skipWhitespace();
      }
      fail();
    }
    if (token === '[') {
      index += 1;
      skipWhitespace();
      if (source[index] === ']') {
        index += 1;
        return;
      }
      let item = 0;
      while (index < source.length) {
        parseValue(`${path}/${item}`, depth + 1);
        item += 1;
        skipWhitespace();
        if (source[index] === ']') {
          index += 1;
          return;
        }
        if (source[index] !== ',') fail();
        index += 1;
      }
      fail();
    }

    const primitive =
      /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u.exec(
        source.slice(index)
      )?.[0];
    if (primitive === undefined) return fail();
    index += primitive.length;
  };

  skipWhitespace();
  parseValue('', 0);
  skipWhitespace();
  if (index !== source.length) fail();
}

/** Parse a receipt directly from raw JSON without losing duplicate names. */
export function parseAgentWorkReceiptJson(source: string): AgentWorkReceipt {
  assertAgentWorkReceiptJsonHasUniqueMembers(source);
  return parseAgentWorkReceipt(JSON.parse(source) as unknown);
}
