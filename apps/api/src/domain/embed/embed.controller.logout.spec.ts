import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EmbedController } from './embed.controller';
import { EmbedService } from './embed.service';
import { EmbedLogoutRequest } from './dto/request/embed.request';
import { SessionService } from '../session/session.service';
import { Tenant } from '../tenant/entity/tenant.entity';
import { Customer } from '../customer/entity/customer.entity';
import { Session } from '../session/entity/session.entity';
import { Conversation } from '../chat/entity/conversation.entity';
import { RedisService } from '../../infrastructure/cache/redis.service';
import { IS_PUBLIC_KEY } from '../../global/decorator/public.decorator';

/**
 * `POST /public/embed/logout` wiring (PLN-261012 SG-02).
 *
 * The service logic is covered in embed.service.rebind.spec.ts; what is pinned
 * here is what a unit test of the service cannot see: the route is public (a
 * widget has no JWT), Nest can build the service with the Conversation
 * repository the logout needs, the body is validated as snake_case, and the
 * controller hands the token straight to the service.
 */
describe('EmbedController.logout', () => {
  async function build() {
    const repo = () => ({ findOne: jest.fn(), update: jest.fn(), save: jest.fn(), create: jest.fn() });
    const moduleRef = await Test.createTestingModule({
      controllers: [EmbedController],
      providers: [
        EmbedService,
        { provide: getRepositoryToken(Tenant), useValue: repo() },
        { provide: getRepositoryToken(Customer), useValue: repo() },
        { provide: getRepositoryToken(Session), useValue: repo() },
        { provide: getRepositoryToken(Conversation), useValue: repo() },
        { provide: RedisService, useValue: { del: jest.fn() } },
        { provide: SessionService, useValue: {} },
      ],
    }).compile();
    return { controller: moduleRef.get(EmbedController), service: moduleRef.get(EmbedService) };
  }

  it('is a public route — the widget calls it before any JWT exists', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, EmbedController.prototype.logout)).toBe(true);
  });

  it('is built with the Conversation repository, so logout can end the AI thread', async () => {
    const { service } = await build();
    expect((service as unknown as { convRepo?: unknown }).convRepo).toBeDefined();
  });

  it('hands the snake_case session_token to the service and returns its result as-is', async () => {
    const { controller, service } = await build();
    const spy = jest.spyOn(service, 'logout').mockResolvedValue({ loggedOut: true });

    await expect(controller.logout({ session_token: 'tok' })).resolves.toEqual({ loggedOut: true });

    expect(spy).toHaveBeenCalledWith('tok');
  });

  it('validates the body the way the global pipe does: a token is required', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false });
    const meta = { type: 'body' as const, metatype: EmbedLogoutRequest };

    await expect(pipe.transform({ session_token: 'tok' }, meta)).resolves.toMatchObject({ session_token: 'tok' });
    await expect(pipe.transform({}, meta)).rejects.toBeDefined();
    await expect(pipe.transform({ session_token: 123 }, meta)).rejects.toBeDefined();
  });
});
