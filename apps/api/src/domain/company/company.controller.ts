import { Body, Controller, Get, HttpStatus, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CAPABILITY, Principal } from '@sharptalk/types';
import { buildPagination, normalizePage } from '@sharptalk/common';
import { CompanyService } from './company.service';
import { AddHotelRequest, ListCompaniesQuery, UpdateCompanyProfileRequest } from './dto/request/company.request';
import { HotelSyncService, parseHotelSn } from '../go2joy/hotel-sync.service';
import { AuditService } from '../audit/audit.service';
import { Paginated } from '../../global/interceptor/transform.interceptor';
import { RequireCapability, RequireMenu } from '../../global/decorator/auth.decorator';
import { CurrentUser } from '../../global/decorator/current-user.decorator';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';

/**
 * B2B company customers (PLN-261022 stage 2) — a tab of the customers screen,
 * so the same menu + capability gates as the customer controller.
 */
@ApiTags('Company')
@Controller('companies')
@RequireMenu('customers')
export class CompanyController {
  constructor(
    private readonly companyService: CompanyService,
    private readonly hotelSync: HotelSyncService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequireCapability(CAPABILITY.CUSTOMER_MANAGE)
  @ApiOperation({ summary: 'List B2B companies (tenant-scoped, paginated)' })
  async list(@CurrentUser() user: Principal, @Query() query: ListCompaniesQuery) {
    const tenantId = this.tenantId(user);
    const { page, size } = normalizePage(query.page, query.size);
    const { items, total } = await this.companyService.list(tenantId, page, size, { q: query.q, region: query.region });
    return new Paginated(items, buildPagination(page, size, total));
  }

  @Get(':id')
  @RequireCapability(CAPABILITY.CUSTOMER_MANAGE)
  @ApiOperation({ summary: 'One company with its contacts and conversations' })
  detail(@CurrentUser() user: Principal, @Param('id', ParseIntPipe) id: number) {
    return this.companyService.detail(this.tenantId(user), id);
  }

  /** Add a Go2Joy hotel by number — confirmed and filled from the Partner API (PLN-261023 D1-③). */
  @Post()
  @RequireCapability(CAPABILITY.CUSTOMER_MANAGE)
  @ApiOperation({ summary: 'Add a Go2Joy hotel as a B2B company (Partner API sync)' })
  async addHotel(@CurrentUser() user: Principal, @Body() body: AddHotelRequest) {
    const tenantId = this.tenantId(user);
    const { company } = await this.hotelSync.syncHotel(tenantId, body.hotel_sn);
    await this.audit.write({
      tenantId,
      actorType: 'user',
      actorId: this.userId(user),
      action: 'company.hotel_added',
      target: `company:${company.id}`,
      metadata: { hotelSn: body.hotel_sn },
    });
    return this.companyService.detail(tenantId, Number(company.id));
  }

  /** Re-read hotel info + room types from the Partner API now. */
  @Post(':id/sync')
  @RequireCapability(CAPABILITY.CUSTOMER_MANAGE)
  @ApiOperation({ summary: 'Sync one hotel from the Go2Joy Partner API' })
  async sync(@CurrentUser() user: Principal, @Param('id', ParseIntPipe) id: number) {
    const tenantId = this.tenantId(user);
    const company = await this.companyService.getOrThrow(tenantId, id);
    const hotelSn = company.externalKey.startsWith('hotel:') ? parseHotelSn(company.externalKey.slice(6)) : null;
    if (hotelSn == null) throw new BusinessException(ERROR_CODE.PARTNER_HOTEL_NOT_FOUND, HttpStatus.BAD_REQUEST);
    await this.hotelSync.syncHotel(tenantId, hotelSn);
    return this.companyService.detail(tenantId, id);
  }

  /** Operator-entered profile fields (PLN-261023 D3). */
  @Patch(':id/profile')
  @RequireCapability(CAPABILITY.CUSTOMER_MANAGE)
  @ApiOperation({ summary: 'Edit the operator-entered hotel profile' })
  async updateProfile(
    @CurrentUser() user: Principal,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateCompanyProfileRequest,
  ) {
    const tenantId = this.tenantId(user);
    const changed = await this.companyService.updateProfile(tenantId, id, body, this.userId(user));
    if (changed.length) {
      // Field names only: values can be a person's name or a registration number.
      await this.audit.write({
        tenantId,
        actorType: 'user',
        actorId: this.userId(user),
        action: 'company.profile_updated',
        target: `company:${id}`,
        metadata: { fields: changed },
      });
    }
    return this.companyService.detail(tenantId, id);
  }

  private userId(user: Principal): number {
    return user.actorType === 'user' ? user.userId : 0;
  }

  private tenantId(user: Principal): number {
    if (user.actorType !== 'user') {
      throw new BusinessException(ERROR_CODE.FORBIDDEN, HttpStatus.FORBIDDEN);
    }
    return user.tenantId;
  }
}
