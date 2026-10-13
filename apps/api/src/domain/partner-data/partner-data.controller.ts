import { Body, Controller, Get, HttpStatus, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Principal, USER_RANK } from '@sharptalk/types';
import { RequireRank } from '../../global/decorator/auth.decorator';
import { CurrentUser } from '../../global/decorator/current-user.decorator';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { UpdatePartnerDataSettingsRequest } from './dto/request/partner-data.request';
import { PartnerSettingsService } from './partner-settings.service';

/** Console settings for the partner-data lookup (PLN-261012 SG-31). Thin: glue only. */
@ApiTags('Partner data')
@Controller('partner-data')
export class PartnerDataController {
  constructor(private readonly settings: PartnerSettingsService) {}

  @Get('settings')
  @RequireRank(USER_RANK.MASTER, USER_RANK.DIRECTOR)
  @ApiOperation({ summary: "This tenant's partner data lookup switch and connection state" })
  async getSettings(@CurrentUser() user: Principal) {
    return this.settings.get(this.tenantId(user));
  }

  @Put('settings')
  @RequireRank(USER_RANK.MASTER)
  @ApiOperation({ summary: 'Turn the partner data lookup on or off for this tenant' })
  async updateSettings(@CurrentUser() user: Principal, @Body() body: UpdatePartnerDataSettingsRequest) {
    if (user.actorType !== 'user') {
      throw new BusinessException(ERROR_CODE.FORBIDDEN, HttpStatus.FORBIDDEN);
    }
    return this.settings.setEnabled(user.tenantId, user.userId, body.enabled);
  }

  private tenantId(user: Principal): number {
    if (user.actorType !== 'user') {
      throw new BusinessException(ERROR_CODE.FORBIDDEN, HttpStatus.FORBIDDEN);
    }
    return user.tenantId;
  }
}
