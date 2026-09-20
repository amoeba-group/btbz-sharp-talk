import { maskEmail, maskIdentityLabel, maskName, maskPhone } from './pii-display.util';

describe('pii-display.util', () => {
  describe('maskEmail', () => {
    it('keeps a two-character head and the domain', () => {
      expect(maskEmail('hong.gildong@gmail.com')).toBe('ho***@gmail.com');
    });

    it('keeps only one character when the local part is short', () => {
      expect(maskEmail('ab@x.com')).toBe('a***@x.com');
      expect(maskEmail('a@x.com')).toBe('a***@x.com');
    });

    it('never returns something that could be mistaken for an address', () => {
      expect(maskEmail('not-an-email')).toBe('***');
      expect(maskEmail('@x.com')).toBe('***');
      expect(maskEmail('x@')).toBe('***');
    });

    it('passes null/blank through as null so a missing value stays missing', () => {
      expect(maskEmail(null)).toBeNull();
      expect(maskEmail(undefined)).toBeNull();
      expect(maskEmail('   ')).toBeNull();
    });
  });

  describe('maskPhone', () => {
    it('keeps the last four digits only', () => {
      expect(maskPhone('+82 10-1234-5678')).toBe('***-5678');
      expect(maskPhone('(415) 555-0100')).toBe('***-0100');
    });

    it('masks everything when there is nothing to confirm with', () => {
      expect(maskPhone('12')).toBe('***');
      expect(maskPhone('n/a')).toBe('***');
    });

    it('passes null/blank through as null', () => {
      expect(maskPhone(null)).toBeNull();
      expect(maskPhone('')).toBeNull();
    });
  });

  describe('maskName', () => {
    it('keeps the first and last character of each token', () => {
      expect(maskName('홍길동')).toBe('홍*동');
      expect(maskName('LISA ANDRE')).toBe('L**A A***E');
    });

    it('handles one- and two-character names', () => {
      expect(maskName('Bo')).toBe('B*');
      expect(maskName('A')).toBe('*');
    });

    it('preserves the original spacing', () => {
      expect(maskName('Ann  Lee')).toBe('A*n  L*e');
    });

    it('never leaks a full name through padding', () => {
      // Every masked token must differ from its source unless it is a single
      // character (which is already no more identifying than a mask).
      for (const name of ['홍길동', 'Kim', 'LISA ANDRE', 'Bo']) {
        expect(maskName(name)).not.toBe(name);
      }
    });
  });

  describe('maskIdentityLabel', () => {
    it('prefers the name and falls back to the email', () => {
      expect(maskIdentityLabel('홍길동', 'a@b.com')).toBe('홍*동');
      expect(maskIdentityLabel(null, 'hong@b.com')).toBe('ho***@b.com');
      expect(maskIdentityLabel(null, null)).toBeNull();
    });
  });
});
