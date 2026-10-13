import { IDENTITY_ROLE } from '@sharptalk/types';
import { PARTNER_TOPICS } from './partner-data.constants';
import { looksLikeHotelScopeKey, validateParams } from './partner-params.util';
import type { ParamSpec } from './partner-params.util';
import { PARAM_HELP, TOPIC_HELP, buildPartnerTools, paramSchema, topicOfTool, toolFor } from './partner-tools';
import { TopicRegistry } from './partner-topics';
import type { TopicDef } from './partner-topics';

/**
 * PLN-261012 SG-33 — the model's tools are DERIVED from the topic registry: same topics, same closed
 * parameter sets, same role allow-list, and no way to name a hotel.
 */
describe('partner tools (derived from the TopicRegistry)', () => {
  const registry = new TopicRegistry();
  const defs = registry.topics().map((t) => registry.get(t));

  it('one tool per registered topic, named lookup_<topic>, in a name every provider accepts', () => {
    const tools = buildPartnerTools(IDENTITY_ROLE.MANAGER, registry);
    expect(tools.map((t) => t.name)).toEqual(registry.topics().map((t) => `lookup_${t}`));
    for (const t of tools) expect(t.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
  });

  it('a tool name maps back to its topic, and nothing else maps to anything', () => {
    for (const topic of PARTNER_TOPICS) expect(topicOfTool(`lookup_${topic}`, registry)).toBe(topic);
    for (const bad of ['lookup_', 'LOOKUP_RATES', 'lookup_rates ', ' lookup_rates', 'rates', 'lookup_all', 'lookup___proto__', 'lookup_constructor', '', 'get_partner_rates', 'lookup_rates/../x']) {
      expect(topicOfTool(bad, registry)).toBeNull();
    }
    expect(topicOfTool(undefined as never, registry)).toBeNull();
    expect(topicOfTool(42 as never, registry)).toBeNull();
  });

  describe.each(defs.map((d) => [d.topic, d] as const))('%s', (_topic, def) => {
    const tool = toolFor(def);
    const props = (tool.inputSchema as { properties: Record<string, Record<string, unknown>> }).properties;

    it('its schema has EXACTLY the topic\'s closed parameter set — no more, no fewer', () => {
      expect(Object.keys(props).sort()).toEqual(Object.keys(def.params).sort());
    });

    it('each property mirrors the ParamSpec the server validates with', () => {
      for (const [key, spec] of Object.entries(def.params)) {
        const p = props[key];
        switch (spec.kind) {
          case 'enum':
            expect(p).toMatchObject({ type: 'string', enum: [...spec.values] });
            break;
          case 'pattern':
            expect(p).toMatchObject({ type: 'string', pattern: spec.pattern.source });
            break;
          case 'int':
            expect(p).toMatchObject({ type: 'integer', minimum: spec.min, maximum: spec.max });
            break;
          case 'date':
          case 'month':
            expect(p.type).toBe('string');
            expect(typeof p.pattern).toBe('string');
            break;
        }
      }
    });

    it('is a closed object schema: no extra properties, no top-level oneOf/anyOf/allOf, no `required`', () => {
      expect(tool.inputSchema).toMatchObject({ type: 'object', additionalProperties: false });
      for (const k of ['oneOf', 'anyOf', 'allOf', 'required', 'patternProperties']) expect(tool.inputSchema).not.toHaveProperty(k);
    });

    it('offers no hotel / tenant / partner handle — in a property name or in any prose', () => {
      expect(Object.keys(props).filter(looksLikeHotelScopeKey)).toEqual([]);
      expect(JSON.stringify(tool)).not.toMatch(/hotel|tenant|partner|branch|merchant|outlet/i);
    });

    it('has a description of the topic and of every parameter (a new topic cannot ship a blank tool)', () => {
      expect(TOPIC_HELP[def.topic]).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(20);
      for (const key of Object.keys(def.params)) expect(PARAM_HELP[`${def.topic}.${key}`]).toBeTruthy();
    });
  });

  it('the help text has no entries for topics or parameters that no longer exist', () => {
    expect(Object.keys(TOPIC_HELP).sort()).toEqual([...PARTNER_TOPICS].sort());
    const valid = new Set(defs.flatMap((d) => Object.keys(d.params).map((k) => `${d.topic}.${k}`)));
    expect(Object.keys(PARAM_HELP).filter((k) => !valid.has(k))).toEqual([]);
  });

  describe('least privilege per role (the server still enforces it on every call)', () => {
    it('manager and internal are offered all four; a receptionist is not offered settlement', () => {
      expect(buildPartnerTools(IDENTITY_ROLE.MANAGER, registry)).toHaveLength(4);
      expect(buildPartnerTools(IDENTITY_ROLE.INTERNAL, registry)).toHaveLength(4);
      expect(buildPartnerTools(IDENTITY_ROLE.RECEPTIONIST, registry).map((t) => t.name)).toEqual([
        'lookup_policies',
        'lookup_rates',
        'lookup_bookings',
      ]);
    });

    it('the offered set is exactly the registry allow-list, for every role', () => {
      for (const role of Object.values(IDENTITY_ROLE)) {
        const offered = buildPartnerTools(role, registry).map((t) => t.name);
        const allowed = defs.filter((d) => registry.allows(d, role)).map((d) => `lookup_${d.topic}`);
        expect(offered).toEqual(allowed);
      }
    });
  });

  describe('derivation, not transcription', () => {
    const synthetic = {
      topic: 'rates',
      params: {
        e: { kind: 'enum', values: ['a', 'b'] },
        p: { kind: 'pattern', pattern: /^[A-Z]{3}$/ },
        d: { kind: 'date' },
        m: { kind: 'month' },
        n: { kind: 'int', min: 2, max: 9 },
      } as Record<string, ParamSpec>,
    } as unknown as TopicDef;

    it('a topic with other parameters yields a schema of exactly those, from their specs', () => {
      const props = (toolFor(synthetic).inputSchema as { properties: Record<string, unknown> }).properties;
      expect(Object.keys(props)).toEqual(['e', 'p', 'd', 'm', 'n']);
      expect(props.e).toMatchObject({ enum: ['a', 'b'] });
      expect(props.p).toMatchObject({ pattern: '^[A-Z]{3}$' });
      expect(props.n).toMatchObject({ type: 'integer', minimum: 2, maximum: 9 });
    });

    it('the generated date / month patterns accept exactly what the validator accepts at the syntax level', () => {
      const date = new RegExp((paramSchema({ kind: 'date' }, '') as { pattern: string }).pattern);
      const month = new RegExp((paramSchema({ kind: 'month' }, '') as { pattern: string }).pattern);
      expect(date.test('2026-10-17')).toBe(true);
      expect(date.test('17/10/2026')).toBe(false);
      expect(month.test('2026-09')).toBe(true);
      expect(month.test('2026-13')).toBe(false);
      // Anything the schema would let through is still re-validated on the server.
      expect(() => validateParams({ date: '2026-02-30' }, { date: { kind: 'date' } })).toThrow();
    });
  });
});
