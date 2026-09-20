import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CAPABILITY, Principal } from '@sharptalk/types';
import { buildPagination, normalizePage } from '@sharptalk/common';
import { CustomerService } from './customer.service';
import { CustomerMapper } from './customer.mapper';
import {
  ListCustomersQuery,
  SearchCustomersRequest,
  UpdateCustomerRequest,
} from './dto/request/customer.request';
import { Paginated } from '../../global/interceptor/transform.interceptor';
import { RequireCapability, RequireMenu } from '../../global/decorator/auth.decorator';
import { CurrentUser } from '../../global/decorator/current-user.decorator';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';

@ApiTags('Customer')
@Controller('customers')
// Screen gate (PLN-260812 S4): Live chat looks customers up through /agent/customers/search, not this controller.
@RequireMenu('customers')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Get()
  @RequireCapability(CAPABILITY.CUSTOMER_MANAGE)
  @ApiOperation({ summary: 'List customers (tenant-scoped, paginated)' })
  async list(@CurrentUser() user: Principal, @Query() query: ListCustomersQuery) {
    const tenantId = this.tenantId(user);
    const { page, size } = normalizePage(query.page, query.size);
    const { items, total, stats } = await this.customerService.list(
      tenantId,
      page,
      size,
      query.email,
    );
    return new Paginated(
      CustomerMapper.toCustomerList(items, stats),
      buildPagination(page, size, total),
    );
  }

  @Post('search')
  @RequireCapability(CAPABILITY.CUSTOMER_MANAGE)
  @ApiOperation({ summary: 'Search customers with the term in the body (keeps it out of logs)' })
  async search(@CurrentUser() user: Principal, @Body() body: SearchCustomersRequest) {
    const tenantId = this.tenantId(user);
    const { page, size } = normalizePage(body.page, body.size);
    const { items, total, stats } = await this.customerService.list(tenantId, page, size, body.email);
    return new Paginated(
      CustomerMapper.toCustomerList(items, stats),
      buildPagination(page, size, total),
    );
  }

  @Get(':id')
  @RequireCapability(CAPABILITY.CUSTOMER_MANAGE)
  @ApiOperation({ summary: 'Get a customer by id (tenant-scoped)' })
  async get(@CurrentUser() user: Principal, @Param('id', ParseIntPipe) id: number) {
    const tenantId = this.tenantId(user);
    const customer = await this.customerService.findById(tenantId, id);
    return CustomerMapper.toCustomer(customer);
  }

  /**
   * The unmasked record for ONE customer (PLN-260920).
   *
   * Separate route rather than a `?reveal=1` flag on the list: a privacy event
   * should be impossible to trigger by accident, has its own capability, its
   * own rate limit, and leaves its own audit row. A flag on a paginated list
   * would hand over a whole page of contact details in a single request.
   */
  @Get(':id/reveal')
  @RequireCapability(CAPABILITY.CUSTOMER_PII_REVEAL)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Reveal one customer\'s unmasked contact details (audited)' })
  async reveal(@CurrentUser() user: Principal, @Param('id', ParseIntPipe) id: number) {
    const tenantId = this.tenantId(user);
    const customer = await this.customerService.reveal(tenantId, id, this.actorId(user));
    return CustomerMapper.toCustomer(customer, undefined, { reveal: true });
  }

  @Patch(':id')
  @RequireCapability(CAPABILITY.CUSTOMER_MANAGE)
  @ApiOperation({ summary: 'Update a customer (name/tier)' })
  async update(
    @CurrentUser() user: Principal,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateCustomerRequest,
  ) {
    const tenantId = this.tenantId(user);
    const customer = await this.customerService.update(tenantId, id, {
      name: body.name,
      tier: body.tier,
    });
    // Echo back only what was writable. The old response returned the whole
    // record, so a tier change also handed over the email and phone.
    return CustomerMapper.toCustomerSummary(customer);
  }

  private actorId(user: Principal): number {
    if (user.actorType !== 'user') {
      throw new BusinessException(ERROR_CODE.FORBIDDEN, HttpStatus.FORBIDDEN);
    }
    return user.userId;
  }

  private tenantId(user: Principal): number {
    if (user.actorType !== 'user') {
      throw new BusinessException(ERROR_CODE.FORBIDDEN, HttpStatus.FORBIDDEN);
    }
    return user.tenantId;
  }
}
