import { Body, Controller, Get, HttpStatus, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CAPABILITY, Principal } from '@sharptalk/types';
import { OrderService } from './order.service';
import { GuestLookupRequest, OrderListQuery } from './dto/request/order.request';
import { Public } from '../../global/decorator/public.decorator';
import { RequireCapability } from '../../global/decorator/auth.decorator';
import { CurrentUser } from '../../global/decorator/current-user.decorator';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { SessionToken } from '../../global/decorator/session-token.decorator';

/** Widget + admin order endpoints (FR-019/020/021). */
@ApiTags('Orders')
@Controller('orders')
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  @Post('guest-lookup')
  @Public()
  @ApiOperation({ summary: 'Guest order lookup; binds session on success (FR-019)' })
  async guestLookup(@Body() body: GuestLookupRequest) {
    return this.orderService.guestLookup(body.session_token, body.order_number, body.email);
  }

  @Get()
  @Public()
  @ApiOperation({ summary: "List the session customer's orders (FR-020)" })
  async list(@SessionToken() token: string, @Query() query: OrderListQuery) {
    return this.orderService.listForSession(token, query.page, query.size, query.days);
  }

  // Declared before ':id' — otherwise ParseIntPipe claims "review-items" and 400s.
  @Get('review-items')
  @Public()
  @ApiOperation({ summary: "Delivered lines the session customer can review (PLN-260923 P3)" })
  async reviewItems(@SessionToken() token: string) {
    return this.orderService.reviewItemsForSession(token);
  }

  @Get(':id')
  @Public()
  @ApiOperation({ summary: 'Order detail with line items (FR-020)' })
  async detail(@Param('id', ParseIntPipe) id: number, @SessionToken() token: string) {
    return this.orderService.detailForSession(token, id);
  }

  @Get(':id/tracking')
  @Public()
  @ApiOperation({ summary: 'Latest fulfillment + delivery stepper (FR-031)' })
  async tracking(@Param('id', ParseIntPipe) id: number, @SessionToken() token: string) {
    return this.orderService.trackingForSession(token, id);
  }
}

/** Admin order list (operations module). */
@ApiTags('Orders')
@Controller('admin/orders')
export class AdminOrderController {
  constructor(private readonly orderService: OrderService) {}

  @Get()
  @RequireCapability(CAPABILITY.MODULE_OPERATIONS)
  @ApiOperation({ summary: 'List all orders (admin)' })
  async list(
    @CurrentUser() user: Principal,
    @Query('page') page?: string,
    @Query('size') size?: string,
  ) {
    return this.orderService.listAll(this.tenantId(user), page, size);
  }

  private tenantId(user: Principal): number {
    if (user.actorType !== 'user') {
      throw new BusinessException(ERROR_CODE.FORBIDDEN, HttpStatus.FORBIDDEN);
    }
    return user.tenantId;
  }
}
