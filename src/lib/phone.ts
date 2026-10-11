// Uzbek phone numbers are stored as "998XXXXXXXXX" (12 digits).

export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let digits = String(input).replace(/\D/g, "");
  if (digits.startsWith("00998")) digits = digits.slice(2);
  if (digits.length === 9) digits = `998${digits}`;
  if (digits.length === 10 && digits.startsWith("8")) digits = `998${digits.slice(1)}`;
  if (digits.length !== 12 || !digits.startsWith("998")) return null;
  return digits;
}

/** "+998 90 123 45 67" */
export function formatPhone(p: string | null | undefined): string {
  if (!p) return "—";
  const n = normalizePhone(p);
  if (!n) return p;
  return `+998 ${n.slice(3, 5)} ${n.slice(5, 8)} ${n.slice(8, 10)} ${n.slice(10, 12)}`;
}
