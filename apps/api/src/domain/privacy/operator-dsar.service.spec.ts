import { randomBytes } from 'crypto';
import { OperatorDsarService, phoneKey } from './operator-dsar.service';
import { PrivacyService } from './privacy.service';
import { blindIndex } from '../../global/util/crypto.util';

// blindIndex() needs the PII key; any 32 random bytes will do for a unit test.
process.env.CRED_ENC_KEY = randomBytes(32).toString('base64');

/**
 * Operator-side DSAR (PLN-261012 SG-70). The properties that matter: it is
 * tenant-scoped with an answer that leaks nothing about other tenants, the
 * response is masked, the search term never reaches the audit table, and an
 * erasure needs a deliberate second confirmation.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

function customer(over: Row = {}): Row {
  return {
    id: 42,
    tenantId: 7,
    name: 'Nguyen Lan',
    email: 'lan.nguyen@example.vn',
    phone: '+84 912 345 678',
    externalCustomerId: 'ext-1',
    shopifyCustomerId: null,
    cafe24UserIdentifier: null,
    cafe24MemberId: null,
    tier: 'regular',
    lastClaims: { hotelSn: '1721', hotelName: 'A In Hotel', role: 'manager' },
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

function build(rows: Row[] = [customer()]) {
  const audits: Row[] = [];
  const finds: Row[] = [];
  const customerRepo = {
    find: jest.fn(async (q: Row) => {
      finds.push(q);
      return rows.filter(
        (r) =>
          r.tenantId === q.where.tenantId &&
          (q.where.emailHash === undefined || blindIndex(r.email) === q.where.emailHash) &&
          (q.where.externalCustomerId === undefined || r.externalCustomerId === q.where.externalCustomerId),
      );
    }),
    findOne: jest.fn(async (q: Row) => rows.find((r) => r.id === q.where.id && r.tenantId === q.where.tenantId) ?? null),
    createQueryBuilder: jest.fn(() => {
      const qb: Row = {};
      let tenant = 0;
      let after = 0;
      qb.where = (_s: string, p: Row) => ((tenant = p.tenantId), qb);
      qb.andWhere = (_s: string, p?: Row) => ((after = p?.after ?? after), qb);
      qb.orderBy = () => qb;
      qb.take = () => qb;
      qb.getMany = async () => rows.filter((r) => r.tenantId === tenant && r.phone && Number(r.id) > after);
      return qb;
    }),
  };
  const privacy = {
    exportCustomer: jest.fn(async () => ({ customer: { id: 42 } })),
    eraseCustomer: jest.fn(async () => undefined),
  };
  const audit = { write: jest.fn(async (a: Row) => audits.push(a)) };
  const svc = new OperatorDsarService(customerRepo as never, privacy as unknown as PrivacyService, audit as never);
  return { svc, privacy, audits, customerRepo, finds };
}

describe('OperatorDsarService (SG-70)', () => {
  describe('lookup', () => {
    it('finds by email through the blind index, scoped to the caller tenant', async () => {
      const h = build([customer(), customer({ id: 43, tenantId: 8 })]);
      const out = await h.svc.lookup(7, 1, 'email', 'lan.nguyen@example.vn');
      expect(out.items.map((i) => i.id)).toEqual([42]);
      expect(h.finds[0].where).toMatchObject({ tenantId: 7, emailHash: blindIndex('lan.nguyen@example.vn') });
    });

    it('finds by external id and by phone in any common spelling', async () => {
      const h = build();
      expect((await h.svc.lookup(7, 1, 'external_id', 'ext-1')).items).toHaveLength(1);
      for (const spelled of ['0912345678', '+84912345678', '0084 912-345-678']) {
        expect((await h.svc.lookup(7, 1, 'phone', spelled)).items.map((i) => i.id)).toEqual([42]);
      }
    });

    it('never returns another tenant\'s customer', async () => {
      const h = build([customer({ tenantId: 8 })]);
      expect((await h.svc.lookup(7, 1, 'email', 'lan.nguyen@example.vn')).items).toEqual([]);
      expect((await h.svc.lookup(7, 1, 'phone', '0912345678')).items).toEqual([]);
    });

    it('answers with masked contact details only', async () => {
      const [row] = (await build().svc.lookup(7, 1, 'external_id', 'ext-1')).items;
      expect(row.email).toBe('la***@example.vn');
      expect(row.phone).toBe('***-5678');
      expect(row.name).not.toBe('Nguyen Lan');
      expect(JSON.stringify(row)).not.toContain('lan.nguyen@example.vn');
      expect(JSON.stringify(row)).not.toContain('912');
      expect(row.lastHotel).toEqual({ hotelSn: '1721', hotelName: 'A In Hotel' });
    });

    it('audits how it searched and how many matched — never the term', async () => {
      const h = build();
      await h.svc.lookup(7, 99, 'email', 'lan.nguyen@example.vn');
      expect(h.audits[0]).toMatchObject({
        tenantId: 7,
        actorType: 'user',
        actorId: 99,
        action: 'dsar.lookup',
        metadata: { by: 'email', matches: 1, truncated: false },
      });
      expect(JSON.stringify(h.audits[0])).not.toContain('lan.nguyen');
    });

    it.each(['', ' ', 'ab'])('rejects a too-short term %p', async (term) => {
      await expect(build().svc.lookup(7, 1, 'email', term)).rejects.toMatchObject({ errorCode: 'E5115' });
    });
  });

  describe('export', () => {
    it('exports through the shared privacy compilation, naming the operator and the reference', async () => {
      const h = build();
      await h.svc.exportFor(7, 99, 42, 'TICKET-123');
      expect(h.privacy.exportCustomer).toHaveBeenCalledWith(42, { userId: 99, reference: 'TICKET-123' });
    });

    it('answers 404 — identical for "missing" and "other tenant" — and exports nothing', async () => {
      const h = build([customer({ tenantId: 8 })]);
      await expect(h.svc.exportFor(7, 99, 42)).rejects.toMatchObject({ errorCode: 'E5116' });
      await expect(h.svc.exportFor(7, 99, 4242)).rejects.toMatchObject({ errorCode: 'E5116' });
      expect(h.privacy.exportCustomer).not.toHaveBeenCalled();
    });
  });

  describe('erase', () => {
    it('erases only when the confirmation repeats the customer id', async () => {
      const h = build();
      await h.svc.eraseFor(7, 99, 42, 42, 'TICKET-9');
      expect(h.privacy.eraseCustomer).toHaveBeenCalledWith(42, { userId: 99, reference: 'TICKET-9' });
    });

    it('refuses a mismatched confirmation before touching anything', async () => {
      const h = build();
      await expect(h.svc.eraseFor(7, 99, 42, 43)).rejects.toMatchObject({ errorCode: 'E5117' });
      expect(h.customerRepo.findOne).not.toHaveBeenCalled();
      expect(h.privacy.eraseCustomer).not.toHaveBeenCalled();
    });

    it('refuses to erase another tenant\'s customer', async () => {
      const h = build([customer({ tenantId: 8 })]);
      await expect(h.svc.eraseFor(7, 99, 42, 42)).rejects.toMatchObject({ errorCode: 'E5116' });
      expect(h.privacy.eraseCustomer).not.toHaveBeenCalled();
    });
  });

  describe('phoneKey', () => {
    it('normalises country code and trunk prefix', () => {
      expect(phoneKey('+84 912 345 678')).toBe('0912345678');
      expect(phoneKey('0912345678')).toBe('0912345678');
      expect(phoneKey('+82 10-1234-5678')).toBe('01012345678');
      expect(phoneKey(null)).toBe('');
    });
  });
});
