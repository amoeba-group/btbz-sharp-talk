import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CAPABILITY, Principal } from '@sharptalk/types';
import { Auth, RequireCapability } from '../../global/decorator/auth.decorator';
import { CurrentUser } from '../../global/decorator/current-user.decorator';
import { asTenantUser } from '../user/user-principal.util';
import { RoutingCategoryService } from './routing-category.service';
import { CreateRoutingCategoryRequest, UpdateRoutingCategoriesRequest } from './dto/request/routing-category.request';

/**
 * Routing categories (PLN-261024). Reading is open to the tenant's users — the
 * user screen (unit/label scope) and the customers screen show them; changing
 * needs the same capability as saving the handoff settings.
 */
@ApiTags('Routing Categories')
@Controller('routing-categories')
export class RoutingCategoryController {
  constructor(private readonly service: RoutingCategoryService) {}

  @Get()
  @Auth()
  @ApiOperation({ summary: 'List the tenant routing categories with where each is used' })
  list(@CurrentUser() user: Principal) {
    return this.service.list(asTenantUser(user).tenantId);
  }

  @Post()
  @RequireCapability(CAPABILITY.AI_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Create a routing category (the code is fixed afterwards)' })
  create(@CurrentUser() user: Principal, @Body() body: CreateRoutingCategoryRequest) {
    const actor = asTenantUser(user);
    return this.service.create(actor.tenantId, actor.userId, body.code, body.name);
  }

  @Patch()
  @RequireCapability(CAPABILITY.AI_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Rename / reorder routing categories in one save' })
  update(@CurrentUser() user: Principal, @Body() body: UpdateRoutingCategoriesRequest) {
    const actor = asTenantUser(user);
    return this.service.update(
      actor.tenantId,
      actor.userId,
      body.items.map((i) => ({ id: i.id, name: i.name, sortOrder: i.sort_order })),
    );
  }

  @Delete(':id')
  @RequireCapability(CAPABILITY.AI_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Delete a routing category (refused while a rule, unit, label or company uses it)' })
  remove(@CurrentUser() user: Principal, @Param('id') id: string) {
    const actor = asTenantUser(user);
    return this.service.remove(actor.tenantId, actor.userId, id);
  }
}
