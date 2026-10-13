import { Body, Controller, Delete, Get, HttpStatus, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Principal, USER_RANK } from '@sharptalk/types';
import { buildPagination, normalizePage } from '@sharptalk/common';
import { RequireRank } from '../../global/decorator/auth.decorator';
import { CurrentUser } from '../../global/decorator/current-user.decorator';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { Paginated } from '../../global/interceptor/transform.interceptor';
import { PilotAdminService } from './pilot-admin.service';
import { PilotMapper } from './pilot.mapper';
import {
  AddPilotHotelRequest,
  ImportPilotHotelsRequest,
  ListPilotHotelsQuery,
  UpdatePilotAccessRequest,
  UpdatePilotHotelRequest,
} from './dto/request/pilot.request';

/**
 * Console API of the pilot allowlist by hotel (PLN-261012 SG-40). Mounted under
 * `tenants/me/…` like the other per-tenant integration settings, which also keeps
 * it clear of `GET tenants/:uuid` (that route only matches a single segment).
 *
 * Same rank rule as the widget exposure restriction it sits next to in the
 * console: Master or Director may READ, only Master may change.
 */
@ApiTags('Tenant pilot')
@Controller('tenants/me/pilot')
export class PilotController {
  constructor(private readonly admin: PilotAdminService) {}

  @Get()
  @RequireRank(USER_RANK.MASTER, USER_RANK.DIRECTOR)
  @ApiOperation({ summary: "This tenant's pilot allowlist switch and list size" })
  async get(@CurrentUser() user: Principal) {
    const { tenantId } = this.actor(user);
    const { stored, counts } = await this.admin.getAccess(tenantId);
    return PilotMapper.toAccess(stored, counts);
  }

  @Put()
  @RequireRank(USER_RANK.MASTER)
  @ApiOperation({ summary: 'Replace the pilot allowlist switch (sent whole)' })
  async update(@CurrentUser() user: Principal, @Body() body: UpdatePilotAccessRequest) {
    const { tenantId, userId } = this.actor(user);
    const { stored, counts } = await this.admin.updateAccess(tenantId, userId, body);
    return PilotMapper.toAccess(stored, counts);
  }

  @Get('hotels')
  @RequireRank(USER_RANK.MASTER, USER_RANK.DIRECTOR)
  @ApiOperation({ summary: 'List pilot hotels (paginated; q = serial prefix or note word)' })
  async listHotels(@CurrentUser() user: Principal, @Query() query: ListPilotHotelsQuery) {
    const { tenantId } = this.actor(user);
    const { page, size } = normalizePage(query.page, query.size);
    const { items, total } = await this.admin.listHotels(tenantId, {
      page,
      size,
      q: query.q,
      active: query.active === undefined ? undefined : query.active === 'true',
    });
    return new Paginated(items.map(PilotMapper.toHotel), buildPagination(page, size, total));
  }

  @Post('hotels')
  @RequireRank(USER_RANK.MASTER)
  @ApiOperation({ summary: 'Add one hotel to the pilot list (idempotent; resumes a paused one)' })
  async addHotel(@CurrentUser() user: Principal, @Body() body: AddPilotHotelRequest) {
    const { tenantId, userId } = this.actor(user);
    return PilotMapper.toHotel(await this.admin.addHotel(tenantId, userId, body));
  }

  @Post('hotels/import')
  @RequireRank(USER_RANK.MASTER)
  @ApiOperation({ summary: 'Paste a list / import a CSV; dry_run previews counts, duplicates and invalid lines' })
  async importHotels(@CurrentUser() user: Principal, @Body() body: ImportPilotHotelsRequest) {
    const { tenantId, userId } = this.actor(user);
    const outcome = await this.admin.importHotels(tenantId, userId, body);
    return PilotMapper.toImport(outcome.plan, outcome);
  }

  @Patch('hotels/:hotelSn')
  @RequireRank(USER_RANK.MASTER)
  @ApiOperation({ summary: 'Pause or resume one hotel without removing it' })
  async setActive(
    @CurrentUser() user: Principal,
    @Param('hotelSn') hotelSn: string,
    @Body() body: UpdatePilotHotelRequest,
  ) {
    const { tenantId, userId } = this.actor(user);
    return PilotMapper.toHotel(await this.admin.setHotelActive(tenantId, userId, hotelSn, body.active));
  }

  @Delete('hotels/:hotelSn')
  @RequireRank(USER_RANK.MASTER)
  @ApiOperation({ summary: 'Remove one hotel from the pilot list' })
  async removeHotel(@CurrentUser() user: Principal, @Param('hotelSn') hotelSn: string) {
    const { tenantId, userId } = this.actor(user);
    await this.admin.removeHotel(tenantId, userId, hotelSn);
    return { hotelSn };
  }

  /** @RequireRank guarantees a tenant user at runtime; narrow for TS. */
  private actor(user: Principal): { tenantId: number; userId: number } {
    if (user.actorType !== 'user') {
      throw new BusinessException(ERROR_CODE.FORBIDDEN, HttpStatus.FORBIDDEN);
    }
    return { tenantId: user.tenantId, userId: user.userId };
  }
}
