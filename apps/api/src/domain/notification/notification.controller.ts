import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query, Delete } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { buildPagination, normalizePage } from '@sharptalk/common';
import { NOTIFICATION_SCOPE, type NotificationScope } from '@sharptalk/types';
import { NotificationService } from './notification.service';
import {
  DeleteNotificationsRequest, ReadNotificationRequest,
  SetMarketingOptOutRequest,
  UpdatePrefRequest,
} from './dto/request/notification.request';
import { toNotificationResponse, toPrefResponse } from './notification.mapper';
import { Public } from '../../global/decorator/public.decorator';
import { Paginated } from '../../global/interceptor/transform.interceptor';
import { SessionToken } from '../../global/decorator/session-token.decorator';

/**
 * Only a known scope reaches the service — and therefore the Redis key it is
 * interpolated into. Anything else is treated as absent (the whole feed).
 *
 * Without this, `unread-count` — which is `@SkipThrottle()` because the widget
 * polls it — would mint a new cache entry per distinct junk string a caller
 * sent, letting an authenticated shopper inflate the cache at will.
 */
function parseScope(scope?: string): NotificationScope | undefined {
  return (Object.values(NOTIFICATION_SCOPE) as string[]).includes(scope ?? '')
    ? (scope as NotificationScope)
    : undefined;
}

/** Widget-facing notification endpoints (public; session-token identified). */
@ApiTags('Notification')
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: "List the customer's notifications (FR-030)" })
  async list(
    @SessionToken() token: string,
    @Query('category') category?: string,
    @Query('page') page?: string,
    @Query('size') size?: string,
    // 'order' | 'notice' — which half of the feed "all" means for this caller.
    // Absent = the whole feed (a tenant showing only one list tab).
    @Query('scope') scope?: string,
  ) {
    const { page: p, size: s } = normalizePage(page, size);
    const [items, total] = await this.notificationService.list(
      token,
      category,
      p,
      s,
      parseScope(scope),
    );
    return new Paginated(items.map(toNotificationResponse), buildPagination(p, s, total));
  }

  @Get('unread-count')
  @Public()
  @SkipThrottle() // widget polls this on an interval — exclude from the flood limit
  @ApiOperation({ summary: 'Unread notification count' })
  async unreadCount(@SessionToken() token: string, @Query('scope') scope?: string) {
    const count = await this.notificationService.unreadCount(token, parseScope(scope));
    return { count };
  }

  /**
   * Marketing opt-out — the single control the widget still offers after the
   * category × channel matrix moved to the console
   * (PLN-260817-Widget-Header-Prefs-Cleanup §6.1).
   */
  @Get('marketing-opt-out')
  @Public()
  @ApiOperation({ summary: 'Is this customer refusing marketing messages?' })
  async marketingOptOut(@SessionToken() token: string) {
    return { optOut: await this.notificationService.marketingOptOut(token) };
  }

  @Put('marketing-opt-out')
  @Public()
  @ApiOperation({ summary: 'Set the marketing refusal for every marketing category at once' })
  async setMarketingOptOut(@Body() body: SetMarketingOptOutRequest) {
    return {
      optOut: await this.notificationService.setMarketingOptOut(body.session_token, body.opt_out),
    };
  }

  @Get('prefs')
  @Public()
  @ApiOperation({ summary: 'List notification preferences (channel x category)' })
  async listPrefs(@SessionToken() token: string) {
    const prefs = await this.notificationService.listPrefs(token);
    return prefs.map(toPrefResponse);
  }

  @Put('prefs')
  @Public()
  @ApiOperation({ summary: 'Upsert a notification preference (in_app stays always-on)' })
  async upsertPref(@Body() body: UpdatePrefRequest) {
    const pref = await this.notificationService.upsertPref(
      body.session_token,
      body.channel,
      body.category,
      body.enabled,
    );
    return toPrefResponse(pref);
  }

  @Delete()
  @Public()
  @ApiOperation({ summary: 'Delete notifications (selected ids or all) — shopper-side soft delete (PLN-260916 P3)' })
  async remove(@Body() body: DeleteNotificationsRequest) {
    const deleted = await this.notificationService.remove(body.session_token, { ids: body.ids, all: body.all });
    return { deleted };
  }

  @Post(':id/read')
  @Public()
  @ApiOperation({ summary: 'Mark a notification read (verifies ownership)' })
  async markRead(@Param('id', ParseIntPipe) id: number, @Body() body: ReadNotificationRequest) {
    const notif = await this.notificationService.markRead(body.session_token, id);
    return toNotificationResponse(notif);
  }
}
