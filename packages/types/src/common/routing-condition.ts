/**
 * Customer-information conditions on handoff routing rules
 * (PLN-261019-Users-Unit-Labels-Routing-Conditions P4).
 *
 * A rule used to see three things: the signed region, the message text and the
 * deny-rule label. Operators also want "VI-speaking sessions", "verified
 * customers", "this hotel" — facts the session already carries. The fields are
 * a fixed allow-list so a rule can never reach into PII (name/email/phone are
 * deliberately absent) and so the console can render each one properly.
 *
 * `kind`/`op` are decided here, not stored: an enum field matches when the
 * value is one of the chosen ones; a text field either matches exactly (`in`)
 * or by substring (`contains`). Comparison is trimmed and case-insensitive.
 *
 * Browser bundles import this file directly (a value import from the package
 * root fails the Vite build), the same way language.ts is consumed.
 */
export const ROUTING_CONDITION_FIELDS = [
  { field: 'language', kind: 'enum', op: 'in', source: 'session' },
  { field: 'identity_level', kind: 'enum', op: 'in', source: 'session' },
  { field: 'customer_tier', kind: 'enum', op: 'in', source: 'customer' },
  // B2B contact vs consumer (PLN-261022 stage 2).
  { field: 'customer_type', kind: 'enum', op: 'in', source: 'customer' },
  { field: 'hotel_id', kind: 'text', op: 'in', source: 'identity' },
  { field: 'hotel_name', kind: 'text', op: 'contains', source: 'identity' },
  { field: 'province', kind: 'text', op: 'contains', source: 'identity' },
  { field: 'role', kind: 'text', op: 'in', source: 'identity' },
  { field: 'landing_path', kind: 'text', op: 'contains', source: 'session' },
] as const;

export type RoutingConditionField = (typeof ROUTING_CONDITION_FIELDS)[number]['field'];
export type RoutingConditionOp = 'in' | 'contains';
export type RoutingConditionDef = (typeof ROUTING_CONDITION_FIELDS)[number];

/** Stored on a routing rule. All conditions on a rule must hold (AND); empty values hold. */
export interface RoutingCondition {
  field: RoutingConditionField;
  values: string[];
}

/** Fixed option sets for the enum fields; `language` comes from the tenant's offered languages. */
export const ROUTING_CONDITION_ENUM_VALUES: Readonly<Partial<Record<RoutingConditionField, readonly string[]>>> = {
  identity_level: ['guest', 'verified'],
  customer_tier: ['guest', 'subscriber', 'regular'],
  customer_type: ['b2c', 'b2b_contact'],
};

export function routingConditionDef(field: string): RoutingConditionDef | undefined {
  return ROUTING_CONDITION_FIELDS.find((f) => f.field === field);
}

export function isRoutingConditionField(field: string): field is RoutingConditionField {
  return routingConditionDef(field) !== undefined;
}
