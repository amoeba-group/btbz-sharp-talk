import { Body, Controller, Get, Headers, Ip, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Principal } from '@sharptalk/types';
import { AuthService } from './auth.service';
import { AmaSsoService } from './ama-sso.service';
import { MfaService } from './mfa.service';
import {
  ChangePasswordRequest,
  LoginRequest,
  LogoutRequest,
  RefreshRequest,
} from './dto/request/login.request';
import { AmaSsoLoginRequest } from './dto/request/ama-sso.request';
import {
  PasswordChangeSelfRequest,
  TempPasswordSelfRequest,
} from './dto/request/password-recovery.request';
import { PasswordRecoveryService } from './password-recovery.service';
import {
  MfaDisableRequest,
  MfaEnrollVerifyRequest,
  MfaVerifyRequest,
} from './dto/request/mfa.request';
import { Public } from '../../global/decorator/public.decorator';
import { Auth } from '../../global/decorator/auth.decorator';
import { AllowPendingPassword } from '../../global/decorator/allow-pending-password.decorator';
import { AllowPendingMfa } from '../../global/decorator/allow-pending-mfa.decorator';
import { CurrentUser } from '../../global/decorator/current-user.decorator';
import { trustedClientIp } from '../../global/middleware/request-context.middleware';

/** Client IP for rate limiting: X-Forwarded-For read from the right
 *  (`trustedClientIp` — the first hop is the browser's own claim), else the
 *  direct socket address. */
function clientIp(xff: string | undefined, ip: string): string {
  return trustedClientIp(xff, ip) ?? 'unknown';
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly amaSsoService: AmaSsoService,
    private readonly mfaService: MfaService,
    private readonly passwordRecovery: PasswordRecoveryService,
  ) {}

  // ---- Self-service password recovery (PLN-260824) ----

  @Post('password/temp-request')
  @Public()
  @ApiOperation({ summary: 'Email a temp password to a tenant account (neutral response)' })
  requestTempPassword(
    @Body() body: TempPasswordSelfRequest,
    @Ip() ip: string,
    @Headers('x-forwarded-for') xff?: string,
  ) {
    return this.passwordRecovery.requestTempPassword(
      body.tenant_slug,
      body.email,
      clientIp(xff, ip),
    );
  }

  @Post('password/change')
  @Public()
  @ApiOperation({ summary: 'Change password with current/temp password (works while locked)' })
  changePasswordSelf(
    @Body() body: PasswordChangeSelfRequest,
    @Ip() ip: string,
    @Headers('x-forwarded-for') xff?: string,
  ) {
    return this.passwordRecovery.changePassword(
      body.tenant_slug,
      body.email,
      body.current_password,
      body.new_password,
      clientIp(xff, ip),
    );
  }

  @Post('admin/login')
  @Public()
  @ApiOperation({ summary: 'System admin login (super_admin/admin)' })
  loginAdmin(
    @Body() body: LoginRequest,
    @Ip() ip: string,
    @Headers('x-forwarded-for') xff?: string,
  ) {
    return this.authService.loginAdmin(body.email, body.password, clientIp(xff, ip));
  }

  @Post('user/login')
  @Public()
  @ApiOperation({ summary: 'Tenant user login (master/director/manager/staff)' })
  loginUser(
    @Body() body: LoginRequest,
    @Ip() ip: string,
    @Headers('x-forwarded-for') xff?: string,
  ) {
    return this.authService.loginUser(
      body.email,
      body.password,
      clientIp(xff, ip),
      body.shop_domain,
      body.tenant_slug,
    );
  }

  @Post('sso/ama')
  @Public()
  @ApiOperation({ summary: 'AMA-portal SSO: exchange an ama_token for tenant-console tokens' })
  loginWithAma(
    @Body() body: AmaSsoLoginRequest,
    @Ip() ip: string,
    @Headers('x-forwarded-for') xff?: string,
  ) {
    return this.amaSsoService.login(body.ama_token, body.tenant_slug, clientIp(xff, ip));
  }

  // ---- MFA (PLN-MFA Stage M1) ----

  @Post('mfa/verify')
  @Public()
  @ApiOperation({ summary: 'Step-up login: exchange mfa_token + TOTP/recovery code for tokens' })
  verifyMfa(
    @Body() body: MfaVerifyRequest,
    @Ip() ip: string,
    @Headers('x-forwarded-for') xff?: string,
  ) {
    return this.authService.verifyMfa(body.mfa_token, body.code, clientIp(xff, ip));
  }

  @Get('mfa/status')
  @Auth()
  @AllowPendingMfa()
  @ApiOperation({ summary: 'MFA enrollment status for the current account' })
  mfaStatus(@CurrentUser() user: Principal) {
    return this.mfaService.status(user);
  }

  @Post('mfa/enroll')
  @Auth()
  @AllowPendingMfa()
  @ApiOperation({ summary: 'Start MFA enrollment (returns otpauth URI + manual key ONCE)' })
  mfaEnroll(@CurrentUser() user: Principal) {
    return this.mfaService.enroll(user);
  }

  @Post('mfa/enroll/verify')
  @Auth()
  @AllowPendingMfa()
  @ApiOperation({ summary: 'Confirm enrollment with a first TOTP; returns one-time recovery codes' })
  async mfaEnrollVerify(@CurrentUser() user: Principal, @Body() body: MfaEnrollVerifyRequest) {
    const { recoveryCodes } = await this.mfaService.enrollVerify(user, body.code);
    // Fresh pair so the client can drop a mfaPending-locked token at once (M3).
    const tokens = await this.authService.reissueAfterMfaEnroll(user);
    return { recoveryCodes, tokens };
  }

  @Post('mfa/disable')
  @Auth()
  @ApiOperation({ summary: 'Disable MFA (requires password + TOTP/recovery code)' })
  mfaDisable(
    @CurrentUser() user: Principal,
    @Body() body: MfaDisableRequest,
    @Ip() ip: string,
    @Headers('x-forwarded-for') xff?: string,
  ) {
    return this.mfaService.disable(user, body.password, body.code, clientIp(xff, ip));
  }

  @Post('refresh')
  @Public()
  @ApiOperation({ summary: 'Refresh access token' })
  refresh(@Body() body: RefreshRequest) {
    return this.authService.refresh(body.refresh_token);
  }

  @Post('change-password')
  @Auth()
  @AllowPendingPassword()
  @AllowPendingMfa()
  @ApiOperation({ summary: 'Change password (clears must-change flag, returns fresh tokens)' })
  changePassword(@CurrentUser() user: Principal, @Body() body: ChangePasswordRequest) {
    return this.authService.changePassword(user, body.current_password, body.new_password);
  }

  @Post('logout')
  @Auth()
  @AllowPendingPassword()
  @AllowPendingMfa()
  @ApiOperation({ summary: 'Log out (revokes the presented refresh token)' })
  async logout(@Body() body: LogoutRequest) {
    await this.authService.logout(body.refresh_token);
    return { loggedOut: true };
  }

  @Get('me')
  @Auth()
  @AllowPendingPassword()
  @AllowPendingMfa()
  @ApiOperation({ summary: 'Current principal' })
  me(@CurrentUser() user: Principal) {
    return this.authService.me(user);
  }
}
