import { randomBytes } from 'crypto';
import { Repository } from 'typeorm';

process.env.CRED_ENC_KEY = randomBytes(32).toString('base64');

import { CustomerService } from './customer.service';
import { CustomerMapper } from './customer.mapper';
import { Customer } from './entity/customer.entity';
import { OrderCache } from '../order/entity/order-cache.entity';
import { ErasureSuppressionService } from '../privacy/erasure-suppression.service';

/**
 * PLN-260920: the console must not receive plaintext contact details unless a
 * reveal was asked for, and a reveal must leave a trace. These two properties
 * are the whole control, so they are asserted directly rather than through a
 * route test that could pass with the masking accidentally removed.
 */
function customer(over: Partial<Customer> = {}): Customer {
  return Object.assign(new Customer(), {
    id: 7,
    tenantId: 1,
    shopifyCustomerId: '123',
    email: 'hong.gildong@gmail.com',
    name: '홍길동',
    phone: '+82 10-1234-5678',
    tier: 'regular',
    shopifyTier: null,
    createdAt: new Date('2026-09-01T00:00:00Z'),
    updatedAt: new Date('2026-09-01T00:00:00Z'),
    ...over,
  });
}

describe('CustomerMapper masking', () => {
  it('masks name, email and phone by default', () => {
    const row = CustomerMapper.toCustomer(customer());
    expect(row.email).toBe('ho***@gmail.com');
    expect(row.name).toBe('홍*동');
    expect(row.phone).toBe('***-5678');
    expect(row.masked).toBe(true);
  });

  it('returns plaintext only when a reveal was asked for', () => {
    const row = CustomerMapper.toCustomer(customer(), undefined, { reveal: true });
    expect(row.email).toBe('hong.gildong@gmail.com');
    expect(row.name).toBe('홍길동');
    expect(row.phone).toBe('+82 10-1234-5678');
    expect(row.masked).toBe(false);
  });

  it('never ships a phone number in list rows', () => {
    const rows = CustomerMapper.toCustomerList([customer(), customer({ id: 8 })]);
    for (const row of rows) {
      expect(row).not.toHaveProperty('phone');
      expect(row.email).toBe('ho***@gmail.com');
    }
  });

  it('echoes back only the writable fields after an update', () => {
    const row = CustomerMapper.toCustomerSummary(customer());
    expect(Object.keys(row).sort()).toEqual(['id', 'masked', 'name', 'tier']);
    expect(row.name).toBe('홍*동');
  });

  it('leaves a missing value missing rather than inventing a mask', () => {
    const row = CustomerMapper.toCustomer(customer({ email: null, name: null, phone: null }));
    expect(row.email).toBeNull();
    expect(row.name).toBeNull();
    expect(row.phone).toBeNull();
  });
});

describe('CustomerService.reveal', () => {
  const build = () => {
    const rows = [customer()];
    const audits: Array<Record<string, unknown>> = [];
    const repo = {
      findOne: jest.fn(async ({ where }: { where: Partial<Customer> }) =>
        rows.find((r) => r.id === where.id && r.tenantId === where.tenantId) ?? null,
      ),
    } as unknown as Repository<Customer>;
    const svc = new CustomerService(
      repo,
      {} as Repository<OrderCache>,
      { isSuppressed: async () => false } as unknown as ErasureSuppressionService,
      { write: jest.fn(async (a: Record<string, unknown>) => void audits.push(a)) } as never,
    );
    return { svc, audits };
  };

  it('writes an audit row naming the customer, and masks the address inside it', async () => {
    const { svc, audits } = build();
    const found = await svc.reveal(1, 7, 42);

    expect(found.email).toBe('hong.gildong@gmail.com');
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      tenantId: 1,
      actorType: 'user',
      actorId: 42,
      action: 'customer.pii_revealed',
      target: 'customer:7',
    });
    // The trail says a read happened; it is not a second copy of the data.
    expect(JSON.stringify(audits[0].metadata)).not.toContain('hong.gildong');
  });

  it('refuses a customer from another tenant before any audit row is written', async () => {
    const { svc, audits } = build();
    await expect(svc.reveal(2, 7, 42)).rejects.toThrow();
    expect(audits).toHaveLength(0);
  });
});
