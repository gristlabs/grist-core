/**
 * What the layoutSpec column holds. `collapsed` is only ever on the root of a page layout.
 */
export interface BoxSpec {
  leaf?: string | number;
  size?: number;
  children?: BoxSpec[];
  collapsed?: BoxSpec[];
}

const BOX_KEYS = ["leaf", "size", "children"];

/**
 * Checks that an untrusted layout has the right shape, and throws if it does not. This is a
 * type check only; whether a leaf belongs to the widget is up to the caller.
 *
 * The shapes, written as types:
 *
 *   Root = { children: Node[], collapsed?: Leaf[] }
 *   Node = Leaf | Box
 *   Leaf = { leaf: number, size?: number }
 *   Box  = { children: Node[], size?: number }
 *
 * So only the root takes `collapsed`, and only the root may hold an empty `children`.
 */
export function validateBoxSpec(value: unknown, isRoot = true): asserts value is BoxSpec {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `Every box must be an object like {"leaf": 1} or {"children": [...]}, ` +
      `got ${JSON.stringify(value)}`);
  }
  const node = value as Record<string, unknown>;
  const extra = Object.keys(node).filter(key => !BOX_KEYS.includes(key) && !(isRoot && key === "collapsed"));
  if (extra.length > 0) {
    throw new Error(`A box takes only ${BOX_KEYS.join(", ")}; got ${extra.join(", ")}`);
  }
  if (node.children !== undefined && !Array.isArray(node.children)) {
    throw new Error(`"children" must be an array of boxes, got ${JSON.stringify(node.children)}`);
  }
  const hasChildren = Boolean((node.children as unknown[] | undefined)?.length);
  const hasLeaf = node.leaf !== undefined && node.leaf !== null;
  if (hasChildren && hasLeaf) {
    throw new Error("A box has either leaf or children, not both");
  }
  if (!hasChildren && !hasLeaf && !(isRoot && Array.isArray(node.children))) {
    throw new Error("Every box needs either leaf or children");
  }
  if (node.size !== undefined) {
    requirePositiveSize(node.size);
  }
  if (hasLeaf && !Number.isInteger(node.leaf)) {
    throw new Error(`"leaf" must be an id (an integer), got ${JSON.stringify(node.leaf)}`);
  }
  if (isRoot) {
    validateCollapsed(node.collapsed);
  }
  (node.children as unknown[] ?? []).forEach(child => validateBoxSpec(child, false));
}

// Collapsed holds plain leaves, so a whole box there is a mistake rather than a nested layout.
function validateCollapsed(collapsed: unknown) {
  if (collapsed === undefined || collapsed === null) { return; }
  if (!Array.isArray(collapsed)) {
    throw new Error(`"collapsed" must be an array of {"leaf": <id>}, got ${JSON.stringify(collapsed)}`);
  }
  for (const box of collapsed) {
    if (!box || typeof box !== "object" || !Number.isInteger((box as Record<string, unknown>).leaf)) {
      throw new Error(`Each collapsed entry must be {"leaf": <id>}, got ${JSON.stringify(box)}`);
    }
  }
}

function requirePositiveSize(size: unknown): number {
  const n = Number(size);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`size must be a positive number, got ${JSON.stringify(size)}`);
  }
  return n;
}
