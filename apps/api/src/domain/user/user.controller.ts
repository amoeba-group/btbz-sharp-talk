import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CAPABILITY, Principal, USER_RANK } from '@sharptalk/types';
import { buildPagination, normalizePage } from '@sharptalk/common';
import { UserService } from './user.service';
import { MfaService } from '../auth/mfa.service';
import { Paginated } from '../../global/interceptor/transform.interceptor';
import { Public } from '../../global/decorator/public.decorator';
import { RequireCapability, RequireMenu, RequireRank } from '../../global/decorator/auth.decorator';
import { CurrentUser } from '../../global/decorator/current-user.decorator';
import { asTenantUser } from './user-principal.util';
import {
  AcceptInviteRequest,
  InviteUserRequest,
  IssueTempPasswordRequest,
  ListUsersQuery,
  UpdateLabelsRequest,
  UpdateRankRequest,
  UpdateRegionRequest,
  UpdateStatusRequest,
} from './dto/request/user.request';

@ApiTags('Users')
@Controller('users')
// Screen gate (PLN-260812 S4).
@RequireMenu('users')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly mfaService: MfaService,
  ) {}

  @Get()
  @RequireRank(USER_RANK.MASTER, USER_RANK.DIRECTOR, USER_RANK.MANAGER)
  @ApiOperation({ summary: 'List tenant users (paginated) with their job-label codes' })
  async list(@CurrentUser() user: Principal, @Query() query: ListUsersQuery) {
    const principal = asTenantUser(user);
    const { page: p, size: s } = normalizePage(query.page, query.size);
    const { items, total } = await this.userService.listUsers(principal.tenantId, p, s, {
      label: query.label,
      region: query.region,
    });
    return new Paginated(items, buildPagination(p, s, total));
  }

  @Post('invite')
  @RequireCapability(CAPABILITY.USER_INVITE)
  @ApiOperation({ summary: 'Invite a staff member (creates user + invitation)' })
  invite(@CurrentUser() user: Principal, @Body() body: InviteUserRequest) {
    const principal = asTenantUser(user);
    return this.userService.invite(
      principal.tenantId,
      principal.userId,
      body.email,
      body.rank,
      body.label_codes,
      'user',
      body.region,
    );
  }

  @Post('accept-invite')
  @Public()
  @ApiOperation({ summary: 'Accept an invitation and set a password' })
  acceptInvite(@Body() body: AcceptInviteRequest) {
    return this.userService.acceptInvite(body.token, body.new_password);
  }

  @Post(':id/temp-password')
  @RequireCapability(CAPABILITY.USER_INVITE)
  @ApiOperation({ summary: 'Issue a temporary password for a user (manual hand-off and/or email)' })
  issueTempPassword(
    @CurrentUser() user: Principal,
    @Param('id', ParseIntPipe) id: number,
    @Body() body?: IssueTempPasswordRequest,
  ) {
    const actor = asTenantUser(user);
    return this.userService.issueTempPassword(actor.tenantId, id, actor.userId, 'user', {
      sendEmail: body?.send_email === true,
    });
  }

  @Post(':id/mfa-reset')
  @RequireCapability(CAPABILITY.USER_INVITE)
  @ApiOperation({ summary: 'Reset a user MFA credential (target re-enrolls at next login)' })
  resetMfa(@CurrentUser() user: Principal, @Param('id', ParseIntPipe) id: number) {
    const actor = asTenantUser(user);
    return this.mfaService.resetForUser(actor.tenantId, id, user);
  }

  @Patch(':id/rank')
  @RequireCapability(CAPABILITY.USER_RANK_ADJUST)
  @ApiOperation({ summary: 'Adjust a user rank' })
  updateRank(
    @CurrentUser() user: Principal,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateRankRequest,
  ) {
    return this.userService.updateRank(asTenantUser(user).tenantId, id, body.rank);
  }

  @Patch(':id/labels')
  @RequireCapability(CAPABILITY.LABEL_ASSIGN)
  @ApiOperation({ summary: 'Replace a user job-label assignments' })
  updateLabels(
    @CurrentUser() user: Principal,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateLabelsRequest,
  ) {
    return this.userService.updateLabels(asTenantUser(user).tenantId, id, body.label_codes);
  }

  @Patch(':id/region')
  // Same holders as label assignment: region is operational scope, not permission.
  @RequireCapability(CAPABILITY.LABEL_ASSIGN)
  @ApiOperation({ summary: 'Set a user operational region (north/south; empty = nationwide)' })
  updateRegion(
    @CurrentUser() user: Principal,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateRegionRequest,
  ) {
    return this.userService.updateRegion(asTenantUser(user).tenantId, id, body.region);
  }

  @Patch(':id/status')
  @RequireRank(USER_RANK.MASTER, USER_RANK.DIRECTOR)
  @ApiOperation({ summary: 'Activate or suspend a user' })
  updateStatus(
    @CurrentUser() user: Principal,
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateStatusRequest,
  ) {
    return this.userService.updateStatus(asTenantUser(user).tenantId, id, body.status);
  }
}
