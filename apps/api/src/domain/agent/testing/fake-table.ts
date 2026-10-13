import { FindOperator } from 'typeorm';

/**
 * A tiny in-memory stand-in for a TypeORM repository, for specs that want to run a
 * service against real rows instead of asserting on mock calls (PLN-261012 routing
 * extras). It understands the operators the routing code uses — IsNull, In, LessThan,
 * LessThanOrEqual — and throws on any other, so a query this fake cannot model fails
 * loudly instead of silently matching everything.
 */
export type Row = Record<string, unknown> & { id?: number };

const time = (x: unknown) => (x instanceof Date ? x.getTime() : Number(x));

export function holds(value: unknown, op: unknown): boolean {
  if (!(op instanceof FindOperator)) return value === op;
  const v = (op as unknown as { value: unknown }).value;
  switch (op.type) {
    case 'isNull':
      return value === null || value === undefined;
    case 'in':
      return (v as unknown[]).some((x) => x === value);
    case 'lessThan':
      return value != null && time(value) < time(v);
    case 'lessThanOrEqual':
      return value != null && time(value) <= time(v);
    default:
      throw new Error(`operator not modelled by the fake: ${op.type}`);
  }
}

export const matches = (row: Row, cond: Record<string, unknown>): boolean =>
  Object.entries(cond).every(([k, op]) => holds(row[k], op));

type Where = Record<string, unknown> | Array<Record<string, unknown>> | undefined;
const matchesAny = (row: Row, where: Where): boolean => {
  if (!where) return true;
  return Array.isArray(where) ? where.some((c) => matches(row, c)) : matches(row, where);
};

export function fakeRepo<T extends Row>(table: T[], opts: { nextId?: number } = {}) {
  let nextId = opts.nextId ?? 1000;
  return {
    table,
    find: jest.fn(async (q: { where?: Where; order?: Record<string, 'ASC' | 'DESC'>; take?: number } = {}) => {
      let rows = table.filter((r) => matchesAny(r, q.where));
      const order = q.order && Object.entries(q.order)[0];
      if (order) {
        const [key, dir] = order;
        rows = [...rows].sort((a, b) => (time(a[key]) - time(b[key])) * (dir === 'DESC' ? -1 : 1));
      }
      return (q.take ? rows.slice(0, q.take) : rows) as T[];
    }),
    findOne: jest.fn(async (q: { where?: Where; order?: Record<string, 'ASC' | 'DESC'> } = {}) => {
      let rows = table.filter((r) => matchesAny(r, q.where));
      const order = q.order && Object.entries(q.order)[0];
      if (order) {
        const [key, dir] = order;
        rows = [...rows].sort((a, b) => (time(a[key]) - time(b[key])) * (dir === 'DESC' ? -1 : 1));
      }
      return (rows[0] ?? null) as T | null;
    }),
    count: jest.fn(async (q: { where?: Where } = {}) => table.filter((r) => matchesAny(r, q.where)).length),
    create: jest.fn((o: Partial<T>) => ({ ...o }) as T),
    save: jest.fn(async (o: T) => {
      if (o.id == null) {
        o.id = nextId++;
        table.push(o);
      }
      return o;
    }),
    update: jest.fn(async (criteria: Record<string, unknown>, patch: Partial<T>) => {
      const hit = table.filter((r) => matches(r, criteria));
      hit.forEach((r) => Object.assign(r, patch));
      return { affected: hit.length };
    }),
  };
}
