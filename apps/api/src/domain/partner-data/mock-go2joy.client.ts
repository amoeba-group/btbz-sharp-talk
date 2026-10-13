import type { PartnerCtx } from './partner-ctx';
import type { PartnerTopic } from './partner-data.constants';
import type { PartnerApiClient, PartnerEnvelope } from './partner-api.client';
import type { PartnerQuery } from './partner-params.util';
import { DEFAULT_MOCK_SET } from './fixtures/mock-set-default';
import type { MockSet } from './fixtures/mock-set-default';

const VN_OFFSET_MS = 7 * 3600_000;

/**
 * Fixture-backed stand-in for the Go2Joy partner API (PLN-261012 SG-31), used
 * until Go2Joy delivers the real spec and a key (R8/R9). It answers in the wire
 * shape of the draft contract and — importantly — behaves like the real API is
 * required to:
 *  - the hotel is `ctx.hotelSn` and nothing else; a fixture of another hotel is
 *    unreachable, and a booking code of another hotel is "not found" (null);
 *  - an unknown hotel is "not found";
 *  - the reply echoes the hotel it was computed for.
 * Not an `@Injectable` on purpose: it is built by the module's client factory.
 */
export class MockGo2JoyClient implements PartnerApiClient {
  readonly mode = 'mock' as const;

  constructor(
    private readonly set: MockSet = DEFAULT_MOCK_SET,
    private readonly now: () => number = Date.now,
  ) {}

  async get(ctx: PartnerCtx, topic: PartnerTopic, query: PartnerQuery): Promise<PartnerEnvelope | null> {
    const hotel = this.set[ctx.hotelSn];
    if (!hotel) return null;
    // Deep copy: a caller mutating a reply must not change the fixture.
    const h = structuredClone(hotel);
    const todayMs = this.now();
    const today = new Date(todayMs + VN_OFFSET_MS).toISOString().slice(0, 10);
    const q = (k: string): string | undefined => (query[k] === undefined ? undefined : String(query[k]));

    let data: Record<string, unknown>;
    switch (topic) {
      case 'policies': {
        const type = q('type');
        data = { policies: h.policies.filter((p) => !type || p.type === type) };
        break;
      }
      case 'rates': {
        const date = q('date') ?? today;
        const weekend = [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
        const roomType = q('roomType')?.toUpperCase();
        const rateType = q('rateType');
        data = {
          currency: 'VND',
          rates: h.rates
            .filter((r) => (!roomType || r.roomType === roomType) && (!rateType || r.rateType === rateType))
            .map((r) => {
              const extra = weekend ? r.weekendExtraVnd : 0;
              return {
                roomType: r.roomType,
                roomTypeName: r.roomTypeName,
                rateType: r.rateType,
                date,
                ...(r.includedHours !== undefined ? { includedHours: r.includedHours } : {}),
                ...(r.extraHourVnd !== undefined ? { extraHourVnd: r.extraHourVnd } : {}),
                breakdown: {
                  baseVnd: r.baseVnd,
                  extraVnd: extra,
                  directDiscountVnd: r.directDiscountVnd,
                  flashSaleVnd: r.flashSaleVnd,
                  couponVnd: r.couponVnd,
                  finalVnd: r.baseVnd + extra - r.directDiscountVnd - r.flashSaleVnd - r.couponVnd,
                },
              };
            }),
        };
        break;
      }
      case 'bookings': {
        const code = q('bookingCode');
        if (code) {
          // Only THIS hotel's bookings are searched: another hotel's code is
          // indistinguishable from one that does not exist.
          const found = h.bookings.filter((b) => b.bookingCode === code);
          if (!found.length) return null;
          data = { bookings: found, page: { number: 1, size: 1, total: found.length } };
          break;
        }
        const from = q('checkInFrom');
        const to = q('checkInTo');
        const status = q('status');
        const matching = h.bookings.filter((b) => {
          const day = String(b.checkInAt).slice(0, 10);
          return (!from || day >= from) && (!to || day <= to) && (!status || b.status === status);
        });
        const size = Number(q('size') ?? 20);
        const page = Number(q('page') ?? 1);
        data = {
          bookings: matching.slice((page - 1) * size, page * size),
          page: { number: page, size, total: matching.length },
        };
        break;
      }
      case 'settlement': {
        const period = q('period');
        const status = q('status');
        const matching = h.settlements
          .filter((s) => (!period || s.period === period) && (!status || s.status === status))
          .sort((a, b) => String(b.period).localeCompare(String(a.period)));
        const size = Number(q('size') ?? 20);
        const page = Number(q('page') ?? 1);
        data = {
          settlements: matching.slice((page - 1) * size, page * size),
          page: { number: page, size, total: matching.length },
        };
        break;
      }
    }

    return {
      apiVersion: '0',
      hotelSn: ctx.hotelSn,
      topic,
      generatedAt: new Date(todayMs + VN_OFFSET_MS).toISOString().replace('Z', '+07:00'),
      data,
    };
  }
}
