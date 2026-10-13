import {
  DEFAULT_JOB_LABEL_NAME,
  hasBlankJobLabelName,
  isDefaultJobLabelName,
  planJobLabelRenames,
} from './job-label-name';
import { JOB_LABEL } from './enum.types';

describe('job label default names (w3c, ops-manual finding 1)', () => {
  it('has an English-neutral default for every built-in label', () => {
    for (const code of Object.values(JOB_LABEL)) {
      expect(DEFAULT_JOB_LABEL_NAME[code]).toBeTruthy();
      expect(DEFAULT_JOB_LABEL_NAME[code]).toMatch(/^[\x20-\x7e]+$/); // no Korean in what new tenants get
    }
  });

  it('recognises the English default and the legacy Korean one as defaults', () => {
    expect(isDefaultJobLabelName('consult', 'Customer Support')).toBe(true);
    expect(isDefaultJobLabelName('consult', 'customer support ')).toBe(true);
    expect(isDefaultJobLabelName('consult', '상담')).toBe(true);
    expect(isDefaultJobLabelName('sales_admin', '영업관리')).toBe(true);
    expect(isDefaultJobLabelName('sales_admin', 'Sales Admin')).toBe(true);
  });

  it('treats an operator-typed name as custom, so it is shown as typed', () => {
    expect(isDefaultJobLabelName('consult', 'CS')).toBe(false);
    expect(isDefaultJobLabelName('sales_admin', 'SA')).toBe(false);
    expect(isDefaultJobLabelName('consult', 'Hỗ trợ khách hàng')).toBe(false);
  });

  it("does not take another label's default for this one's", () => {
    expect(isDefaultJobLabelName('consult', 'Sales Admin')).toBe(false);
    expect(isDefaultJobLabelName('accounting', '상담')).toBe(false);
  });

  it('is false for empty, null and unknown labels', () => {
    expect(isDefaultJobLabelName('consult', '')).toBe(false);
    expect(isDefaultJobLabelName('consult', null)).toBe(false);
    expect(isDefaultJobLabelName('custom_code', 'Customer Support')).toBe(false);
  });
});

describe('planJobLabelRenames — what the Role names dialog sends', () => {
  const labels = [
    { id: 1, code: 'consult', name: 'Hỗ trợ khách hàng', storedName: 'Customer Support' },
    { id: 2, code: 'sales_admin', name: 'SA', storedName: 'SA' },
    { id: 3, code: 'operations', name: 'Vận hành', storedName: '운영' },
  ];

  it('sends nothing for an untouched dialog, so default-named labels keep following the console language', () => {
    expect(planJobLabelRenames(labels, {}, new Set())).toEqual([]);
    // inputs prefilled with what is shown are not changes either
    const same = { consult: 'Hỗ trợ khách hàng', sales_admin: 'SA', operations: 'Vận hành' };
    expect(planJobLabelRenames(labels, same, new Set())).toEqual([]);
  });

  it('sends typed names, trimmed, only for rows that differ', () => {
    const plan = planJobLabelRenames(labels, { consult: '  CS ', sales_admin: 'SA', operations: 'Vận hành' }, new Set());
    expect(plan).toEqual([{ id: 1, code: 'consult', name: 'CS' }]);
  });

  it('"use default" writes the English default, not the localized text on screen', () => {
    const plan = planJobLabelRenames(labels, { sales_admin: 'Kinh doanh' }, new Set(['sales_admin']));
    expect(plan).toEqual([{ id: 2, code: 'sales_admin', name: 'Sales Admin' }]);
  });

  it('"use default" on a label that already has its built-in name is a no-op', () => {
    expect(planJobLabelRenames(labels, {}, new Set(['consult', 'operations']))).toEqual([]);
  });

  it('skips rows with no id and blank text', () => {
    expect(planJobLabelRenames([{ code: 'consult', name: 'X' }], { consult: 'Y' }, new Set())).toEqual([]);
    expect(planJobLabelRenames(labels, { consult: '   ' }, new Set())).toEqual([]);
  });

  it('flags a blank row so Save can be disabled, unless that row is being reset', () => {
    expect(hasBlankJobLabelName(labels, { consult: ' ' }, new Set())).toBe(true);
    expect(hasBlankJobLabelName(labels, { consult: ' ' }, new Set(['consult']))).toBe(false);
    expect(hasBlankJobLabelName(labels, {}, new Set())).toBe(false);
  });
});
