import { Controller, Get, HttpStatus, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { evaluateWidgetAccess } from '@sharptalk/types';
import { getRequestContext } from '../../global/middleware/request-context.middleware';
import { TenantService } from './tenant.service';
import { WidgetLogoService } from './widget-logo.service';
import { WidgetDesignService } from './widget-design.service';
import { Public } from '../../global/decorator/public.decorator';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';

/** A tenant in this state is not serving anyone, widget included. */
const TENANT_SUSPENDED = 'suspended';

/**
 * Public brand assets for the widget (PLN-260819 S4 FR-T1).
 *
 * Separate from the tenant console controller because everything here is
 * unauthenticated and cached hard, while everything there is neither.
 */
@ApiTags('Widget')
@Controller('public/widget')
export class WidgetBrandingController {
  constructor(
    private readonly tenantService: TenantService,
    private readonly widgetLogo: WidgetLogoService,
    private readonly designs: WidgetDesignService,
  ) {}

  /**
   * No auth and no signature, deliberately: the widget paints this before anyone
   * is identified, and a signed URL would defeat the cache and expire mid-visit.
   * A logo is not private data. `v` is only a cache buster — a new upload gets a
   * new id, so the URL changes whenever the file does.
   */
  /**
   * Should the widget appear on this page at all (PLN-260929 P2)?
   *
   * The loader calls this from the storefront BEFORE it shows anything, which
   * is the only moment the server can see the shopper's real IP (first
   * X-Forwarded-For hop, same trust model as the rate limiter). Unrestricted
   * tenants — almost all of them — get `visible: true` immediately.
   *
   * `restricted` tells the loader whether this tenant uses the feature at all,
   * so a repeat visit can wait for the verdict instead of flashing the widget.
   * The verdict itself is deliberately NOT cacheable: the window has to be able
   * to close on time.
   */
  @Get('visibility')
  @Public()
  @SkipThrottle()
  @ApiOperation({ summary: 'Whether the widget may be shown to this visitor' })
  async visibility(
    @Query('shop') shop: string | undefined,
    @Query('url') url: string | undefined,
    @Query('key') key: string | undefined,
    @Query('mode') mode: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');

    const tenant = shop ? await this.tenantService.findByShopDomain(shop) : null;
    // An unknown shop is a misconfigured snippet, not a restricted visitor.
    // Saying "visible" here keeps this endpoint from becoming a second way to
    // break an install; the session call still refuses an unknown tenant.
    if (!tenant) return { visible: true, restricted: false };

    // Same IP the audit trail and the rate limiter see — one reading of
    // "who is this", set once by the request-context middleware.
    const ip = getRequestContext()?.ip ?? null;
    const verdict = evaluateWidgetAccess(tenant.widgetAccess, {
      ip,
      pageUrl: url ?? null,
      key: key ?? null,
      tenantKey: tenant.widgetAccessKey,
      // A host app's WebView has no storefront page to match on (REQ D8).
      skipUrlRule: mode === 'app',
    });

    return {
      visible: verdict.visible && tenant.status !== TENANT_SUSPENDED,
      restricted: verdict.restricted || tenant.status === TENANT_SUSPENDED,
      // Echoed so the console can offer "add my IP" without a second service.
      yourIp: ip,
    };
  }

  /**
   * Preview theme for a signed, short-lived token (PLN-260910 P3 D-15): lets
   * the console show an unapplied design in the real widget without touching
   * what shoppers see. No tenant data beyond the theme leaves here.
   */
  @Get('preview-theme')
  @Public()
  @ApiOperation({ summary: 'Theme for a console preview token (signed, 10 min)' })
  async previewTheme(@Query('token') token: string) {
    const theme = await this.designs.previewTheme(token ?? '');
    if (!theme) throw new BusinessException(ERROR_CODE.FORBIDDEN, HttpStatus.FORBIDDEN);
    return { theme };
  }

  @Get('logo')
  @Public()
  @SkipThrottle() // one request per storefront page load, same as the widget itself
  @ApiOperation({ summary: "A storefront's widget logo (public, cached)" })
  async logo(
    @Query('shop') shop: string,
    @Query('v') version: string,
    @Res() res: Response,
  ): Promise<void> {
    const tenant = shop ? await this.tenantService.findByShopDomain(shop) : null;
    const logo = tenant?.widgetTheme?.logo ?? null;
    if (!tenant || !logo) {
      res.status(HttpStatus.NOT_FOUND).end();
      return;
    }

    res.setHeader('Content-Type', logo.mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // `immutable` is only honest when the URL names the version being served. A
    // request without `v` (or with a stale one) points at whatever is current,
    // so caching it for a year would keep serving a replaced logo from
    // intermediaries long after the tenant changed it.
    res.setHeader(
      'Cache-Control',
      version === logo.id ? 'public, max-age=31536000, immutable' : 'public, max-age=60',
    );

    const stream = this.widgetLogo.openStream(Number(tenant.id), logo);
    stream.on('error', () => {
      // The theme says there is a logo but the file is gone (volume reset, manual
      // delete). Answer 404 rather than a half-written body; the widget falls
      // back to its text header on its own.
      if (!res.headersSent) res.status(HttpStatus.NOT_FOUND);
      res.end();
    });
    // pipe() does not close the source when the destination goes away. On a
    // public route every abandoned page load would leak a descriptor, and the
    // process reaches EMFILE long before anyone notices.
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  }
}
