// Enrollment terms (price override + discount) carried over on a transfer. Pure.
import type { ISODate } from "@/lib/dates";
import type { EnrollmentTerms } from "./types";

export type TermsEntry = EnrollmentTerms & { from: ISODate };

/**
 * Terms of the new enrollment after a transfer. The discount moves along WITH its history, so a
 * discount scheduled from a later date (or ending on one) keeps its dates in the new group. The
 * price override belonged to the old group: it is dropped from the current fields and from every
 * history entry.
 */
export function transferTerms(history: TermsEntry[], current: EnrollmentTerms): { current: EnrollmentTerms; history: TermsEntry[] } {
  return {
    current: { ...current, priceOverride: null },
    history: history.map((h) => ({ ...h, priceOverride: null })),
  };
}
