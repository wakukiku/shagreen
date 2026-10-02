export function normalizeMonogram(value) {
  return String(value)
    .toUpperCase()
    .replace(/[^А-ЯЁA-Z]/g, "")
    .slice(0, 3);
}
