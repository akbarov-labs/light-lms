"use server";

import { runAction, type ActionState } from "@/lib/action";
import { importStudents } from "./import-core";

/** Import students from CSV (HANDOFF §17). One transaction per row so a bad row never blocks the rest. */
export async function importStudentsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("students.edit", async (ctx) => {
    const file = fd.get("file");
    const text = file instanceof File && file.size > 0 ? await file.text() : String(fd.get("text") ?? "");
    const dry = fd.get("dryRun") === "on";
    const res = await importStudents(ctx, text, dry);
    return { message: res.message };
  });
}
