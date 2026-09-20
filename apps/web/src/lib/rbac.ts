import type { Principal, Rank } from './types';

export type Capability =
  | 'live_chat'
  | 'history'
  | 'orders'
  | 'customers'
  | 'campaigns'
  | 'reviews'
  | 'knowledge'
  | 'affiliates'
  | 'ai_settings'
  | 'users'
  | 'settings'
  | 'work_log'
  | 'statistics'
  | 'customer_pii_reveal'
  | 'dashboard';

// Label codes mapped to capability groups.
const LABEL_CAPS: Record<string, Capability[]> = {
  consult: ['live_chat', 'history'],
  operations: ['orders', 'customers', 'campaigns', 'reviews', 'knowledge'],
  accounting: ['affiliates'],
};

// Rank → which capabilities it may reach when granted by a label, plus admin-ish extras.
const RANK_EXTRA: Record<Rank, Capability[]> = {
  master: [
    'dashboard',
    'live_chat',
    'history',
    'orders',
    'customers',
    'campaigns',
    'reviews',
    'knowledge',
    'affiliates',
    'ai_settings',
    'users',
    'settings',
    'work_log',
    'statistics',
    // Reading a shopper's contact details is audited and deliberately narrow
    // (PLN-260920). The server enforces it; this only decides whether the
    // console offers the control.
    'customer_pii_reveal',
  ],
  director: [
    'dashboard',
    'live_chat',
    'history',
    'orders',
    'customers',
    'campaigns',
    'reviews',
    'knowledge',
    'affiliates',
    'ai_settings',
    'settings',
    'work_log',
    'statistics',
    'customer_pii_reveal',
  ],
  manager: ['dashboard', 'ai_settings', 'statistics'],
  staff: ['dashboard'],
};

export function capabilitiesFor(principal: Principal | null): Set<Capability> {
  const caps = new Set<Capability>();
  if (!principal) return caps;

  // Platform admins use a separate menu; grant nothing on the tenant side.
  if (principal.actorType === 'admin') return caps;

  caps.add('dashboard');

  const rank = principal.rank ?? 'staff';
  // master sees everything regardless of labels.
  if (rank === 'master') {
    RANK_EXTRA.master.forEach((c) => caps.add(c));
    return caps;
  }

  // Rank baseline capabilities.
  RANK_EXTRA[rank].forEach((c) => caps.add(c));

  // Label-derived capabilities (any rank above staff can act on its labels).
  const labels = principal.labels ?? [];
  for (const label of labels) {
    const granted = LABEL_CAPS[label];
    if (!granted) continue;
    for (const cap of granted) {
      // staff may only "handle" — restrict to live_chat / orders handling.
      if (rank === 'staff' && !['live_chat', 'orders'].includes(cap)) continue;
      caps.add(cap);
    }
  }

  return caps;
}

export function makeCan(principal: Principal | null) {
  const caps = capabilitiesFor(principal);
  return (capability: Capability) => caps.has(capability);
}
