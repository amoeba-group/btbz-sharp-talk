import { readFileSync } from 'fs';
import { join } from 'path';
import { PARTNER_TOPICS } from './partner-data.constants';
import { TopicRegistry } from './partner-topics';

/**
 * The draft OpenAPI contract (docs/guide/API-REQ-Go2Joy-Partner-Data.openapi.yaml,
 * PLN-261012 SG-30) and the code must say the same thing. Go2Joy reviews the
 * document; SharpTalk is built against the registry — if they drift, the review
 * is of something we do not run. Read as text on purpose: no YAML dependency.
 */
describe('Partner data OpenAPI contract ↔ TopicRegistry', () => {
  const yaml = readFileSync(join(__dirname, '../../../../../docs/guide/API-REQ-Go2Joy-Partner-Data.openapi.yaml'), 'utf8').replace(/\r\n/g, '\n');
  const registry = new TopicRegistry();

  /** The text of one `/v0/<topic>:` path item (up to the next path or the components section). */
  const pathBlock = (topic: string): string => {
    const start = yaml.indexOf(`\n  /v0/${topic}:\n`);
    expect(start).toBeGreaterThan(-1);
    const rest = yaml.slice(start + 1);
    const end = rest.slice(2).search(/\n {2}\/v0\/|\ncomponents:/);
    return end === -1 ? rest : rest.slice(0, end + 2);
  };

  /** Inline (non-$ref) parameters of a path block: [{ name, in }]. */
  const inlineParams = (block: string): Array<{ name: string; in: string }> => {
    const out: Array<{ name: string; in: string }> = [];
    const re = /- name: (\w+)\n\s+in: (\w+)/g;
    for (const m of block.matchAll(re)) out.push({ name: m[1], in: m[2] });
    return out;
  };

  it('documents exactly the topics the registry allows (plus the ping)', () => {
    const paths = [...yaml.matchAll(/\n {2}\/v0\/(\w+):\n/g)].map((m) => m[1]).sort();
    expect(paths).toEqual([...PARTNER_TOPICS, 'ping'].sort());
    expect(registry.topics().sort()).toEqual([...PARTNER_TOPICS].sort());
  });

  it.each([...PARTNER_TOPICS])('%s: the documented query parameters are exactly the registry\'s closed set', (topic) => {
    const documented = inlineParams(pathBlock(topic))
      .filter((p) => p.in === 'query')
      .map((p) => p.name);
    // page/size come in through shared $ref parameters
    const refs = [...pathBlock(topic).matchAll(/\$ref: '#\/components\/parameters\/(Page|Size)'/g)].map((m) => (m[1] === 'Page' ? 'page' : 'size'));
    expect([...documented, ...refs].sort()).toEqual(Object.keys(registry.get(topic).params).sort());
  });

  it('has NO hotel identifier in any query parameter, anywhere in the document', () => {
    const queryNames = [...yaml.matchAll(/- name: (\w+)\n\s+in: query/g)].map((m) => m[1]);
    expect(queryNames.length).toBeGreaterThan(5);
    for (const n of queryNames) expect(n).not.toMatch(/hotel|propert|tenant|partner|branch|sn$/i);
    // the only place a hotel appears is the X-Hotel-Sn HEADER (built by the server from verified claims)
    expect(yaml).toMatch(/name: X-Hotel-Sn\n\s+in: header/);
  });

  it('is read-only: GET operations only, no request bodies', () => {
    expect(yaml).not.toMatch(/\n {4}(post|put|patch|delete):/);
    expect(yaml).not.toMatch(/requestBody:/);
    expect([...yaml.matchAll(/\n {4}get:/g)].length).toBe(PARTNER_TOPICS.length + 1);
  });

  it('settlement is documented as manager/internal only, matching the role allow-list', () => {
    expect(pathBlock('settlement')).toMatch(/manager, internal ONLY/);
    expect(registry.get('settlement').roles).toEqual(['manager', 'internal']);
  });

  it('documents the money invariants SharpTalk enforces', () => {
    expect(yaml).toMatch(/finalVnd = baseVnd \+ extraVnd - directDiscountVnd - flashSaleVnd - couponVnd/);
    expect(yaml).toMatch(/netVnd = grossVnd - commissionVnd - deductionVnd/);
    expect(yaml).toMatch(/outstandingVnd = netVnd - paidVnd/);
  });
});
