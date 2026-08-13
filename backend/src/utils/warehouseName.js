function normalizeWarehouseName(value) {
  if (typeof value !== "string") return value;

  return value
    .trim()
    .replace(/^ALMAC[EÉ]N\b[\s:.-]*/i, "")
    .trim();
}

module.exports = { normalizeWarehouseName };
