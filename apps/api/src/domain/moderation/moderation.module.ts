import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContentFilterRule } from './entity/content-filter-rule.entity';
import { ModerationLog } from './entity/moderation-log.entity';
import { TenantAiConfig } from '../ai-engine/entity/tenant-ai-config.entity';
import { ModerationService } from './moderation.service';
import { ModerationController } from './moderation.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ContentFilterRule, ModerationLog, TenantAiConfig])],
  controllers: [ModerationController],
  providers: [ModerationService],
  exports: [ModerationService],
})
export class ModerationModule {}
