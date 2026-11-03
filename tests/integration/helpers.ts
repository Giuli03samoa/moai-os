import { randomUUID } from "node:crypto";
import { db } from "@/server/db";

export async function makeOrg(vat = "01234567890") {
  const slug = `test-${randomUUID().slice(0, 8)}`;
  return db.organization.create({ data: { name: `Test ${slug}`, slug, vatNumber: vat } });
}

export async function makeUser(orgId: string) {
  const u = await db.user.create({ data: { email: `${randomUUID().slice(0, 8)}@test.local`, name: "Tester", passwordHash: "x" } });
  await db.membership.create({ data: { userId: u.id, organizationId: orgId, role: "OWNER" } });
  return u;
}
