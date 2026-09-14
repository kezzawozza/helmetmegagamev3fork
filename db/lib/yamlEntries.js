function entriesOf(node, keyField) {
  if (!node) return [];
  if (Array.isArray(node)) return node;
  return Object.entries(node).map(([key, value]) => ({ [keyField]: key, ...(value ?? {}) }));
}

module.exports = { entriesOf };
