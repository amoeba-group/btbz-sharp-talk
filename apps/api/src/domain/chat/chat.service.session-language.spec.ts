import { ChatService } from './chat.service';
import type { Session } from '../session/entity/session.entity';

/**
 * Following the shopper's language (PLN-260813 P2).
 *
 * Two failure directions are pinned here: never switching (the original bug —
 * Korean conversations carrying English notices) and switching too eagerly (one
 * "thanks" turning the rest of a Korean conversation English).
 */
describe('ChatService.syncSessionLanguage', () => {
  const svc = Object.create(ChatService.prototype) as ChatService;

  let previousBody: string | null;
  let applied: string[];

  beforeEach(() => {
    previousBody = null;
    applied = [];
    (svc as unknown as { msgRepo: unknown }).msgRepo = {
      // [current turn, previous turn] — the current one is already persisted.
      find: jest.fn(async () =>
        previousBody === null ? [{ id: 2, body: 'current' }] : [{ id: 2, body: 'current' }, { id: 1, body: previousBody }],
      ),
    };
    (svc as unknown as { sessionService: unknown }).sessionService = {
      applyDetectedLanguage: jest.fn(async (_s: Session, lang: string) => {
        applied.push(lang);
      }),
    };
  });

  const session = (over: Partial<Session> = {}): Session =>
    ({ id: 1, language: 'EN', languageLocked: 0, ...over }) as Session;

  const sync = (s: Session, text: string): Promise<void> =>
    (
      svc as unknown as {
        syncSessionLanguage: (s: Session, c: number, t: string) => Promise<void>;
      }
    ).syncSessionLanguage(s, 10, text);

  it('switches after two consecutive Korean turns (conversation 208)', async () => {
    previousBody = '뉴욕 날씨 알려주시오';
    await sync(session(), '배송 언제 오나요?');
    expect(applied).toEqual(['KO']);
  });

  it('does not switch on the first Korean turn', async () => {
    previousBody = 'How long does shipping take?';
    await sync(session(), '배송 언제 오나요?');
    expect(applied).toEqual([]);
  });

  it('does not switch when there is no previous turn at all', async () => {
    previousBody = null;
    await sync(session(), '배송 언제 오나요?');
    expect(applied).toEqual([]);
  });

  it('does not flip a Korean conversation on a short English aside', async () => {
    // The flip-flop regression: "ok" detects as nothing, so it can neither
    // switch the language nor pair with a later English turn.
    previousBody = '배송 언제 오나요?';
    await sync(session({ language: 'KO' }), 'ok');
    expect(applied).toEqual([]);
  });

  it('does not switch when a short message sits between two English turns', async () => {
    previousBody = 'ok';
    await sync(session({ language: 'KO' }), 'I want to cancel my order');
    expect(applied).toEqual([]);
  });

  it('leaves a hand-picked language alone', async () => {
    previousBody = '뉴욕 날씨 알려주시오';
    await sync(session({ languageLocked: 1 }), '배송 언제 오나요?');
    expect(applied).toEqual([]);
  });

  it('does not touch a session already in the detected language', async () => {
    previousBody = 'How long does shipping take?';
    await sync(session({ language: 'EN' }), 'I want to cancel my order');
    expect(applied).toEqual([]);
  });

  it('switches to Spanish on two marked turns', async () => {
    previousBody = '¿Cuándo llega mi pedido?';
    await sync(session(), 'Mi pedido no ha llegado todavía');
    expect(applied).toEqual(['ES']);
  });

  it('reads a Korean sentence with English tokens as Korean', async () => {
    previousBody = '배송 언제 오나요? shipping';
    await sync(session(), 'iPhone 케이스 재고 있나요');
    expect(applied).toEqual(['KO']);
  });

  it('skips the query entirely for a locked session', async () => {
    const find = (svc as unknown as { msgRepo: { find: jest.Mock } }).msgRepo.find;
    await sync(session({ languageLocked: 1 }), '배송 언제 오나요?');
    expect(find).not.toHaveBeenCalled();
  });

  // FIX-260916 — Vietnamese used to detect as Spanish, so a Go2Joy session
  // that started in Vietnamese was moved to Spanish by its own shopper.
  it('keeps a Vietnamese session Vietnamese across Vietnamese turns (the Go2Joy regression)', async () => {
    previousBody = 'Cho tôi hỏi giá phòng qua đêm';
    await sync(session({ language: 'VI' }), 'Khách sạn còn phòng không?');
    expect(applied).toEqual([]);
  });

  it('keeps a Vietnamese session Vietnamese on acute-only turns that look Spanish out of context', async () => {
    previousBody = 'có xe máy';
    await sync(session({ language: 'VI' }), 'có bán cá');
    expect(applied).toEqual([]);
  });

  it('switches an English session to Vietnamese after two Vietnamese turns', async () => {
    previousBody = 'Tôi muốn đặt phòng theo giờ';
    await sync(session({ language: 'EN' }), 'Còn phòng trống tối nay không ạ?');
    expect(applied).toEqual(['VI']);
  });

  it('still switches a Vietnamese session to English on two plain-ASCII turns', async () => {
    previousBody = 'How long does check-in take?';
    await sync(session({ language: 'VI' }), 'Can I talk to a real person?');
    expect(applied).toEqual(['EN']);
  });
});
