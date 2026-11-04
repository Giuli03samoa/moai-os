/**
 * Elimina i dati demo (righe isDemo) dell'organizzazione, da riga di comando.
 *   npm run db:demo-delete
 * Stessa logica del pulsante in Impostazioni; i dati reali non vengono toccati.
 */
import { db } from "../src/server/db";
import { deleteDemoData } from "../src/server/demo";

async function main() {
  const org = await db.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (!org) throw new Error("Nessuna organizzazione");
  const counts = await deleteDemoData(org.id);
  await db.auditLog.create({ data: { organizationId: org.id, action: "demo.delete", metadata: { ...counts, by: "cli" } } });
  console.log(`Dati demo eliminati da ${org.name}:`, counts);
}

main()
  .catch((e) => { console.error(e.message); process.exit(1); })
  .finally(() => db.$disconnect());
