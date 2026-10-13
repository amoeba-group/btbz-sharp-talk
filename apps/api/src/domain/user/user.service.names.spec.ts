import { UserService } from './user.service';

/**
 * Role-label rename and staff display name (w3c, ops-manual findings 1 and 13).
 * The service is built positionally with doubles, like the other user.service specs.
 */
function repo(overrides: Record<string, unknown> = {}): never {
  return {
    find: jest.fn(async () => []),
    findOne: jest.fn(async () => null),
    save: jest.fn(async (x: unknown) => x),
    create: jest.fn((x: unknown) => ({ ...(x as object) })),
    delete: jest.fn(),
    ...overrides,
  } as never;
}

function build(opts: { labels?: Array<Record<string, unknown>>; user?: Record<string, unknown> | null } = {}) {
  const labels = opts.labels ?? [];
  const audit = { write: jest.fn(async () => ({})) };
  const user = opts.user === undefined ? null : opts.user;
  const userRepo = repo({
    findOne: jest.fn(async () => user),
    save: jest.fn(async (x: unknown) => x),
    create: jest.fn((x: unknown) => ({ id: 77, ...(x as object) })),
  });
  const labelRepo = repo({
    find: jest.fn(async () => labels),
    findOne: jest.fn(async ({ where }: { where: { id?: unknown } }) =>
      labels.find((l) => String(l.id) === String(where.id)) ?? null,
    ),
    save: jest.fn(async (x: unknown) => x),
  });
  const svc = new UserService(
    userRepo,
    labelRepo,
    repo(),
    repo(),
    audit as never,
    { clearAccountLock: jest.fn() } as never,
    {} as never,
    {} as never,
    { get: jest.fn() } as never,
  );
  return { svc, audit, userRepo, labelRepo };
}

const LABELS = [
  { id: '1', tenantId: 1, code: 'consult', name: 'Customer Support' },
  { id: '2', tenantId: 1, code: 'sales_admin', name: 'Sales Admin' },
];

describe('UserService.updateLabel — the rename path', () => {
  it('renames, trims, and audits the old and new wording', async () => {
    const { svc, audit, labelRepo } = build({ labels: LABELS.map((l) => ({ ...l })) });
    const res = await svc.updateLabel(1, 1, '  CS  ', 9);
    expect(res.name).toBe('CS');
    expect((labelRepo as unknown as { save: jest.Mock }).save).toHaveBeenCalled();
    expect(audit.write).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 1,
        actorType: 'user',
        actorId: 9,
        action: 'job_label.renamed',
        target: 'job_label:1',
        metadata: { code: 'consult', from: 'Customer Support', to: 'CS' },
      }),
    );
  });

  it('refuses a blank name with a validation error', async () => {
    const { svc, audit } = build({ labels: LABELS.map((l) => ({ ...l })) });
    await expect(svc.updateLabel(1, 1, '   ', 9)).rejects.toMatchObject({ errorCode: 'E5003' });
    expect(audit.write).not.toHaveBeenCalled();
  });

  it("refuses another role's name (two roles called CS would be indistinguishable)", async () => {
    const { svc, audit } = build({ labels: LABELS.map((l) => ({ ...l })) });
    await expect(svc.updateLabel(1, 1, 'sales admin', 9)).rejects.toMatchObject({
      errorCode: 'E5004',
      getStatus: expect.any(Function),
    });
    expect(audit.write).not.toHaveBeenCalled();
  });

  it('lets a label keep its own name (re-saving the dialog changes nothing, writes no audit row)', async () => {
    const { svc, audit } = build({ labels: LABELS.map((l) => ({ ...l })) });
    const res = await svc.updateLabel(1, 1, 'Customer Support', 9);
    expect(res.name).toBe('Customer Support');
    expect(audit.write).not.toHaveBeenCalled();
  });

  it('404s on a label of another tenant (the lookup is tenant-fenced)', async () => {
    const { svc, labelRepo } = build({ labels: [] });
    await expect(svc.updateLabel(2, 1, 'CS', 9)).rejects.toMatchObject({ errorCode: 'E5002' });
    expect((labelRepo as unknown as { findOne: jest.Mock }).findOne).toHaveBeenCalledWith({
      where: { id: 1, tenantId: 2 },
    });
  });
});

describe('UserService.updateName / invite name — a name for the people the re-route toast mentions', () => {
  it('sets a trimmed name and audits without the value', async () => {
    const user = { id: 5, tenantId: 1, email: 'a@b.c', name: null, rank: 'staff', status: 'active', mustChangePassword: 0 };
    const { svc, audit } = build({ user: { ...user } });
    const res = await svc.updateName(1, 5, '  Linh Tran ', 9);
    expect(res.name).toBe('Linh Tran');
    const call = audit.write.mock.calls[0] as unknown as [{ action: string; metadata: unknown; target: string }];
    expect(call[0].action).toBe('user.name_changed');
    expect(call[0].target).toBe('user:5');
    expect(JSON.stringify(call[0])).not.toContain('Linh');
  });

  it("'' clears the name", async () => {
    const user = { id: 5, tenantId: 1, email: 'a@b.c', name: 'Old', rank: 'staff', status: 'active', mustChangePassword: 0 };
    const { svc } = build({ user: { ...user } });
    const res = await svc.updateName(1, 5, '', 9);
    expect(res.name).toBeNull();
  });

  it("refuses a user of another tenant (tenant fence)", async () => {
    const user = { id: 5, tenantId: 2, email: 'a@b.c', name: null, rank: 'staff', status: 'active', mustChangePassword: 0 };
    const { svc } = build({ user: { ...user } });
    await expect(svc.updateName(1, 5, 'X', 9)).rejects.toMatchObject({ errorCode: 'E1006' });
  });

  it('invite stores the trimmed display name when one is given', async () => {
    const { svc, userRepo } = build({ user: null });
    // findOne -> null for the duplicate check; create() echoes what the service built.
    await svc.invite(1, 9, 'new@go2joy.example', 'staff', [], 'user', '', '  Mai Le ');
    const created = (userRepo as unknown as { create: jest.Mock }).create.mock.calls[0][0] as { name: string | null };
    expect(created.name).toBe('Mai Le');
  });

  it('invite without a name stores none (the e-mail words are derived at read time, not stored)', async () => {
    const { svc, userRepo } = build({ user: null });
    await svc.invite(1, 9, 'new@go2joy.example', 'staff', []);
    const created = (userRepo as unknown as { create: jest.Mock }).create.mock.calls[0][0] as { name: string | null };
    expect(created.name).toBeNull();
  });
});
