// System markers: events the model sees as short bracketed user text instead of raw data. The phone
// number itself never reaches the model; a staff message is shown with who wrote it, so the agent can
// continue the conversation without claiming the staff member's words as its own.
// Pure strings (no SDK import), so the admin UI can recognise them in a transcript.

export const MARK = {
  start: "[Mijoz botni markaz havolasi orqali ochdi]",
  phone: "[telefon raqam olindi]",
};

/** The person pressed "book a trial" under a group card. */
export const pickedGroupMarker = (groupName: string, groupId: string) => `[Mijoz «${groupName}» guruhi kartasidagi "Sinov darsiga yozilish" tugmasini bosdi. group_id: ${groupId}]`;

const STAFF = /^\[Markaz xodimi (.{1,120}?) mijozga Telegram orqali yozdi: «([\s\S]*)»\]$/;

/** A staff member wrote to the person through the bot (from the lead page). */
export const staffMarker = (staffName: string, text: string) => `[Markaz xodimi ${staffName.replace(/[\][«»]/g, "").slice(0, 120)} mijozga Telegram orqali yozdi: «${text.replace(/»/g, '"')}»]`;

export function parseStaffMarker(text: string): { staff: string; text: string } | null {
  const m = text.match(STAFF);
  return m ? { staff: m[1], text: m[2] } : null;
}

/** Any system marker (shown quietly in transcripts, never repeated to the person). */
export const isMarker = (text: string) => /^\[[\s\S]*\]$/.test(text.trim());
