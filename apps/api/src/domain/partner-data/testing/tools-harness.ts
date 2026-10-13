import type { IdentityClaims, IdentityRole } from '@sharptalk/types';
import { AiGatewayService } from '../../../infrastructure/external/ai/ai-gateway.service';
import { AnthropicAdapter } from '../../../infrastructure/external/ai/adapters/anthropic.adapter';
import { OpenAiAdapter } from '../../../infrastructure/external/ai/adapters/openai.adapter';
import { StubAdapter } from '../../../infrastructure/external/ai/adapters/stub.adapter';
import type { StubToolScript } from '../../../infrastructure/external/ai/adapters/stub.adapter';
import { FakeAnthropicServer } from '../../../infrastructure/external/ai/testing/fake-anthropic.server';
import { ToolLoopService } from '../../ai-engine/tool-loop.service';
import { DEFAULT_MOCK_SET } from '../fixtures/mock-set-default';
import { MockGo2JoyClient } from '../mock-go2joy.client';
import type { PartnerApiClient } from '../partner-api.client';
import { PartnerDataService } from '../partner-data.service';
import { PartnerDataStep } from '../partner-data.step';
import type { PartnerPrepareInput } from '../partner-data.step';
import { PartnerFlagService } from '../partner-flag.service';
import type { PartnerLookupLogService, LookupLogEntry } from '../partner-lookup-log.service';
import { PartnerToolsService } from '../partner-tools.service';

/**
 * A test rig for tools mode (PLN-261012 SG-33) that wires the REAL chain end to end:
 *
 *   PartnerDataStep -> PartnerToolsService -> ToolLoopService -> AiGatewayService
 *     -> AnthropicAdapter (real fetch) -> FakeAnthropicServer (real HTTP, scripted)
 *   and, for the lookups the model asks for, PartnerDataService -> TopicRegistry -> MockGo2JoyClient.
 *
 * Only the persistence edges are doubles (engine/setting/tenant repositories, the usage meter, the
 * lookup-log writer, Redis). Specs set `PARTNER_DATA_ENABLED=1` themselves via `toolsEnv()`.
 */

export const ENGINE_ID = 5;
export const TENANT_ID = 1;

const ENGINE_BASE = {
  id: String(ENGINE_ID),
  tenantId: null,
  provider: 'anthropic',
  name: 'Fake Claude',
  model: 'claude-fake-1',
  endpoint: null as string | null,
  apiKeyEncrypted: null,
  capabilities: 'chat,rag,summary,assist,moderation,tools',
  status: 'enabled',
  isDefault: 1,
};

export interface ChainOpts {
  fake?: FakeAnthropicServer;
  /** Overrides of the engine row; `null` = no engine row at all (the platform has none configured). */
  engine?: Partial<typeof ENGINE_BASE> | null;
  /** The tenant's override (`null` = inherit `PARTNER_DATA_MODE`). Default `tools`. */
  tenantMode?: 'tools' | 'prefetch' | null;
  /** `partner_data_enabled` of the tenant. Default on. */
  tenantEnabled?: boolean;
  client?: PartnerApiClient;
  /** Scripted tool behaviour for a `stub` engine (the only way the stub can call tools). */
  stubScript?: StubToolScript;
}

/** Environment a tools spec needs; returns the function that puts it back. */
export function toolsEnv(extra: Record<string, string | undefined> = {}): () => void {
  const keys = [
    'PARTNER_DATA_ENABLED',
    'PARTNER_DATA_MODE',
    'PARTNER_TOOLS_ENABLED',
    'PARTNER_TOOLS_MAX_ITERATIONS',
    'PARTNER_TOOLS_MAX_CALLS',
    'PARTNER_TOOLS_BUDGET_MS',
    'PARTNER_TOOLS_MAX_TOKENS',
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'AI_MAX_RETRIES',
    'AI_BREAKER_ENABLED',
    'AI_REQUEST_TIMEOUT_MS',
  ];
  const all = [...new Set([...keys, ...Object.keys(extra)])];
  const saved = Object.fromEntries(all.map((k) => [k, process.env[k]]));
  process.env.PARTNER_DATA_ENABLED = '1';
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
  process.env.OPENAI_API_KEY = 'test-openai-key';
  // One attempt per model call: a 5xx must degrade at once, deterministically (retry has its own specs).
  process.env.AI_MAX_RETRIES = '0';
  process.env.AI_BREAKER_ENABLED = '0';
  // Overrides win; an explicit `undefined` unsets the variable.
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return () => {
    for (const k of all) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  };
}

export const claimsOf = (over: Partial<IdentityClaims> = {}): IdentityClaims => ({
  hotelSn: '1721',
  role: 'manager',
  hotelName: 'A In Hotel Del Luna',
  signed: true,
  verifiedAt: new Date().toISOString(),
  ...over,
});

export function buildChain(opts: ChainOpts = {}) {
  const rows: LookupLogEntry[] = [];
  const logs = {
    record: jest.fn(async (e: LookupLogEntry) => {
      rows.push(e);
    }),
  } as unknown as PartnerLookupLogService;

  const engineRow = opts.engine === null ? null : { ...ENGINE_BASE, endpoint: opts.fake?.url ?? null, ...(opts.engine ?? {}) };
  const engineRepo = {
    findOne: jest.fn(async () => engineRow),
    update: jest.fn(async () => undefined),
  };
  const settingRepo = {
    findOne: jest.fn(async () => (engineRow ? { tenantId: TENANT_ID, func: 'rag', engineId: ENGINE_ID, paramsJson: null } : null)),
  };
  const stub = new StubAdapter();
  if (opts.stubScript) stub.toolScript = opts.stubScript;
  const usage = { record: jest.fn(async () => undefined) };
  const gateway = new AiGatewayService(
    engineRepo as never,
    settingRepo as never,
    stub,
    new AnthropicAdapter(),
    new OpenAiAdapter(),
    { provider: 'voyage', complete: jest.fn(), embed: jest.fn() } as never,
    usage as never,
  );
  gateway.hooks.sleep = async () => undefined;
  gateway.hooks.random = () => 0;

  const tenant = {
    id: TENANT_ID,
    partnerDataEnabled: opts.tenantEnabled === false ? 0 : 1,
    partnerDataMode: opts.tenantMode === undefined ? 'tools' : opts.tenantMode,
  };
  const redis = { available: () => false, get: jest.fn(), set: jest.fn(async () => undefined), del: jest.fn() };
  const flags = new PartnerFlagService({ findOne: jest.fn(async () => tenant), update: jest.fn() } as never, redis as never);

  const client: PartnerApiClient = opts.client ?? new MockGo2JoyClient(DEFAULT_MOCK_SET);
  const clientGet = jest.spyOn(client, 'get');
  const data = new PartnerDataService(client, logs);
  const loop = new ToolLoopService(gateway);
  const tools = new PartnerToolsService(loop, data, logs, flags);
  const step = new PartnerDataStep(flags, data, logs, tools);

  const prepare = (
    text: string,
    over: { claims?: IdentityClaims | null; extra?: Partial<PartnerPrepareInput> } = {},
  ) =>
    step.prepare({
      tenantId: TENANT_ID,
      session: {
        id: 5,
        tenantId: TENANT_ID,
        identityClaims: over.claims === undefined ? claimsOf() : over.claims,
      },
      conversationId: 77,
      messageId: 101,
      text,
      language: 'VI',
      ...over.extra,
    });

  return { step, tools, loop, gateway, flags, data, logs, rows, usage, clientGet, client, engineRepo, stub, prepare, claimsOf };
}

export type Chain = ReturnType<typeof buildChain>;

export const roleClaims = (role: IdentityRole) => claimsOf({ role });
