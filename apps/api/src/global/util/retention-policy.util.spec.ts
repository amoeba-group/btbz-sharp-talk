import {
  aiProcessingRegionFromEnv,
  conversationRetentionDays,
  DEFAULT_CONVERSATION_RETENTION_DAYS,
  noticeContextFromEnv,
  optionalRetentionDays,
} from './retention-policy.util';

describe('retention policy env parsing (PLN-261012 SG-70)', () => {
  describe('conversationRetentionDays', () => {
    it.each([undefined, null, '', '   ', '0', 0, '-5', 'abc', NaN])(
      'reads %p as the 365-day default, NOT as "keep forever"',
      (raw) => {
        // The old .env.self-hosted.example comment said blank/0 keeps data
        // forever; the purge job has always done the opposite.
        expect(conversationRetentionDays(raw)).toBe(DEFAULT_CONVERSATION_RETENTION_DAYS);
      },
    );

    it('uses a positive number, from a string env value too', () => {
      expect(conversationRetentionDays('180')).toBe(180);
      expect(conversationRetentionDays(30)).toBe(30);
    });
  });

  describe('optionalRetentionDays (opt-in purges: customers, audit_logs)', () => {
    it.each([undefined, null, '', ' ', '0', 0, '-1', 'abc'])('reads %p as OFF', (raw) => {
      expect(optionalRetentionDays(raw)).toBeNull();
    });

    it('accepts a positive number and floors a fraction', () => {
      expect(optionalRetentionDays('400')).toBe(400);
      expect(optionalRetentionDays(90.9)).toBe(90);
    });
  });

  describe('noticeContextFromEnv', () => {
    it('quotes the same numbers the purge job enforces', () => {
      expect(noticeContextFromEnv({ CONVERSATION_LOG_RETENTION_DAYS: '180', AI_PROCESSING_REGION: ' vn ' } as never)).toEqual({
        retentionDays: 180,
        region: 'VN',
      });
    });

    it('defaults to 365 days and US when nothing is set', () => {
      expect(noticeContextFromEnv({} as never)).toEqual({ retentionDays: 365, region: 'US' });
      expect(aiProcessingRegionFromEnv({} as never)).toBe('US');
    });
  });
});
