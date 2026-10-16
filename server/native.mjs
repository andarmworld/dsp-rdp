import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import { z } from 'zod';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { Credentials } from './credentials.mjs';
import { Registry } from './registry.mjs';
import { Guacamole } from './guacamole.mjs';
import { Manager } from './manager.mjs';
import { createRpcHandler } from './rpc.mjs';
import { fetchRoute, RPC_ENDPOINTS } from './fetch.mjs';

export const domainSpec = defineDomain({ name: 'rdp_plugin', version: 1, tables: {
  machines: domainTable(z.object({ id: z.string(), owner: z.string(), name: z.string(), username: z.string(), address: z.string(), host: z.string(), port: z.number().int(), gatewayId: z.string(), owned: z.boolean(), encryptedPassword: z.string().nullable(), lastConnectedAt: z.string().nullable(), createdAt: z.string() })),
  history: domainTable(z.object({ id: z.string(), owner: z.string(), machineId: z.string(), machineName: z.string(), address: z.string(), username: z.string(), event: z.enum(['attempt', 'connected', 'disconnected', 'failed']), occurredAt: z.string(), ordinal: z.number().int(), detail: z.string().optional() })),
  suppressed: domainTable(z.object({ owner: z.string(), gatewayId: z.string() })),
  sessions: domainTable(z.object({ owner: z.string(), sessionId: z.string(), machineId: z.string(), gatewayId: z.string() })),
} });
export async function applyNative(context, config) {
  const owner = config.gatewayUser ?? 'dshadmin', adminUser = config.adminUser ?? 'guacadmin';
  if (!owner.trim() || !adminUser.trim() || /[\x00-\x1f\x7f]/u.test(owner + adminUser)) throw new Error('Invalid gateway user configuration');
  const baseUrl = config.guacamoleUrl ?? 'http://127.0.0.1:18081/guacamole', parsed = new URL(baseUrl);
  if (!['127.0.0.1', '[::1]', 'localhost'].includes(parsed.hostname)) throw new Error('Guacamole header authentication requires a trusted loopback URL');
  const home = process.env.DSH_HOME?.trim() ? resolve(process.env.DSH_HOME) : join(homedir(), '.dsh');
  const credentials = new Credentials(config.keyFile || join(home, 'secrets', 'rdp.key'));
  let domain;
  try { domain = await context.storageDomain.open(domainSpec); }
  catch (error) { credentials.close(); throw error; }
  const manager = new Manager(new Registry(domain, credentials), new Guacamole({ baseUrl, adminUser }));
  const handler = createRpcHandler(manager, owner);
  let closing = false;
  const admittedHandler = (...args) => closing
    ? Promise.resolve({ ok: false, error: { code: 'rdp/closing', message: '远程桌面插件正在停止，请稍后重试', details: { status: 503 } } })
    : handler(...args);
  const unregister = RPC_ENDPOINTS.map(endpoint => context.connection.fetch.register(fetchRoute(endpoint, admittedHandler)));
  context.effect(() => async () => {
    closing = true;
    try { await Promise.all(unregister.map(dispose => dispose())); }
    finally {
      await manager.pending;
      try { await domain.close(); } finally { credentials.close(); }
    }
  });
}
