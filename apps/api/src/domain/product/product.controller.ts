import { Body, Controller, Get, HttpStatus, Logger, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CAPABILITY, CJM_STAGE, Principal } from '@sharptalk/types';
import { buildPagination, normalizePage } from '@sharptalk/common';
import { ProductService } from './product.service';
import { ProductSyncService } from './product-sync.service';
import { UpdateRoomCountRequest } from './dto/request/product.request';
import {
  toAdminProductDetailResponse,
  toAdminProductResponse,
  toProductCardResponse,
  toProductDetailResponse,
} from './product.mapper';
import { Public } from '../../global/decorator/public.decorator';
import { RequireCapability, RequireMenu } from '../../global/decorator/auth.decorator';
import { CurrentUser } from '../../global/decorator/current-user.decorator';
import { SessionToken } from '../../global/decorator/session-token.decorator';
import { Paginated } from '../../global/interceptor/transform.interceptor';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { SessionService } from '../session/session.service';
import { EventBusService, EVENTS } from '../../infrastructure/infrastructure.module';

/** Recommendation rail sizing (A-10): default 10 cards, hard cap 20. */
const RECO_DEFAULT_SIZE = 10;
const RECO_MAX_SIZE = 20;

/**
 * Customer-facing catalog endpoints (PLN-260807-IvyusaApp-Revamp F1, A-3).
 * Public + session-token identified — the session row carries the tenant scope.
 */
@ApiTags('Product')
@Controller('products')
export class ProductController {
  private readonly logger = new Logger(ProductController.name);

  constructor(
    private readonly productService: ProductService,
    private readonly sessionService: SessionService,
    private readonly bus: EventBusService,
  ) {}

  @Get('categories')
  @Public()
  @ApiOperation({ summary: "Distinct categories of the tenant's active products" })
  async categories(@SessionToken() token: string) {
    const session = await this.sessionService.findByToken(token);
    return this.productService.categories(session.tenantId);
  }

  @Get()
  @Public()
  @ApiOperation({ summary: 'List active products (search q on title/tags, category filter)' })
  async list(
    @SessionToken() token: string,
    @Query('q') q?: string,
    @Query('category') category?: string,
    @Query('page') page?: string,
    @Query('size') size?: string,
  ) {
    const session = await this.sessionService.findByToken(token);
    const { page: p, size: s } = normalizePage(page, size);
    const [items, total] = await this.productService.list(session.tenantId, q, category, p, s);
    return new Paginated(items.map(toProductCardResponse), buildPagination(p, s, total));
  }

  // Static route — MUST stay above GET /products/:handle or it gets shadowed.
  @Get('recommendations')
  @Public()
  @ApiOperation({ summary: 'Deterministic recommendations v1 (saved-signal rules, A-10)' })
  async recommendations(@SessionToken() token: string, @Query('size') size?: string) {
    const session = await this.sessionService.findByToken(token);
    const parsed = Number(size);
    const s =
      Number.isFinite(parsed) && parsed > 0
        ? Math.min(Math.floor(parsed), RECO_MAX_SIZE)
        : RECO_DEFAULT_SIZE;
    const rows = await this.productService.recommendations(
      session.tenantId,
      session.customerId ?? null,
      s,
    );
    return rows.map(toProductCardResponse);
  }

  // Path-param route LAST so it never shadows the static routes above.
  @Get(':handle')
  @Public()
  @ApiOperation({ summary: 'Product detail by handle' })
  async detail(@SessionToken() token: string, @Param('handle') handle: string) {
    const session = await this.sessionService.findByToken(token);
    const product = await this.productService.detail(session.tenantId, handle);
    // Journey breadcrumb (PLN-260807 F3, A-7): the diary timeline's Browse stage.
    // Fire-and-forget — a bus hiccup must never block or fail the product read.
    void this.bus
      .publish(EVENTS.CJM, {
        tenantId: session.tenantId,
        sessionId: session.id,
        customerId: session.customerId ?? null,
        stage: CJM_STAGE.BROWSE,
        eventType: 'product_view',
        payload: { handle },
      })
      .catch((e) => this.logger.warn(`product_view CJM emit failed: ${(e as Error).message}`));
    return toProductDetailResponse(product);
  }
}

/** Tenant-console catalog view + operations (PLN-260808-Console-Product-List). */
@ApiTags('Product')
@Controller('admin/products')
// Screen gate (PLN-260812 S4): Console product list; the storefront's own /products controller is separate and public.
@RequireMenu('products')
export class ProductAdminController {
  constructor(
    private readonly productService: ProductService,
    private readonly syncService: ProductSyncService,
  ) {}

  // Static routes first — a later `:handle` route would otherwise swallow them.
  @Get('summary')
  @RequireCapability(CAPABILITY.MODULE_OPERATIONS)
  @ApiOperation({ summary: 'Catalogue counters for the console header' })
  async summary(@CurrentUser() user: Principal) {
    const tenantId = this.tenantId(user);
    const [counts, inKnowledge] = await Promise.all([
      this.productService.adminSummary(tenantId),
      this.productService.knowledgeDocumentCount(tenantId),
    ]);
    return { ...counts, inKnowledge };
  }

  @Get('categories')
  @RequireCapability(CAPABILITY.MODULE_OPERATIONS)
  @ApiOperation({ summary: 'Categories present in the catalogue, archived rows included' })
  async categories(@CurrentUser() user: Principal) {
    return this.productService.adminCategories(this.tenantId(user));
  }

  /** Companies that own products — the B2B company filter (PLN-261023). */
  @Get('companies')
  @RequireCapability(CAPABILITY.MODULE_OPERATIONS)
  @ApiOperation({ summary: 'B2B companies that own catalogue rows, with counts' })
  async companies(@CurrentUser() user: Principal) {
    const tenantId = this.tenantId(user);
    const facets = await this.productService.companyFacets(tenantId);
    const names = await this.productService.companyNames(tenantId, facets.map((f) => Number(f.companyId)));
    return facets.map((f) => ({ ...f, name: names.get(f.companyId) ?? null }));
  }

  @Get()
  @RequireCapability(CAPABILITY.MODULE_OPERATIONS)
  @ApiOperation({ summary: 'List the synced catalogue (archived rows included)' })
  async list(
    @CurrentUser() user: Principal,
    @Query('q') q?: string,
    @Query('category') category?: string,
    @Query('status') status?: string,
    @Query('company_id') companyId?: string,
    @Query('page') page?: string,
    @Query('size') size?: string,
  ) {
    const tenantId = this.tenantId(user);
    const { page: p, size: s } = normalizePage(page, size);
    const [items, total] = await this.productService.adminList(
      tenantId,
      { q, category, status, companyId },
      p,
      s,
    );
    const known = await this.productService.knowledgeHandles(
      tenantId,
      items.map((i) => i.handle),
    );
    const names = await this.productService.companyNames(tenantId, items.map((i) => i.companyId));
    return new Paginated(
      items.map((i) =>
        toAdminProductResponse(i, known.has(i.handle), i.companyId != null ? (names.get(String(i.companyId)) ?? null) : null),
      ),
      buildPagination(p, s, total),
    );
  }

  // Path-param route LAST so it never shadows `summary` / `categories`.
  @Get(':handle')
  @RequireCapability(CAPABILITY.MODULE_OPERATIONS)
  @ApiOperation({ summary: 'One catalogue row in full (archived rows included)' })
  async detail(@CurrentUser() user: Principal, @Param('handle') handle: string) {
    const tenantId = this.tenantId(user);
    const product = await this.productService.detail(tenantId, handle);
    const known = await this.productService.knowledgeHandles(tenantId, [handle]);
    const names = await this.productService.companyNames(tenantId, [product.companyId]);
    return toAdminProductDetailResponse(
      product,
      known.has(handle),
      product.companyId != null ? (names.get(String(product.companyId)) ?? null) : null,
    );
  }

  /** Operator-entered room count of a company room type (PLN-261023). */
  @Patch(':handle/room-count')
  @RequireCapability(CAPABILITY.MODULE_OPERATIONS)
  @ApiOperation({ summary: 'Set the room count of a room-type product' })
  async roomCount(
    @CurrentUser() user: Principal,
    @Param('handle') handle: string,
    @Body() body: UpdateRoomCountRequest,
  ) {
    const tenantId = this.tenantId(user);
    const product = await this.productService.setRoomCount(tenantId, handle, body.room_count ?? null);
    const known = await this.productService.knowledgeHandles(tenantId, [handle]);
    const names = await this.productService.companyNames(tenantId, [product.companyId]);
    return toAdminProductDetailResponse(product, known.has(handle), names.get(String(product.companyId)) ?? null);
  }

  @Post('sync')
  @RequireCapability(CAPABILITY.MODULE_OPERATIONS)
  @ApiOperation({ summary: 'Trigger a storefront catalog sync for the tenant (admin)' })
  async sync(@CurrentUser() user: Principal) {
    return this.syncService.syncTenantById(this.tenantId(user));
  }

  private tenantId(user: Principal): number {
    if (user.actorType !== 'user') {
      throw new BusinessException(ERROR_CODE.FORBIDDEN, HttpStatus.FORBIDDEN);
    }
    return user.tenantId;
  }
}
