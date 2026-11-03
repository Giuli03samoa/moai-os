/**
 * Creates (or resets the password of) a user and attaches it to the organization.
 *   npm run admin:create -- --email ceo@moai.it --name "Giulio" --role OWNER --org moai-athletics
 * The password is read from ADMIN_PASSWORD (env) or generated and printed once.
 * MFA is always enrolled by the user at first login; this script never disables it.
 */
import { randomBytes } from "node:crypto";
import { PrismaClient, type Role } from "@prisma/client";
import { hashPassword, passwordPolicyError } from "../src/server/auth/password";

const db = new PrismaClient();
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => (a.startsWith("--") ? [a.slice(2), arr[i + 1] ?? ""] : [])).filter((x) => x.length));

async function main() {
  const email = String(args.email ?? "").toLowerCase();
  const name = String(args.name ?? "Admin");
  const role = (String(args.role ?? "ADMIN").toUpperCase() as Role) ?? "ADMIN";
  if (!email) throw new Error("--email obbligatorio");
  const org = args.org ? await db.organization.findUnique({ where: { slug: String(args.org) } }) : await db.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (!org) throw new Error("Nessuna organizzazione: completa prima /setup nell'app oppure passa --org <slug>");
  const password = process.env.ADMIN_PASSWORD ?? randomBytes(12).toString("base64url") + "Aa1";
  const err = passwordPolicyError(password);
  if (err) throw new Error(err);
  const user = await db.user.upsert({ where: { email }, create: { email, name, passwordHash: await hashPassword(password) }, update: { passwordHash: await hashPassword(password), lockedUntil: null, failedLoginCount: 0 } });
  await db.membership.upsert({ where: { userId_organizationId: { userId: user.id, organizationId: org.id } }, create: { userId: user.id, organizationId: org.id, role }, update: { role } });
  await db.auditLog.create({ data: { organizationId: org.id, userId: user.id, action: "user.create_cli", metadata: { role, by: process.env.USER ?? "cli" } } });
  console.log(`Utente ${email} (${role}) pronto su ${org.name}.`);
  if (!process.env.ADMIN_PASSWORD) console.log(`Password temporanea (mostrata una sola volta): ${password}`);
}

main()
  .catch((e) => { console.error(e.message); process.exit(1); })
  .finally(() => db.$disconnect());
