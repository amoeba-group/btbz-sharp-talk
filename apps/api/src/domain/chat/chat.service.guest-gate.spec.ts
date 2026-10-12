import { ChatService, partnerContextOf, partnerLabelOf, sysMsg } from './chat.service';
import type { Session } from '../session/entity/session.entity';

/**
 * Guest gate helpers (PLN-261001 v1.1 B5/T4, REQ-261006 H4/H6).
 *
 * The gate's decision inside handleUserMessage is policy × identity × guest
 * evidence; the pieces that shape what the shopper and the CS team read are
 * pinned here: the sign-in line (built-in vs tenant override) and the partner
 * lines derived from signed claims — never from unsigned ones.
 */
describe('ChatService — guest gate helpers', () => {
  const signed = {
    identityClaims: {
      hotelSn: '1721',
      role: 'receptionist',
      hotelName: 'A In Hotel Del Luna',
      hotelCode: 'HCM_001_001721-TC-000',
      signed: true,
      verifiedAt: '2026-10-06T00:00:00.000Z',
    },
  } as unknown as Pick<Session, 'identityClaims'>;

  describe('partnerContextOf (prompt line)', () => {
    it('names the hotel, its signed key, code and role', () => {
      expect(partnerContextOf(signed)).toBe(
        'The user is partner staff of A In Hotel Del Luna (hotelSn 1721, code HCM_001_001721-TC-000), role: receptionist.',
      );
    });

    it('is absent for guests and for claims that were not signed', () => {
      expect(partnerContextOf({ identityClaims: null } as Pick<Session, 'identityClaims'>)).toBeUndefined();
      expect(
        partnerContextOf({
          identityClaims: { ...signed.identityClaims, signed: false },
        } as unknown as Pick<Session, 'identityClaims'>),
      ).toBeUndefined();
    });

    it('falls back to a neutral name when the display name is missing', () => {
      expect(
        partnerContextOf({
          identityClaims: { ...signed.identityClaims, hotelName: null, hotelCode: null },
        } as unknown as Pick<Session, 'identityClaims'>),
      ).toBe('The user is partner staff of the partner hotel (hotelSn 1721), role: receptionist.');
    });
  });

  describe('partnerLabelOf (alerts, ticket notes)', () => {
    it('is one short line', () => {
      expect(partnerLabelOf(signed)).toBe('A In Hotel Del Luna (1721) · receptionist');
    });
    it('is absent without signed claims', () => {
      expect(partnerLabelOf({ identityClaims: null } as Pick<Session, 'identityClaims'>)).toBeUndefined();
    });
  });

  describe('loginRequiredMessage', () => {
    const svc = Object.create(ChatService.prototype) as ChatService;
    const message = (guidance: unknown, lang: string) => {
      (svc as unknown as { rag: unknown }).rag = { guestGuidance: jest.fn(async () => guidance) };
      return (
        svc as unknown as { loginRequiredMessage: (t: number, l: string) => Promise<string> }
      ).loginRequiredMessage(4, lang);
    };

    it('uses the built-in line in the session language when the tenant set none', async () => {
      await expect(message(null, 'VI')).resolves.toBe(sysMsg('loginRequired', 'VI'));
      await expect(message(null, 'EN')).resolves.toBe(sysMsg('loginRequired', 'EN'));
    });

    it("prefers the tenant's wording for that language and falls back per language", async () => {
      const guidance = { notice: { VI: 'Đăng nhập Hotel Admin để được hướng dẫn.' } };
      await expect(message(guidance, 'vi')).resolves.toBe('Đăng nhập Hotel Admin để được hướng dẫn.');
      await expect(message(guidance, 'EN')).resolves.toBe(sysMsg('loginRequired', 'EN'));
    });
  });

  it('ships the sign-in line in all six registered languages', () => {
    for (const lang of ['EN', 'ES', 'KO', 'VI', 'JA', 'ZH']) {
      expect(sysMsg('loginRequired', lang).length).toBeGreaterThan(20);
    }
    expect(sysMsg('loginRequired', 'VI')).toContain('đăng nhập');
  });
});
