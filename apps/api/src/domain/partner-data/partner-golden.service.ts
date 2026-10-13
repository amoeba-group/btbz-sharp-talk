import { Injectable } from '@nestjs/common';
import { MOCK_SETS } from './fixtures/mock-set-default';
import { MockGo2JoyClient } from './mock-go2joy.client';
import { PartnerDataService } from './partner-data.service';
import { PartnerDataStep } from './partner-data.step';
import type { PartnerPrepared } from './partner-data.step';
import type { PartnerFlagService } from './partner-flag.service';
import type { PartnerLookupLogService } from './partner-lookup-log.service';
import type { GoldenPartnerCtx } from './partner-golden.util';

/** A log sink that drops everything: golden runs are not customer traffic. */
const NO_LOGS = { record: async () => undefined } as unknown as PartnerLookupLogService;
/** A switch that is always on: a golden question that names a partner context WANTS the lookup. */
const ALWAYS_ON = { serverEnabled: () => true, isEnabled: async () => true } as unknown as PartnerFlagService;

/**
 * Prepares the partner-data block for a regression (golden) question
 * (PLN-261012 SG-31). `GoldenService` asks through `KnowledgeService.ask`, which
 * bypasses ChatService — so this is the thin entry that runs the SAME step the
 * chat runs (detection, closed params, role allow-list, projection, formatting),
 * but always against a named MOCK fixture set: a golden run is deterministic and
 * never touches the live partner API, whatever PARTNER_API_MODE is, and it works
 * whether or not the tenant has switched the lookup on.
 */
@Injectable()
export class PartnerGoldenService {
  async prepare(
    tenantId: number,
    fixture: GoldenPartnerCtx,
    question: string,
    language: string,
  ): Promise<PartnerPrepared | null> {
    const set = MOCK_SETS[fixture.mockSet ?? 'default'];
    if (!set) throw new Error(`unknown mock set "${fixture.mockSet}"`);
    const step = new PartnerDataStep(
      ALWAYS_ON,
      new PartnerDataService(new MockGo2JoyClient(set), NO_LOGS),
      NO_LOGS,
    );
    return step.prepare({
      tenantId,
      // Claims as identify v2 would have produced them for this hotel and role.
      // They go through partnerCtxOf like any session's, so the same
      // signed/fresh checks apply.
      session: {
        id: 0,
        tenantId,
        identityClaims: {
          hotelSn: fixture.hotelSn,
          role: fixture.role,
          signed: true,
          verifiedAt: new Date(Date.now()).toISOString(),
        },
      },
      conversationId: 0,
      messageId: 0,
      text: question,
      language,
    });
  }
}
