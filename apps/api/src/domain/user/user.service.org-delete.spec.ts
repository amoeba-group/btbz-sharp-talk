import { HttpStatus } from '@nestjs/common';
import { UserService } from './user.service';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { BusinessException } from '../../global/exception/business.exception';

/**
 * Label / unit delete — PLN-261021-Users-Labels-Units-Delete.
 * Ids are STRINGS where TypeORM hands back a BIGINT PK (bigint-PK-as-string trap);
 * routing rules store unit ids as JSON numbers, so the rule check must still match.
 */
function repo(overrides: Record<string, unknown> = {}): never {
  return {
    find: jest.fn(async () => []),
    findOne: jest.fn(async () => null),
    save: jest.fn(async (x: unknown) => x),
    delete: jest.fn(),
    create: jest.fn((x: unknown) => x),
    ...overrides,
  } as never;
}

/** A repo whose manager.transaction runs the callback against `trx`. */
function txRepo(trx: { delete: jest.Mock; update: jest.Mock }, overrides: Record<string, unknown> = {}): never {
  return repo({ ...overrides, manager: { transaction: jest.fn(async (cb: (m: unknown) => unknown) => cb(trx)) } });
}

function trx(affected = 0) {
  return {
    delete: jest.fn(async () => ({ affected })),
    update: jest.fn(async () => ({ affected })),
  };
}

function service(
  parts: { userRepo?: never; labelRepo?: never; userLabelRepo?: never; unitRepo?: never; aiConfigRepo?: never; auditSvc?: never } = {},
) {
  return new UserService(
    parts.userRepo ?? repo(),
    parts.labelRepo ?? repo(),
    parts.userLabelRepo ?? repo(),
    repo(),
    parts.auditSvc ?? ({ write: jest.fn() } as never),
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    parts.unitRepo ?? repo(),
    parts.aiConfigRepo ?? repo(),
  );
}

const aiConfig = (handoffConfig: unknown) => repo({ findOne: jest.fn(async () => ({ tenantId: 1, handoffConfig })) });

async function rejection(p: Promise<unknown>): Promise<BusinessException> {
  try {
    await p;
  } catch (e) {
    return e as BusinessException;
  }
  throw new Error('expected a rejection');
}

describe('UserService.deleteUnit', () => {
  const unit = { id: '3', tenantId: 1, code: 'hcm', name: 'HCM', sortOrder: 10 };

  it('unassigns the members and deletes the unit in one transaction, auditing the release count', async () => {
    const t = trx(2);
    const auditSvc = { write: jest.fn() };
    const svc = service({
      unitRepo: txRepo(t, { findOne: jest.fn(async () => unit) }),
      auditSvc: auditSvc as never,
    });

    await expect(svc.deleteUnit(1, 9, 3)).resolves.toEqual({ released: 2 });
    expect(t.update).toHaveBeenCalledWith(expect.anything(), { tenantId: 1, unitId: '3' }, { unitId: null });
    expect(t.delete).toHaveBeenCalledWith(expect.anything(), { id: '3', tenantId: 1 });
    expect(auditSvc.write).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'unit.deleted', metadata: { name: 'HCM', released: 2 } }),
    );
  });

  it('reads a foreign tenant\'s unit as not found', async () => {
    const svc = service({ unitRepo: repo({ findOne: jest.fn(async () => null) }) });
    const e = await rejection(svc.deleteUnit(1, 9, 3));
    expect(e.errorCode).toBe(ERROR_CODE.UNIT_NOT_FOUND.code);
  });

  it('refuses while a routing rule groups on it (numeric JSON id vs string PK) and names the rule', async () => {
    const t = trx();
    const svc = service({
      unitRepo: txRepo(t, { findOne: jest.fn(async () => unit) }),
      aiConfigRepo: aiConfig({
        routingRules: [
          { name: 'Hanoi', assigneeUserIds: [], assigneeUnitIds: [4] },
          { name: ' HCM CS ', assigneeUserIds: [], assigneeUnitIds: [3] },
          { assigneeUserIds: [], assigneeUnitIds: [3] },
        ],
      }),
    });
    const e = await rejection(svc.deleteUnit(1, 9, 3));
    expect(e.errorCode).toBe(ERROR_CODE.ORG_IN_USE_BY_RULE.code);
    expect(e.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(e.details).toEqual({ rules: ['HCM CS', 'Routing rule 3'] });
    expect(t.delete).not.toHaveBeenCalled();
  });
});

describe('UserService.deleteLabel', () => {
  const label = { id: '5', tenantId: 1, code: 'vip_cs', name: 'VIP' };

  it('removes the holders\' links and the label', async () => {
    const t = trx(3);
    const svc = service({ labelRepo: txRepo(t, { findOne: jest.fn(async () => label) }) });

    await expect(svc.deleteLabel(1, 9, 5)).resolves.toEqual({ released: 3 });
    expect(t.delete).toHaveBeenNthCalledWith(1, expect.anything(), { jobLabelId: '5' });
    expect(t.delete).toHaveBeenNthCalledWith(2, expect.anything(), { id: '5', tenantId: 1 });
  });

  it.each(['consult', 'accounting', 'operations'])('never deletes the permission label %s', async (code) => {
    const t = trx();
    const svc = service({ labelRepo: txRepo(t, { findOne: jest.fn(async () => ({ ...label, code })) }) });
    const e = await rejection(svc.deleteLabel(1, 9, 5));
    expect(e.errorCode).toBe(ERROR_CODE.LABEL_PROTECTED.code);
    expect(t.delete).not.toHaveBeenCalled();
  });

  it('refuses while a routing group, a routing label filter or a deny rule names it', async () => {
    const svc = service({
      labelRepo: txRepo(trx(), { findOne: jest.fn(async () => label) }),
      aiConfigRepo: aiConfig({
        routingRules: [
          { name: 'Group', assigneeUserIds: [], assigneeLabelCodes: ['vip_cs'] },
          { name: 'Filter', assigneeUserIds: [1], labels: ['vip_cs'] },
          { name: 'Other', assigneeUserIds: [1], labels: ['consult'] },
        ],
        denyRules: [{ keywords: ['refund', 'chargeback', 'lawyer', 'court'], label: 'vip_cs' }],
      }),
    });
    const e = await rejection(svc.deleteLabel(1, 9, 5));
    expect(e.details).toEqual({ rules: ['Group', 'Filter', 'Deny rule 1 (refund, chargeback, lawyer)'] });
  });

  it('is not found for another tenant\'s id', async () => {
    const svc = service({ labelRepo: repo({ findOne: jest.fn(async () => null) }) });
    const e = await rejection(svc.deleteLabel(1, 9, 5));
    expect(e.errorCode).toBe(ERROR_CODE.RESOURCE_NOT_FOUND.code);
  });
});

describe('member counts on the lists', () => {
  it('counts label holders with a String()-keyed join', async () => {
    const svc = service({
      labelRepo: repo({ find: jest.fn(async () => [{ id: '5', tenantId: 1, code: 'vip_cs', name: 'VIP' }, { id: '6', tenantId: 1, code: 'x', name: 'X' }]) }),
      userLabelRepo: repo({ find: jest.fn(async () => [{ userId: 1, jobLabelId: 5 }, { userId: 2, jobLabelId: 5 }]) }),
    });
    const res = await svc.listLabels(1);
    expect(res.map((l) => l.memberCount)).toEqual([2, 0]);
  });

  it('counts unit members', async () => {
    const svc = service({
      unitRepo: repo({ find: jest.fn(async () => [{ id: '3', tenantId: 1, code: 'hcm', name: 'HCM', sortOrder: 10 }]) }),
      userRepo: repo({ find: jest.fn(async () => [{ id: '7', unitId: 3 }]) }),
    });
    const res = await svc.listUnits(1);
    expect(res[0].memberCount).toBe(1);
  });
});
