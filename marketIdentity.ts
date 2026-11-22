export type IdentityCheck = { passed: boolean; reason: string; expected: string; detected: string };

// Normalize harmless formatting differences, never infer a missing or conflicting symbol.
export function normalizeAsset(value: unknown): string {
  const raw = String(value ?? "").normalize("NFKC").toUpperCase().trim();
  const otc = /(?:^|[^A-Z])OTC(?:[^A-Z]|$)/.test(raw);
  const pair = raw.replace(/\(OTC\)|\bOTC\b/g, "").replace(/[^A-Z]/g, "");
  if (!/^[A-Z]{6}$/.test(pair)) return "";
  return pair + (otc ? " OTC" : "");
}
export function normalizeTimeframe(value: unknown): string {
  const raw = String(value ?? "").normalize("NFKC").trim().toUpperCase().replace(/\s+/g, "");
  if (/^(M1|1M|1MIN|1MINUTO|1MINUTE)$/.test(raw)) return "M1";
  if (/^(M5|5M|5MIN|5MINUTOS|5MINUTES)$/.test(raw)) return "M5";
  return "";
}
export function checkAsset(expected: unknown, detected: unknown): IdentityCheck {
  const a = normalizeAsset(expected), b = normalizeAsset(detected);
  if (!a || !b) return { passed: false, reason: "Nome do ativo não pôde ser lido com clareza na imagem.", expected: String(expected ?? ""), detected: String(detected ?? "") };
  return { passed: a === b, reason: a === b ? "Ativo confirmado." : "Ativo detectado diferente do selecionado.", expected: a, detected: b };
}
export function checkTimeframe(expected: unknown, detected: unknown): IdentityCheck {
  const a = normalizeTimeframe(expected), b = normalizeTimeframe(detected);
  if (!a || !b) return { passed: false, reason: "Período M1/M5 não pôde ser verificado na imagem.", expected: String(expected ?? ""), detected: String(detected ?? "") };
  return { passed: a === b, reason: a === b ? "Período confirmado." : "Período detectado diferente do selecionado.", expected: a, detected: b };
}
