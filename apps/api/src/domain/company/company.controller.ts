import { Controller, Get, HttpStatus, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CAPABILITY, Principal } from '@sharptalk/types';
import { buildPagination, normalizePage } from '@sharptalk/common';
import { CompanyService } from './company.service';
import { ListCompaniesQuery } from './dto/request/company.request';
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
  constructor(private readonly companyService: CompanyService) {}

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

  private tenantId(user: Principal): number {
    if (user.actorType !== 'user') {
      throw new BusinessException(ERROR_CODE.FORBIDDEN, HttpStatus.FORBIDDEN);
    }
    return user.tenantId;
  }
}
