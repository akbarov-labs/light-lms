// Demo center (HANDOFF §13). Deterministic: a seeded PRNG drives every random choice; dates are
// relative to "today" so the demo always looks current.
import type { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { DEFAULT_PERMS, PERMS } from "../src/lib/perms";

export async function seedDemo(db: PrismaClient) {
  console.log("[seed] creating demo center…");
  const hash = await bcrypt.hash("demo1234", 10);
  const center = await db.center.create({
    data: {
      name: "Demo O'quv Markazi",
      slug: "demo",
      phone: "998712000000",
      accentColor: "#2563eb",
      settings: {},
    },
  });
  const chilonzor = await db.branch.create({ data: { centerId: center.id, name: "Chilonzor", address: "Chilonzor 9-kvartal, 12-uy", phone: "998712000001" } });
  const yunusobod = await db.branch.create({ data: { centerId: center.id, name: "Yunusobod", address: "Yunusobod 4-mavze, 7-uy", phone: "998712000002" } });
  for (const b of [chilonzor, yunusobod]) {
    for (const n of ["101", "102", "103"]) await db.room.create({ data: { branchId: b.id, name: `${b.name.slice(0, 1)}-${n}`, capacity: 14 } });
  }
  const staff: { phone: string; name: string; role: "OWNER" | "MANAGER" | "ADMIN" | "TEACHER"; isTeacher?: boolean; perms?: string[]; branches: string[] }[] = [
    { phone: "998901234567", name: "Sardor Akbarov", role: "OWNER", branches: [] },
    { phone: "998901234568", name: "Dilnoza Rahimova", role: "MANAGER", branches: [chilonzor.id, yunusobod.id] },
    { phone: "998901234569", name: "Malika Tursunova", role: "ADMIN", branches: [chilonzor.id] },
    { phone: "998901234570", name: "Jasur Kamolov", role: "ADMIN", perms: ["payments.take"], branches: [yunusobod.id] },
    { phone: "998901234571", name: "Aziza Karimova", role: "TEACHER", branches: [chilonzor.id] },
    { phone: "998901234572", name: "Bobur Aliyev", role: "TEACHER", branches: [chilonzor.id, yunusobod.id] },
    { phone: "998901234573", name: "Nodira Saidova", role: "TEACHER", branches: [yunusobod.id] },
    { phone: "998901234574", name: "Otabek Yusupov", role: "ADMIN", isTeacher: true, branches: [yunusobod.id] },
  ];
  for (const s of staff) {
    await db.user.create({
      data: {
        centerId: center.id,
        phone: s.phone,
        name: s.name,
        passwordHash: hash,
        role: s.role,
        isTeacher: s.role === "TEACHER" || !!s.isTeacher,
        perms: s.role === "OWNER" ? [...PERMS] : (s.perms ?? DEFAULT_PERMS[s.role]),
        branches: { create: s.branches.map((branchId) => ({ branchId })) },
      },
    });
  }
  console.log("[seed] done");
}
