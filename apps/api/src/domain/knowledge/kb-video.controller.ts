import { Controller, Get, Param, ParseIntPipe, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../global/decorator/public.decorator';
import { KbVideoService } from './kb-video.service';

/**
 * Public "watch video" link (PLN-261006-KB-Video-Links). Opened in a new tab
 * from a chat answer, so it answers with a redirect or a short readable page —
 * never the JSON envelope. The signature in the URL is the authorisation.
 */
@ApiTags('Knowledge')
@Controller('kb-videos')
export class KbVideoController {
  constructor(private readonly videos: KbVideoService) {}

  @Get(':id')
  @Public()
  @ApiOperation({ summary: 'Redirect to a playable URL for the video a KB document explains' })
  async play(
    @Param('id', ParseIntPipe) id: number,
    @Query('t') t: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ): Promise<void> {
    const r = await this.videos.resolve(id, Number(t), String(sig ?? ''));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (r.ok) {
      res.redirect(302, r.url);
      return;
    }
    const status = r.reason === 'unavailable' ? 503 : 404;
    res
      .status(status)
      .type('html')
      .send(
        '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
          '<title>Video</title><body style="font-family:system-ui;padding:2rem;color:#374151">' +
          (status === 503
            ? '<p>This video cannot be played right now. Please try again later.</p>'
            : '<p>This video link is not available.</p>') +
          '</body>',
      );
  }
}
