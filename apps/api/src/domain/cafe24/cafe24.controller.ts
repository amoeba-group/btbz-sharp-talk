import { Body, Controller, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CAPABILITY, Principal } from '@sharptalk/types';
import { Cafe24OAuthService } from './cafe24-oauth.service';
import { Cafe24SyncService } from './cafe24-sync.service';
import { Cafe24ProductSyncService } from './cafe24-product-sync.service';
import { Cafe24ConnectionTestService } from './cafe24-connection-test.service';
import { Cafe24ConnectRequest } from './dto/cafe24.request';
import { RequireCapability, RequireMenu } from '../../global/decorator/auth.decorator';
import { CurrentUser } from '../../global/decorator/current-user.decorator';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';

/** Tenant-scoped Cafe24 connect + sync (console, authenticated). */
@ApiTags('Tenant')
@Controller('tenants/me/cafe24')
// Screen gate (PLN-260812 S4).
@RequireMenu('settings')
export class Cafe24Controller {
  constructor(
    private readonly oauthService: Cafe24OAuthService,
    private readonly syncService: Cafe24SyncService,
    private readonly productSyncService: Cafe24ProductSyncService,
    private readonly connectionTest: Cafe24ConnectionTestService,
  ) {}

  private tenantId(user: Principal): number {
    if (user.actorType !== 'user') {
      throw new BusinessException(ERROR_CODE.FORBIDDEN, HttpStatus.FORBIDDEN);
    }
    return user.tenantId;
  }

  @Post('connect')
  @RequireCapability(CAPABILITY.INTEGRATION_CREDENTIALS_MANAGE)
  @ApiOperation({ summary: 'Begin Cafe24 OAuth — returns the authorize URL to open' })
  async connect(@CurrentUser() user: Principal, @Body() body: Cafe24ConnectRequest) {
    return this.oauthService.createInstall(this.tenantId(user), body.mall_id);
  }

  /**
   * OAuth-aware connectivity test (PLN-261019-Cafe24 D2). The generic
   * `POST /tenants/me/integrations/cafe24/test` only understands a manually
   * entered access token; this one mints one from the stored refresh token.
   */
  @Post('test')
  @RequireCapability(CAPABILITY.INTEGRATION_CREDENTIALS_MANAGE)
  @ApiOperation({ summary: 'Test the OAuth-connected Cafe24 mall and record the per-tenant status' })
  async test(@CurrentUser() user: Principal) {
    return this.connectionTest.testConnection(this.tenantId(user));
  }

  @Post('sync')
  @RequireCapability(CAPABILITY.INTEGRATION_CREDENTIALS_MANAGE)
  @ApiOperation({ summary: 'Sync orders from Cafe24 into the cache' })
  async sync(@CurrentUser() user: Principal) {
    return this.syncService.syncOrders(this.tenantId(user));
  }

  /**
   * Catalogue pull. Deliberately separate from the knowledge conversion: the
   * operator previews what the conversion would write before it runs, and a
   * catalogue refresh that silently rewrote the knowledge base would take that
   * away (PLN-260807 P1).
   */
  @Post('products/sync')
  @RequireCapability(CAPABILITY.INTEGRATION_CREDENTIALS_MANAGE)
  @ApiOperation({ summary: 'Pull the Cafe24 catalogue into products_cache' })
  async syncProducts(@CurrentUser() user: Principal) {
    return this.productSyncService.syncProducts(this.tenantId(user));
  }
}
