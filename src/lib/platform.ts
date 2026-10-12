// Platform (super) admins: staff whose phone is listed in PLATFORM_ADMIN_PHONES (comma-separated).
import { normalizePhone } from "./phone";

export function platformAdminPhones(env: string | undefined = process.env.PLATFORM_ADMIN_PHONES): Set<string> {
  return new Set(
    (env ?? "")
      .split(/[,;\n]+/)
      .map((p) => normalizePhone(p))
      .filter((p): p is string => !!p),
  );
}

export function isPlatformAdmin(phone: string | null | undefined, env?: string): boolean {
  const n = normalizePhone(phone);
  return !!n && platformAdminPhones(env).has(n);
}
