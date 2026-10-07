import { UserService } from './user.service';

/**
 * Regression for the bigint-PK-as-string trap (FIX-260811): JobLabel.id comes back
 * from TypeORM as a STRING ("1") while UserJobLabel.jobLabelId is transformed to a
 * NUMBER (1). loadLabelCodes joined them in a Map, so the lookup missed and EVERY
 * user's labelCodes came back empty — a checked job label saved fine (write OK) but
 * never showed on read. The fix String()-normalizes both sides of the join.
 */
function repo(overrides: Record<string, unknown> = {}): never {
  return {
    find: jest.fn(),
    findOne: jest.fn(),
    findAndCount: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
    create: jest.fn(),
    ...overrides,
  } as never;
}

/**
 * listUsers builds a query (role/region filters, PLN-261007); the chain is
 * inert here and only the final page matters to these tests.
 */
function listQb(result: [unknown[], number]) {
  const qb: Record<string, unknown> = {};
  for (const m of ['where', 'andWhere', 'orderBy', 'skip', 'take']) qb[m] = () => qb;
  qb.getManyAndCount = async () => result;
  return qb;
}

describe('UserService.listUsers — job-label codes join (bigint id string vs number)', () => {
  // id as a STRING — the bigint PK representation TypeORM actually returns for User.id
  // (the outer half of the join trap: result Map keyed by numeric userId vs string id).
  const user = {
    id: '2',
    tenantId: 1,
    email: 'hykim4@example.com',
    name: null,
    rank: 'master',
    status: 'active',
    mustChangePassword: 0,
    invitedAt: new Date('2026-06-30T13:55:48.000Z'),
    createdAt: new Date('2026-06-30T13:55:48.000Z'),
  };

  it('maps codes when JobLabel.id is a string and jobLabelId is a number', async () => {
    const userRepo = repo({ createQueryBuilder: () => listQb([[user], 1]) });
    // JobLabel.id as TypeORM actually returns a BIGINT PK: a STRING.
    const labelRepo = repo({
      find: jest.fn(async () => [{ id: '1', tenantId: 1, code: 'consult', name: '상담' }]),
    });
    // UserJobLabel.jobLabelId is transformed to a NUMBER.
    const userLabelRepo = repo({ find: jest.fn(async () => [{ userId: 2, jobLabelId: 1 }]) });

    const svc = new UserService(userRepo, labelRepo, userLabelRepo, repo(), repo(), {
      clearAccountLock: jest.fn(),
    } as never);
    const res = await svc.listUsers(1, 1, 20);

    expect(res.items).toHaveLength(1);
    expect(res.items[0].labelCodes).toEqual(['consult']);
  });

  it('returns empty labelCodes when the user has no assignments', async () => {
    const userRepo = repo({ createQueryBuilder: () => listQb([[user], 1]) });
    const userLabelRepo = repo({ find: jest.fn(async () => []) });
    const svc = new UserService(userRepo, repo(), userLabelRepo, repo(), repo(), {
      clearAccountLock: jest.fn(),
    } as never);
    const res = await svc.listUsers(1, 1, 20);
    expect(res.items[0].labelCodes).toEqual([]);
  });
});
