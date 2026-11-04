import type { IntegrationConnection, Prisma } from "@prisma/client";
import { db } from "../db";
import { audit } from "../audit";
import { decryptJson, encryptJson, redact } from "../crypto";
import type { ConnectorContext, ConnectorDefinition, VerifyResult } from "./types";
import { shopifyConnector } from "./shopify/connector";
import { arubaConnector } from "./aruba/connector";
import { packlinkConnector } from "./packlink/connector";
import { paymentConnectors } from "./payments/connectors";
import { telegramConnector } from "./telegram/connector";
import { metaConnector } from "./meta/connector";
import { ga4Connector } from "./ga4/connector";
import { klaviyoConnector } from "./klaviyo/connector";

const ALL: ConnectorDefinition[] = [shopifyConnector, arubaConnector, packlinkConnector, ...paymentConnectors, metaConnector, ga4Connector, klaviyoConnector, telegramConnector];

export function listConnectors(): ConnectorDefinition[] {
  return ALL;
}

export function getConnector(key: string): ConnectorDefinition {
  const c = ALL.find((d) => d.key === key);
  if (!c) throw new Error(`Connettore sconosciuto: ${key}`);
  return c;
}

export type LoadedConnection = {
  connection: IntegrationConnection;
  secrets: Record<string, string>;
  config: Record<string, unknown>;
};

export async function loadConnection(organizationId: string, key: string): Promise<LoadedConnection | null> {
  const connection = await db.integrationConnection.findUnique({ where: { organizationId_key: { organizationId, key } } });
  if (!connection) return null;
  return {
    connection,
    secrets: decryptJson<Record<string, string>>(connection.secretsEnc) ?? {},
    config: (connection.config as Record<string, unknown>) ?? {},
  };
}

export async function requireConnected(organizationId: string, key: string): Promise<LoadedConnection> {
  const loaded = await loadConnection(organizationId, key);
  if (!loaded) throw new Error(`${getConnector(key).displayName}: connessione non configurata`);
  if (loaded.connection.status !== "CONNECTED") {
    throw new Error(`${getConnector(key).displayName}: connessione in stato ${loaded.connection.status}${loaded.connection.blockedReason ? ` (${loaded.connection.blockedReason})` : ""}`);
  }
  return loaded;
}

export async function ensureConnection(organizationId: string, key: string) {
  const def = getConnector(key);
  return db.integrationConnection.upsert({
    where: { organizationId_key: { organizationId, key } },
    create: { organizationId, key, provider: def.provider, displayName: def.displayName },
    update: {},
  });
}

/** Saves settings. Empty secret values keep what is stored, so forms never echo secrets back. */
export async function saveConnectionSettings(args: {
  organizationId: string;
  key: string;
  userId: string;
  secrets: Record<string, string>;
  config: Record<string, unknown>;
}) {
  const def = getConnector(args.key);
  const existing = await loadConnection(args.organizationId, args.key);
  const secrets: Record<string, string> = {};
  // Drop cached tokens (keys starting with "_") whenever credentials are edited.
  for (const [k, v] of Object.entries(existing?.secrets ?? {})) if (!k.startsWith("_")) secrets[k] = v;
  const changedSecrets: string[] = [];
  for (const f of def.secretFields) {
    const v = args.secrets[f.name];
    if (v !== undefined && v !== "") {
      secrets[f.name] = v.trim();
      changedSecrets.push(f.name);
    }
  }
  const config = { ...(existing?.config ?? {}), ...args.config };
  const connection = await db.integrationConnection.upsert({
    where: { organizationId_key: { organizationId: args.organizationId, key: args.key } },
    create: {
      organizationId: args.organizationId,
      key: args.key,
      provider: def.provider,
      displayName: def.displayName,
      config: config as Prisma.InputJsonValue,
      secretsEnc: encryptJson(secrets),
      status: "PENDING_VERIFICATION",
      environment: String(config.environment ?? "production"),
    },
    update: { config: config as Prisma.InputJsonValue, secretsEnc: encryptJson(secrets), status: "PENDING_VERIFICATION", blockedReason: null, lastError: null, environment: String(config.environment ?? "production") },
  });
  await audit({
    organizationId: args.organizationId,
    userId: args.userId,
    action: "integration.update",
    entityType: "IntegrationConnection",
    entityId: connection.id,
    metadata: { key: args.key, configKeys: Object.keys(args.config), changedSecrets },
  });
  return connection;
}

export async function patchSecrets(connectionId: string, patch: Record<string, string | null>) {
  const c = await db.integrationConnection.findUniqueOrThrow({ where: { id: connectionId } });
  const secrets = decryptJson<Record<string, string>>(c.secretsEnc) ?? {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete secrets[k];
    else secrets[k] = v;
  }
  await db.integrationConnection.update({ where: { id: connectionId }, data: { secretsEnc: encryptJson(secrets) } });
}

export async function patchCursors(connectionId: string, patch: Record<string, unknown>) {
  const c = await db.integrationConnection.findUniqueOrThrow({ where: { id: connectionId } });
  const cursors = { ...((c.cursors as Record<string, unknown>) ?? {}), ...patch };
  await db.integrationConnection.update({ where: { id: connectionId }, data: { cursors: cursors as Prisma.InputJsonValue } });
  return cursors;
}

export async function markSynced(connectionId: string, error?: string | null) {
  await db.integrationConnection.update({
    where: { id: connectionId },
    data: error ? { lastError: redact(error) } : { lastSyncAt: new Date(), lastError: null },
  });
}

export async function verifyConnection(organizationId: string, key: string, userId?: string): Promise<VerifyResult> {
  const def = getConnector(key);
  await ensureConnection(organizationId, key);
  const loaded = (await loadConnection(organizationId, key))!;
  const lines: string[] = [];
  const ctx: ConnectorContext = { organizationId, ...loaded, log: (l) => lines.push(redact(l)) };
  let result: VerifyResult;
  try {
    result = await def.verify(ctx);
  } catch (e) {
    result = { status: "ERROR", message: redact((e as Error).message) };
  }
  await db.integrationConnection.update({
    where: { id: loaded.connection.id },
    data: {
      status: result.status,
      capabilities: result.capabilities ?? {},
      grantedScopes: result.grantedScopes ?? [],
      blockedReason: result.blockedReason ?? null,
      lastVerifiedAt: new Date(),
      lastError: result.status === "ERROR" ? result.message : null,
    },
  });
  await audit({ organizationId, userId, action: "integration.verify", entityType: "IntegrationConnection", entityId: loaded.connection.id, metadata: { key, status: result.status, log: lines.slice(0, 20) } });
  return result;
}

export function missingSecrets(def: ConnectorDefinition, secrets: Record<string, string>) {
  return def.secretFields.filter((f) => f.required && !secrets[f.name]).map((f) => f.label);
}
