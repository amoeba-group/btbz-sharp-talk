import { Body, Controller, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Principal, USER_RANK } from '@sharptalk/types';
import { OperatorDsarService } from './operator-dsar.service';
import { DsarEraseRequest, DsarExportRequest, DsarLookupRequest } from './dto/request/operator-dsar.request';
import { RequireRank } from '../../global/decorator/auth.decorator';
import { CurrentUser } from '../../global/decorator/current-user.decorator';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';

/**
 * Operator-side data-subject requests (PLN-261012 SG-70): look a customer up
 * and export or erase their data on their behalf.
 *
 * Master and director only — the same ranks that may reveal contact details —
 * and every route is tenant-scoped through the caller's own tenant, never a
 * tenant id from the request. Controller is glue; the rules live in
 * OperatorDsarService.
 */
@ApiTags('Privacy')
@Controller('privacy/operator')
@RequireRank(USER_RANK.MASTER, USER_RANK.DIRECTOR)
export class OperatorDsarController {
  constructor(private readonly dsar: OperatorDsarService) {}

  @Post('lookup')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Find a customer by email / phone / external id (term in body, audited)' })
  async lookup(@CurrentUser() user: Principal, @Body() body: DsarLookupRequest) {
    const { tenantId, userId } = this.actor(user);
    return this.dsar.lookup(tenantId, userId, body.by, body.term);
  }

  @Post('export')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'DSAR access/portability for one customer, on their behalf (audited)' })
  async export(@CurrentUser() user: Principal, @Body() body: DsarExportRequest) {
    const { tenantId, userId } = this.actor(user);
    return this.dsar.exportFor(tenantId, userId, body.customer_id, body.reference);
  }

  @Post('delete')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'DSAR erasure for one customer, on their behalf (irreversible, audited)' })
  async erase(@CurrentUser() user: Principal, @Body() body: DsarEraseRequest) {
    if (body.confirm !== true) {
      throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
    }
    const { tenantId, userId } = this.actor(user);
    await this.dsar.eraseFor(tenantId, userId, body.customer_id, body.confirm_customer_id, body.reference);
    return { deleted: true };
  }

  private actor(user: Principal): { tenantId: number; userId: number } {
    if (user.actorType !== 'user') {
      throw new BusinessException(ERROR_CODE.FORBIDDEN, HttpStatus.FORBIDDEN);
    }
    return { tenantId: user.tenantId, userId: user.userId };
  }
}
