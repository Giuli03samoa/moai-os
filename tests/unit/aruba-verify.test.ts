import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/db", () => ({ db: { organization: { findUnique: async () => ({ vatNumber: "16566241002", countryCode: "IT" }) } } }));

import { arubaConnector } from "@/server/connectors/aruba/connector";

const ctx = { organizationId: "o", connection: {} as never, secrets: { username: "u", password: "p" }, config: { environment: "production" }, log: () => {} };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function stubSearch(search: () => Response) {
  vi.stubGlobal("fetch", async (url: string | URL) => (String(url).includes("/auth/signin") ? json({ access_token: "t", expires_in: 1800 }) : search()));
}

afterEach(() => vi.unstubAllGlobals());

describe("Aruba verify", () => {
  it("reports BLOCKED, not ERROR, on delegation error 0093", async () => {
    stubSearch(() => json({ errorCode: "0093", errorDescription: "Errore deleghe utente", content: [] }));
    const r = await arubaConnector.verify(ctx);
    expect(r.status).toBe("BLOCKED");
    expect(r.blockedReason).toContain("Premium");
  });
  it("reports BLOCKED on 403", async () => {
    stubSearch(() => json({}, 403));
    expect((await arubaConnector.verify(ctx)).status).toBe("BLOCKED");
  });
  it("reports CONNECTED with invoice totals when the search works", async () => {
    stubSearch(() => json({ errorCode: "0000", content: [], last: true, totalElements: 7, totalPages: 1, size: 1, number: 1 }));
    const r = await arubaConnector.verify(ctx);
    expect(r.status).toBe("CONNECTED");
    expect(r.message).toContain("7 documenti");
  });
  it("keeps ERROR for unrelated search failures", async () => {
    stubSearch(() => json({ errorCode: "0099", errorDescription: "Altro", content: [] }));
    expect((await arubaConnector.verify(ctx)).status).toBe("ERROR");
  });
});
