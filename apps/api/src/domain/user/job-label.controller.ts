import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CAPABILITY, Principal } from '@sharptalk/types';
import { UserService } from './user.service';
import { Auth, RequireCapability, RequireMenu } from '../../global/decorator/auth.decorator';
import { CurrentUser } from '../../global/decorator/current-user.decorator';
import { asTenantUser } from './user-principal.util';
import {
  CreateJobLabelRequest,
  UpdateJobLabelRequest,
} from './dto/request/job-label.request';

@ApiTags('Job Labels')
@Controller('job-labels')
// Screen gate (PLN-260812 S4): Job labels are edited from the user-management screen.
@RequireMenu('users')
export class JobLabelController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @Auth()
  @ApiOperation({ summary: 'List tenant job labels' })
  list(@CurrentUser() user: Principal) {
    return this.userService.listLabels(asTenantUser(user).tenantId);
  }

  @Post()
  @RequireCapability(CAPABILITY.LABEL_EDIT)
  @ApiOperation({ summary: 'Create a job label' })
  create(@CurrentUser() user: Principal, @Body() body: CreateJobLabelRequest) {
    return this.userService.createLabel(asTenantUser(user).tenantId, body.code, body.name);
  }

  @Patch(':id')
  @RequireCapability(CAPABILITY.LABEL_EDIT)
  @ApiOperation({ summary: 'Rename a job label' })
  update(
    @CurrentUser() user: Principal,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateJobLabelRequest,
  ) {
    return this.userService.updateLabel(asTenantUser(user).tenantId, id, body.name);
  }

  @Delete(':id')
  @RequireCapability(CAPABILITY.LABEL_EDIT)
  @ApiOperation({ summary: 'Delete a job label (refused while a routing rule uses it)' })
  remove(@CurrentUser() user: Principal, @Param('id', ParseIntPipe) id: number) {
    const actor = asTenantUser(user);
    return this.userService.deleteLabel(actor.tenantId, actor.userId, id);
  }
}
