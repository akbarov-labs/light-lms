// Placement (pure): which topics a newcomer can pick, and which group to suggest from the result. The owner
// decides; nothing here enrolls anyone.
import { compareCodes } from "../questions/keys";

export interface GroupAt {
  id: string;
  /** the topic the group is at now (set by the owner); null = unknown, never suggested */
  topicCode: string | null;
}

/**
 * The group to suggest. Passed: the group at the reached topic or the closest one below it (it covered what
 * the person knows); when every group is further on, the earliest one. Not passed: one group earlier than that.
 * Null when no group has a current topic.
 */
export function suggestGroup(groups: readonly GroupAt[], reached: string, passed: boolean): string | null {
  const known = groups.filter((g): g is GroupAt & { topicCode: string } => !!g.topicCode).sort((a, b) => compareCodes(a.topicCode, b.topicCode) || a.id.localeCompare(b.id));
  if (known.length === 0) return null;
  // groups that share a topic: the first one (by id) stands for them, so the suggestion is stable
  const firstAt = (code: string) => known.find((g) => g.topicCode === code)!;
  const below = known.filter((g) => compareCodes(g.topicCode, reached) <= 0);
  if (below.length === 0) return known[0].id;
  const at = below[below.length - 1].topicCode;
  if (passed) return firstAt(at).id;
  // an earlier group: the closest topic before this one
  const earlier = known.filter((g) => compareCodes(g.topicCode, at) < 0);
  return earlier.length ? firstAt(earlier[earlier.length - 1].topicCode).id : known[0].id;
}

/**
 * Topics a person can say they reached: chapters and their sections (depth ≤ 2) in book order, from the first
 * one with approved questions in it (`approved` counts the topics under it too). A later topic with no
 * questions of its own still draws from the ones before it.
 */
export function reachableTopics<T extends { code: string; approved: number }>(topics: readonly T[], maxDepth = 2): T[] {
  const sorted = [...topics].sort((a, b) => compareCodes(a.code, b.code));
  const first = sorted.findIndex((t) => t.approved > 0);
  if (first === -1) return [];
  return sorted.slice(first).filter((t) => t.code.split(".").length <= maxDepth);
}
