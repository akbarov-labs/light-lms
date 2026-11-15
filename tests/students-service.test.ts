// createStudentWithFamily (src/lib/services/students.ts): the admin form and the AI agent share it.
// Pins the behaviour moved out of the admin action. Run: npm run test:integration
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createStudentWithFamily } from "@/lib/services/students";

let centerId = "";
let branchId = "";

beforeAll(async () => {
  const c = await db.center.create({ data: { name: "Student service markazi", slug: "student-service-test" } });
  centerId = c.id;
  branchId = (await db.branch.create({ data: { centerId, name: "Markaz" } })).id;
});

const staff = () => ({ userId: null, centerId, actor: "USER" as const });

describe("createStudentWithFamily", () => {
  it("creates a family whose primary guardian is the student when no guardian phone is given", async () => {
    const id = await db.$transaction((tx) => createStudentWithFamily(tx, staff(), { firstName: "Sarvar", lastName: "Aliyev", phone: "998901110001", branchId }));
    const s = await db.student.findUniqueOrThrow({ where: { id }, include: { family: { include: { guardians: true } } } });
    expect(s.family.name).toBe("Aliyevlar oilasi");
    expect(s.family.guardians).toEqual([expect.objectContaining({ phone: "998901110001", relation: "self", isPrimary: true, name: "Sarvar Aliyev" })]);
    const log = await db.auditLog.findFirstOrThrow({ where: { entity: "Student", entityId: id } });
    expect(log.actor).toBe("USER");
  });

  it("joins a sibling's family by guardian phone only when canJoinFamily allows it", async () => {
    const first = await db.$transaction((tx) =>
      createStudentWithFamily(tx, staff(), { firstName: "Ali", lastName: "Karimov", branchId, guardianPhone: "998901110002", guardianName: "Dilshod", relation: "father" }),
    );
    const firstFamily = (await db.student.findUniqueOrThrow({ where: { id: first } })).familyId;

    const allowed = await db.$transaction((tx) =>
      createStudentWithFamily(tx, staff(), { firstName: "Laylo", lastName: "Karimova", branchId, guardianPhone: "998901110002" }, { canJoinFamily: async () => true }),
    );
    expect((await db.student.findUniqueOrThrow({ where: { id: allowed } })).familyId).toBe(firstFamily);

    const refused = await db.$transaction((tx) =>
      createStudentWithFamily(tx, staff(), { firstName: "Bobur", lastName: "Karimov", branchId, guardianPhone: "998901110002" }, { canJoinFamily: async () => false }),
    );
    expect((await db.student.findUniqueOrThrow({ where: { id: refused } })).familyId).not.toBe(firstFamily);

    const noCallback = await db.$transaction((tx) => createStudentWithFamily(tx, staff(), { firstName: "Olim", lastName: "Karimov", branchId, guardianPhone: "998901110002" }));
    expect((await db.student.findUniqueOrThrow({ where: { id: noCallback } })).familyId).not.toBe(firstFamily);
  });

  it("converts a lead: links the student, moves the stage, writes a note and audit with the actor", async () => {
    const lead = await db.lead.create({ data: { centerId, name: "Nodira", phone: "998901110003" } });
    const id = await db.$transaction((tx) =>
      createStudentWithFamily(tx, { userId: null, centerId, actor: "AGENT" }, { firstName: "Nodira", lastName: "Saidova", branchId, phone: "998901110003", leadId: lead.id, leadStage: "TRIAL_BOOKED" }),
    );
    const after = await db.lead.findUniqueOrThrow({ where: { id: lead.id }, include: { notes: true } });
    expect(after).toMatchObject({ studentId: id, stage: "TRIAL_BOOKED" });
    expect(after.notes).toEqual([expect.objectContaining({ text: "→ Saidova Nodira", actor: "AGENT", createdById: null })]);
    const logs = await db.auditLog.findMany({ where: { OR: [{ entityId: id }, { entityId: lead.id }] } });
    expect(logs.map((l) => l.actor)).toEqual(["AGENT", "AGENT"]);
  });

  it("keeps the lead's stage when no stage is given and ignores a lead of another center", async () => {
    const other = await db.center.create({ data: { name: "Boshqa markaz", slug: "student-service-other" } });
    const foreign = await db.lead.create({ data: { centerId: other.id, name: "Begona", phone: "998901110004" } });
    const own = await db.lead.create({ data: { centerId, name: "O'zimiz", phone: "998901110005", stage: "CONTACTED" } });
    await db.$transaction((tx) => createStudentWithFamily(tx, staff(), { firstName: "A", lastName: "B", branchId, leadId: own.id }));
    await db.$transaction((tx) => createStudentWithFamily(tx, staff(), { firstName: "C", lastName: "D", branchId, leadId: foreign.id }));
    expect((await db.lead.findUniqueOrThrow({ where: { id: own.id } })).stage).toBe("CONTACTED");
    expect((await db.lead.findUniqueOrThrow({ where: { id: foreign.id } })).studentId).toBeNull();
  });
});
