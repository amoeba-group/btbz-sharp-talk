import { vnRegionPresetRules } from '@sharptalk/types';
import {
  REGION_LABEL_MAX_LEN,
  REGION_PROVINCE_MAX_LEN,
  REGION_PROVINCES_PER_CATEGORY_MAX,
  sanitizeRegionRouting,
} from './region-routing.util';
import { AiConfigService } from './ai-config.service';
import { BusinessException } from '../../global/exception/business.exception';

/**
 * Server-side check of handoff_config.regionRouting (PLN-261012 SG-65, D-14).
 * The column used to be saved as typed — the DTO is only @IsObject — so anything an
 * API client sent reached the matcher on every hand-off.
 */
function rejection(input: unknown): BusinessException {
  try {
    sanitizeRegionRouting(input);
  } catch (e) {
    expect(e).toBeInstanceOf(BusinessException);
    return e as BusinessException;
  }
  throw new Error('expected a rejection');
}

describe('sanitizeRegionRouting — accepted', () => {
  it('passes the Vietnam preset through untouched', () => {
    const categories = vnRegionPresetRules();
    const out = sanitizeRegionRouting({ enabled: true, categories });
    expect(out).toEqual({ enabled: true, categories });
  });

  it('removes the table for null / undefined', () => {
    expect(sanitizeRegionRouting(null)).toBeUndefined();
    expect(sanitizeRegionRouting(undefined)).toBeUndefined();
  });

  it('accepts a table with no categories yet', () => {
    expect(sanitizeRegionRouting({ enabled: false })).toEqual({ enabled: false });
    expect(sanitizeRegionRouting({})).toEqual({ enabled: false });
    expect(sanitizeRegionRouting({ enabled: true, categories: [] })).toEqual({ enabled: true, categories: [] });
  });

  it('trims, drops blank provinces and collapses exact repeats', () => {
    const out = sanitizeRegionRouting({
      enabled: true,
      categories: [{ id: 'north', team: 'north', provinces: ['  Hà Nội ', '', '   ', 'Hà Nội', 'Hải Phòng'] }],
    });
    expect(out?.categories?.[0].provinces).toEqual(['Hà Nội', 'Hải Phòng']);
  });

  it('gives a missing team the category default, and keeps a team the tenant chose', () => {
    const out = sanitizeRegionRouting({
      enabled: true,
      categories: [
        { id: 'north_central', provinces: [] },
        { id: 'south_central', team: 'north', provinces: [] }, // a tenant may reassign a category
      ],
    });
    expect(out?.categories?.map((c) => c.team)).toEqual(['north', 'north']);
  });

  it('stores only the known fields of a row', () => {
    const out = sanitizeRegionRouting({
      enabled: true,
      categories: [{ id: 'south', team: 'south', provinces: ['Cần Thơ'], rogue: '<script>', extra: { a: 1 } }],
    });
    expect(out?.categories?.[0]).toEqual({ id: 'south', team: 'south', provinces: ['Cần Thơ'] });
  });

  it('keeps per-language labels for known languages only, trimmed', () => {
    const out = sanitizeRegionRouting({
      enabled: true,
      categories: [
        { id: 'south', team: 'south', provinces: [], label: { EN: '  Mekong ', VI: 'Miền Tây', XX: 'nope', KO: '  ' } },
      ],
    });
    expect(out?.categories?.[0].label).toEqual({ EN: 'Mekong', VI: 'Miền Tây' });
  });

  it('accepts provinces at the limits', () => {
    const longest = 'x'.repeat(REGION_PROVINCE_MAX_LEN);
    const many = Array.from({ length: REGION_PROVINCES_PER_CATEGORY_MAX }, (_, i) => `P${i}`);
    expect(() =>
      sanitizeRegionRouting({
        enabled: true,
        categories: [
          { id: 'north', team: 'north', provinces: [longest] },
          { id: 'south', team: 'south', provinces: many },
        ],
      }),
    ).not.toThrow();
  });
});

describe('sanitizeRegionRouting — rejected (E5095, 400)', () => {
  const row = (over: Record<string, unknown> = {}) => ({ id: 'north', team: 'north', provinces: ['Hà Nội'], ...over });

  it.each([
    ['a string', 'north'],
    ['an array', []],
    ['a number', 5],
  ])('a table that is %s', (_name, value) => {
    const e = rejection(value);
    expect(e.errorCode).toBe('E5095');
    expect(e.getStatus()).toBe(400);
  });

  it('a non-boolean enabled', () => {
    expect(rejection({ enabled: 'yes' }).errorCode).toBe('E5095');
    expect(rejection({ enabled: 1 }).errorCode).toBe('E5095');
  });

  it('categories that is not an array, or has more than four rows', () => {
    expect(rejection({ enabled: true, categories: { id: 'north' } }).errorCode).toBe('E5095');
    const five = ['north', 'north_central', 'south_central', 'south', 'north'].map((id) => row({ id }));
    expect(rejection({ enabled: true, categories: five }).errorCode).toBe('E5095');
  });

  it('a row that is not an object', () => {
    expect(rejection({ enabled: true, categories: ['north'] }).errorCode).toBe('E5095');
    expect(rejection({ enabled: true, categories: [null] }).errorCode).toBe('E5095');
  });

  it('an empty, missing or unknown category id', () => {
    for (const id of ['', '   ', undefined, 7, 'central', 'NORTH', 'tay_nguyen']) {
      expect(rejection({ enabled: true, categories: [row({ id })] }).errorCode).toBe('E5095');
    }
  });

  it('a category listed twice', () => {
    const e = rejection({ enabled: true, categories: [row(), row({ provinces: ['Hải Phòng'] })] });
    expect(e.details?.regionRouting?.[0]).toContain('twice');
  });

  it('a team outside north / south', () => {
    for (const team of ['west', 'NORTH', '', 3, {}]) {
      expect(rejection({ enabled: true, categories: [row({ team })] }).errorCode).toBe('E5095');
    }
  });

  it('provinces that is not an array, or holds a non-string', () => {
    expect(rejection({ enabled: true, categories: [row({ provinces: 'Hà Nội, Hải Phòng' })] }).errorCode).toBe('E5095');
    expect(rejection({ enabled: true, categories: [row({ provinces: ['Hà Nội', 79] })] }).errorCode).toBe('E5095');
    expect(rejection({ enabled: true, categories: [row({ provinces: [null] })] }).errorCode).toBe('E5095');
    expect(rejection({ enabled: true, categories: [row({ provinces: [['Hà Nội']] })] }).errorCode).toBe('E5095');
  });

  it('a province over the length limit, or too many provinces under one category', () => {
    const tooLong = 'x'.repeat(REGION_PROVINCE_MAX_LEN + 1);
    expect(rejection({ enabled: true, categories: [row({ provinces: [tooLong] })] }).errorCode).toBe('E5095');
    const many = Array.from({ length: REGION_PROVINCES_PER_CATEGORY_MAX + 1 }, (_, i) => `P${i}`);
    expect(rejection({ enabled: true, categories: [row({ provinces: many })] }).errorCode).toBe('E5095');
  });

  it('a label that is not an object, or over the length limit', () => {
    expect(rejection({ enabled: true, categories: [row({ label: 'Miền Bắc' })] }).errorCode).toBe('E5095');
    expect(
      rejection({ enabled: true, categories: [row({ label: { EN: 'x'.repeat(REGION_LABEL_MAX_LEN + 1) } })] }).errorCode,
    ).toBe('E5095');
  });

  it('says which row is wrong', () => {
    const e = rejection({ enabled: true, categories: [row(), row({ id: 'south', team: 'moon' })] });
    expect(e.details?.regionRouting?.[0]).toContain('categories[1].team');
  });
});

/** Where the check sits: every write of the handoff config goes through upsertConfig. */
describe('AiConfigService.upsertConfig — region table is validated on write', () => {
  function build() {
    const row: Record<string, unknown> = { tenantId: 1, handoffConfig: null };
    const configRepo = {
      findOne: jest.fn(async () => row),
      create: jest.fn((v: Record<string, unknown>) => v),
      save: jest.fn(async (v: Record<string, unknown>) => v),
    };
    const svc = new AiConfigService(
      configRepo as never,
      { findOne: jest.fn(async () => null) } as never,
      { findOne: jest.fn(async () => null) } as never,
      { findOne: jest.fn(async () => ({ id: 1 })) } as never,
      { available: () => false, get: jest.fn(), set: jest.fn(), del: jest.fn() } as never,
      { record: jest.fn() } as never,
      {} as never,
    );
    return { svc, configRepo, row };
  }

  it('refuses a malformed table and stores nothing', async () => {
    const h = build();
    await expect(
      h.svc.upsertConfig(1, {
        handoffConfig: { regionRouting: { enabled: true, categories: [{ id: 'north', team: 'moon', provinces: [] }] } } as never,
      }),
    ).rejects.toMatchObject({ errorCode: 'E5095' });
    expect(h.configRepo.save).not.toHaveBeenCalled();
  });

  it('stores the cleaned table and leaves the rest of the handoff config alone', async () => {
    const h = build();
    await h.svc.upsertConfig(1, {
      handoffConfig: {
        assigneeUserIds: [9],
        sla: { normalHours: 24 },
        regionRouting: {
          enabled: true,
          categories: [{ id: 'south', team: 'south', provinces: [' Cần Thơ ', ''] }],
        },
      },
    });
    const stored = (h.configRepo.save.mock.calls[0][0] as { handoffConfig: Record<string, unknown> }).handoffConfig;
    expect(stored.assigneeUserIds).toEqual([9]);
    expect(stored.sla).toEqual({ normalHours: 24 });
    expect(stored.regionRouting).toEqual({
      enabled: true,
      categories: [{ id: 'south', team: 'south', provinces: ['Cần Thơ'] }],
    });
  });

  it('a handoff config without a table is stored exactly as sent', async () => {
    const h = build();
    const handoff = { assigneeUserIds: [1, 2], offHours: { email: 'a@b.c' } };
    await h.svc.upsertConfig(1, { handoffConfig: handoff });
    expect((h.configRepo.save.mock.calls[0][0] as { handoffConfig: unknown }).handoffConfig).toBe(handoff);
  });

  it('a null table removes it', async () => {
    const h = build();
    await h.svc.upsertConfig(1, { handoffConfig: { assigneeUserIds: [1], regionRouting: null } as never });
    expect(
      (h.configRepo.save.mock.calls[0][0] as { handoffConfig: Record<string, unknown> }).handoffConfig,
    ).toEqual({ assigneeUserIds: [1] });
  });
});
