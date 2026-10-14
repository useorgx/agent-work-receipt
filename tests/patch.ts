/** RFC 6902 subset (add, replace, remove) used by the v0.3 conformance vectors. */
export interface PatchOperation {
  op: string;
  path: string;
  value?: unknown;
}

export function applyPatch<T>(document: T, patch: readonly PatchOperation[]): T {
  const result = JSON.parse(JSON.stringify(document)) as T;
  for (const { op, path, value } of patch) {
    const segments = path
      .slice(1)
      .split('/')
      .map((s) => s.replaceAll('~1', '/').replaceAll('~0', '~'));
    const leaf = segments.pop()!;
    const parent = segments.reduce((node: any, s) => {
      if (node === null || typeof node !== 'object' || !(s in node)) throw new Error(`Patch path does not resolve: ${path}`);
      return node[s];
    }, result as any);
    if (Array.isArray(parent)) {
      const index = leaf === '-' ? parent.length : Number(leaf);
      if (op === 'add') parent.splice(index, 0, value);
      else if (op === 'replace') {
        if (index >= parent.length) throw new Error(`Patch path does not resolve: ${path}`);
        parent[index] = value;
      } else if (op === 'remove') {
        if (index >= parent.length) throw new Error(`Patch path does not resolve: ${path}`);
        parent.splice(index, 1);
      } else throw new Error(`Unsupported patch op ${op}`);
    } else {
      if (op === 'add') parent[leaf] = value;
      else if (op === 'replace' || op === 'remove') {
        if (!(leaf in parent)) throw new Error(`Patch path does not resolve: ${path}`);
        if (op === 'replace') parent[leaf] = value;
        else delete parent[leaf];
      } else throw new Error(`Unsupported patch op ${op}`);
    }
  }
  return result;
}
