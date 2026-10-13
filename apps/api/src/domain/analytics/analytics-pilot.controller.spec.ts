import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ADMIN_LEVEL, CAPABILITY, JOB_LABEL, Principal, USER_RANK } from '@sharptalk/types';
import { AuthorizationGuard } from '../../global/guard/authorization.guard';
import { BusinessException } from '../../global/exception/business.exception';
import { REQUIRE_MENU_KEY } from '../../global/decorator/auth.decorator';
import { AnalyticsPilotController } from './analytics-pilot.controller';
import { PILOT_EXPORT_MAX_ROWS } from './analytics-pilot.util';
import { CSV_BOM } from './analytics-pilot-csv.util';

/**
 * Who may read the pilot analytics and who may export the conversations (PLN-261012 SG-52), and what
 * the export leaves behind. The permission cases run the REAL AuthorizationGuard against the metadata
 * the decorators actually put on the controller — not a copy of it.
 */
const user = (rank: (typeof USER_RANK)[keyof typeof USER_RANK], labels: string[] = []): Principal =>
  ({ actorType: 'user', userId: 41, tenantId: 7, email: 'x@y.z', rank, labels }) as Principal;

const master = user(USER_RANK.MASTER);
const director = user(USER_RANK.DIRECTOR);
const manager = user(USER_RANK.MANAGER);
const staff = { ...user(USER_RANK.STAFF), labels: [JOB_LABEL.CONSULT] } as Principal;
const admin: Principal = { actorType: 'admin', adminId: 1, email: 'a@x.com', level: ADMIN_LEVEL.SUPER_ADMIN };

const proto = AnalyticsPilotController.prototype;

function canCall(handler: 'report' | 'exportCsv', principal: Principal): boolean {
  const guard = new AuthorizationGuard(new Reflector());
  const ctx = {
    getHandler: () => proto[handler],
    getClass: () => AnalyticsPilotController,
    switchToHttp: () => ({ getRequest: () => ({ user: principal }) }),
  } as unknown as ExecutionContext;
  try {
    return guard.canActivate(ctx);
  } catch (e) {
    if (e instanceof BusinessException) return false;
    throw e;
  }
}

describe('permissions — the real guard against the real decorators', () => {
  it('the JSON report: same gate as the other analytics lenses (analytics.read), so manager and above', () => {
    expect(canCall('report', master)).toBe(true);
    expect(canCall('report', director)).toBe(true);
    expect(canCall('report', manager)).toBe(true);
  });

  it('staff do not hold analytics.read: no report, no export', () => {
    expect(canCall('report', staff)).toBe(false);
    expect(canCall('exportCsv', staff)).toBe(false);
  });

  it('the CSV needs a privileged rank ON TOP of analytics.read: master and director only, never a manager', () => {
    expect(canCall('exportCsv', master)).toBe(true);
    expect(canCall('exportCsv', director)).toBe(true);
    expect(canCall('exportCsv', manager)).toBe(false);
  });

  it('a platform admin has no tenant: refused on both routes by the guard', () => {
    expect(canCall('report', admin)).toBe(false);
    expect(canCall('exportCsv', admin)).toBe(false);
  });

  it('both routes sit behind the Statistics screen gate', () => {
    for (const handler of ['report', 'exportCsv'] as const) {
      expect(Reflect.getMetadata(REQUIRE_MENU_KEY, proto[handler])).toEqual(['statistics']);
    }
  });

  it('the capability the routes ask for is analytics.read (not a new permission)', () => {
    for (const handler of ['report', 'exportCsv'] as const) {
      expect(Reflect.getMetadata('requireCapability', proto[handler])).toEqual([CAPABILITY.ANALYTICS_READ]);
    }
    expect(Reflect.getMetadata('requireRank', proto.exportCsv)).toEqual([USER_RANK.MASTER, USER_RANK.DIRECTOR]);
    expect(Reflect.getMetadata('requireRank', proto.report)).toBeUndefined();
  });
});

// ---- behaviour ------------------------------------------------------------------------------

class FakeRes extends EventEmitter {
  headers: Record<string, string> = {};
  statusCode: number | undefined;
  written: string[] = [];
  ended = false;
  destroyed = false;
  writableFinished = false;
  status(code: number) {
    this.statusCode = code;
    return this;
  }
  setHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  write(chunk: string): boolean {
    this.written.push(chunk);
    return true;
  }
  end() {
    this.ended = true;
    this.writableFinished = true;
  }
  destroy() {
    this.destroyed = true;
  }
}

function build(over: {
  plan?: Partial<{ from: Date; to: Date; rows: unknown[]; truncated: boolean }>;
  chunks?: () => AsyncGenerator<string>;
  prepareError?: Error;
  auditError?: Error;
} = {}) {
  const plan = {
    from: new Date('2026-10-01T00:00:00Z'),
    to: new Date('2026-10-14T00:00:00Z'),
    rows: [{}, {}, {}],
    truncated: false,
    ...over.plan,
  };
  const pilot = {
    report: jest.fn(async () => ({
      group: 'hotel', from: plan.from, to: plan.to, days: 13, timezone: 'UTC', rows: [], rowsTotal: 0,
      totals: {}, adoption: {}, truncated: false, scanned: 0,
    })),
    prepareExport: jest.fn(async () => {
      if (over.prepareError) throw over.prepareError;
      return plan;
    }),
    exportChunks: jest.fn(
      over.chunks ??
        async function* () {
          yield `${CSV_BOM}h\r\n`;
          yield 'r1\r\n';
        },
    ),
  };
  const audit = {
    write: jest.fn(async () => {
      if (over.auditError) throw over.auditError;
      return {};
    }),
  };
  const controller = new AnalyticsPilotController(pilot as never, audit as never);
  return { controller, pilot, audit };
}

describe('GET /analytics/pilot', () => {
  it('maps the snake_case query to the service request and answers in the mapper shape', async () => {
    const { controller, pilot } = build();
    const res = await controller.report(master, { group: 'role', from: '2026-10-01', to: '2026-10-07', hotel_sn: '1721', role: 'manager' });
    expect(pilot.report).toHaveBeenCalledWith(7, { group: 'role', from: '2026-10-01', to: '2026-10-07', hotelSn: '1721', role: 'manager' });
    expect(res).toMatchObject({ group: 'hotel', window: { days: 13, timezone: 'UTC' }, meta: { truncated: false } });
  });

  it('scopes to the caller\'s tenant, whatever the query says', async () => {
    const { controller, pilot } = build();
    await controller.report(manager, { hotel_sn: '1721' });
    expect(pilot.report.mock.calls[0][0]).toBe(7);
  });

  it('a platform admin is refused even if the guard were bypassed (no tenant = no blended totals)', async () => {
    const { controller, pilot } = build();
    await expect(controller.report(admin, {})).rejects.toBeInstanceOf(BusinessException);
    expect(pilot.report).not.toHaveBeenCalled();
  });
});

describe('GET /analytics/pilot/conversations.csv', () => {
  it('sends a UTF-8 CSV attachment with the row count and truncation flag in headers', async () => {
    const { controller } = build({ plan: { rows: new Array(PILOT_EXPORT_MAX_ROWS).fill({}), truncated: true } });
    const res = new FakeRes();
    await controller.exportCsv(master, {}, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['Content-Disposition']).toContain('attachment; filename="pilot-conversations-261001-261013.csv"');
    expect(res.headers['X-Export-Rows']).toBe(String(PILOT_EXPORT_MAX_ROWS));
    expect(res.headers['X-Export-Truncated']).toBe('true');
    expect(res.headers['Access-Control-Expose-Headers']).toContain('X-Export-Truncated');
    expect(res.written.join('').startsWith(CSV_BOM)).toBe(true);
    expect(res.ended).toBe(true);
  });

  it('writes one audit row analytics.pilot_export with counts and the window — nothing from the conversations', async () => {
    const { controller, audit } = build();
    await controller.exportCsv(director, { hotel_sn: '1721' }, new FakeRes() as never);

    expect(audit.write).toHaveBeenCalledTimes(1);
    const row = audit.write.mock.calls[0][0] as unknown as Record<string, any>;
    expect(row).toMatchObject({
      tenantId: 7,
      actorType: 'user',
      actorId: 41,
      action: 'analytics.pilot_export',
      target: 'window:2026-10-01..2026-10-13',
      result: 'success',
      metadata: { rows: 3, truncated: false, aborted: false, hotelFilter: true, roleFilter: false },
    });
    // the filter is recorded as a boolean, never as the hotel it named: no serial, no content, no id
    expect(JSON.stringify(row)).not.toContain('1721');
    expect(Object.keys(row.metadata).sort()).toEqual(['aborted', 'hotelFilter', 'roleFilter', 'rows', 'truncated']);
  });

  it('refuses before any header is written when the request is bad: no file, no audit row', async () => {
    const { controller, audit } = build({ prepareError: new BusinessException({ code: 'E5141', message: 'too long' }) });
    const res = new FakeRes();
    await expect(controller.exportCsv(master, {}, res as never)).rejects.toBeInstanceOf(BusinessException);
    expect(res.headers).toEqual({});
    expect(res.written).toEqual([]);
    expect(audit.write).not.toHaveBeenCalled();
  });

  it('a failure mid-file breaks the connection (not a short file that looks complete), is logged, and still audited as an error', async () => {
    const { controller, audit } = build({
      chunks: async function* () {
        yield `${CSV_BOM}h\r\n`;
        throw new Error('db went away');
      },
    });
    const res = new FakeRes();
    await expect(controller.exportCsv(master, {}, res as never)).resolves.toBeUndefined();
    expect(res.destroyed).toBe(true);
    expect(res.ended).toBe(false);
    expect(audit.write.mock.calls[0][0]).toMatchObject({ result: 'error', action: 'analytics.pilot_export' });
  });

  it('a client that hangs up is recorded as aborted', async () => {
    const { controller, audit } = build({
      chunks: async function* () {
        yield `${CSV_BOM}h\r\n`;
        yield 'r1\r\n';
        yield 'r2\r\n';
      },
    });
    const res = new FakeRes();
    const origWrite = res.write.bind(res);
    res.write = (c: string) => {
      const ok = origWrite(c);
      if (res.written.length === 1) {
        res.destroyed = true;
        res.emit('close');
      }
      return ok;
    };
    await controller.exportCsv(master, {}, res as never);
    expect(res.ended).toBe(false);
    expect(audit.write.mock.calls[0][0]).toMatchObject({ metadata: { aborted: true } });
  });

  it('an audit row that cannot be written never fails the download the user already received', async () => {
    const { controller } = build({ auditError: new Error('audit db down') });
    const res = new FakeRes();
    await expect(controller.exportCsv(master, {}, res as never)).resolves.toBeUndefined();
    expect(res.ended).toBe(true);
  });

  it('a platform admin cannot export (no tenant)', async () => {
    const { controller, pilot } = build();
    await expect(controller.exportCsv(admin, {}, new FakeRes() as never)).rejects.toBeInstanceOf(BusinessException);
    expect(pilot.prepareExport).not.toHaveBeenCalled();
  });

  it('exports for the caller\'s own tenant only', async () => {
    const { controller, pilot } = build();
    await controller.exportCsv(master, { hotel_sn: '1721' }, new FakeRes() as never);
    expect(pilot.prepareExport.mock.calls[0][0]).toBe(7);
    expect(pilot.exportChunks.mock.calls[0][0]).toBe(7);
  });
});
