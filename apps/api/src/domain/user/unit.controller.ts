import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CAPABILITY, Principal } from '@sharptalk/types';
import { UserService } from './user.service';
import { Auth, RequireCapability, RequireMenu } from '../../global/decorator/auth.decorator';
import { CurrentUser } from '../../global/decorator/current-user.decorator';
import { asTenantUser } from './user-principal.util';
import { CreateUnitRequest, UpdateUnitRequest } from './dto/request/unit.request';

/**
 * Tenant units (teams) — PLN-261019-Users-Unit-Labels-Routing-Conditions P1.
 * Same gates as job labels: edited from the user-management screen by whoever
 * may edit labels (master). No delete — see Unit entity.
 */
@ApiTags('Units')
@Controller('units')
@RequireMenu('users')
export class UnitController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @Auth()
  @ApiOperation({ summary: 'List tenant units (teams)' })
  list(@CurrentUser() user: Principal) {
    return this.userService.listUnits(asTenantUser(user).tenantId);
  }

  @Post()
  @RequireCapability(CAPABILITY.LABEL_EDIT)
  @ApiOperation({ summary: 'Create a unit' })
  create(@CurrentUser() user: Principal, @Body() body: CreateUnitRequest) {
    const actor = asTenantUser(user);
    return this.userService.createUnit(actor.tenantId, actor.userId, body.code, body.name);
  }

  @Patch(':id')
  @RequireCapability(CAPABILITY.LABEL_EDIT)
  @ApiOperation({ summary: 'Rename a unit' })
  update(
    @CurrentUser() user: Principal,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateUnitRequest,
  ) {
    const actor = asTenantUser(user);
    return this.userService.renameUnit(actor.tenantId, actor.userId, id, body.name);
  }
}
