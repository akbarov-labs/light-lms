import type { DictKey } from "./i18n";

/** Expected, user-facing failure. Server actions turn it into a translated form error. */
export class UserError extends Error {
  constructor(
    public key: DictKey,
    public vars?: Record<string, string | number>,
  ) {
    super(key);
    this.name = "UserError";
  }
}
