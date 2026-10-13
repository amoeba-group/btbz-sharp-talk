import { Controller, Delete, Get, HttpStatus, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { CAPABILITY, Principal } from '@sharptalk/types';
import { HotelProvinceService } from './hotel-province.service';
import { RequireCapability } from '../../global/decorator/auth.decorator';
import { CurrentUser } from '../../global/decorator/current-user.decorator';
import { BusinessException } from '../../global/exception/business.exception';
import { ERROR_CODE } from '../../global/constant/error-code.constant';
import { decodeUploadName } from '../../global/util/upload-name.util';

/** `dry_run=true` previews the file without touching the table. */
export class ImportHotelProvincesQuery {
  @IsOptional() @IsString() dry_run?: string;
}

/**
 * The hotel → province table for hosts that sign a hotelSn but not the province
 * (PLN-261012 SG-67). Lives under AI settings and needs the same capability as the rest of
 * the hand-off configuration.
 */
@ApiTags('AI Config')
@Controller('ai-config/hotel-provinces')
export class HotelProvinceController {
  constructor(private readonly hotelProvinces: HotelProvinceService) {}

  @Get()
  @RequireCapability(CAPABILITY.AI_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Rows in the hotel → province table and when it last changed' })
  summary(@CurrentUser() user: Principal) {
    return this.hotelProvinces.summary(this.tenantUser(user).tenantId);
  }

  @Post('import')
  @RequireCapability(CAPABILITY.AI_SETTINGS_MANAGE)
  @UseInterceptors(
    FileInterceptor('file', {
      // Memory storage: a few thousand rows is ~200 KB and the raw file is not kept — the
      // audit entry and the report carry the traceability.
      limits: { fileSize: 2 * 1024 * 1024, files: 1 },
    }),
  )
  @ApiOperation({ summary: 'Upload the hotel → province CSV: dry_run=true previews, otherwise replaces the table' })
  async importCsv(
    @CurrentUser() user: Principal,
    @Query() query: ImportHotelProvincesQuery,
    @UploadedFile() file?: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ) {
    const actor = this.tenantUser(user);
    if (!file) throw new BusinessException(ERROR_CODE.VALIDATION_FAILED, HttpStatus.BAD_REQUEST);
    // Browsers label .csv inconsistently, so the extension is the reliable check.
    if (!/\.csv$/i.test(file.originalname)) {
      throw new BusinessException(ERROR_CODE.HOTEL_PROVINCE_CSV_INVALID, HttpStatus.BAD_REQUEST, {
        file: ['upload a .csv file'],
      });
    }
    return this.hotelProvinces.importCsv(
      actor.tenantId,
      actor.userId,
      { name: decodeUploadName(file.originalname), buffer: file.buffer },
      query.dry_run === 'true' || query.dry_run === '1',
    );
  }

  @Delete()
  @RequireCapability(CAPABILITY.AI_SETTINGS_MANAGE)
  @ApiOperation({ summary: 'Empty the hotel → province table' })
  clear(@CurrentUser() user: Principal) {
    const actor = this.tenantUser(user);
    return this.hotelProvinces.clear(actor.tenantId, actor.userId);
  }

  private tenantUser(user: Principal): { tenantId: number; userId: number } {
    if (user.actorType !== 'user') throw new BusinessException(ERROR_CODE.FORBIDDEN, HttpStatus.FORBIDDEN);
    return { tenantId: user.tenantId, userId: user.userId };
  }
}
