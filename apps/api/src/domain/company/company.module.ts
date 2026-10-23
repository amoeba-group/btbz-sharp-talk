import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Company } from './entity/company.entity';
import { CompanyContact } from './entity/company-contact.entity';
import { Customer } from '../customer/entity/customer.entity';
import { Conversation } from '../chat/entity/conversation.entity';
import { ProductCache } from '../product/entity/product-cache.entity';
import { User } from '../user/entity/user.entity';
import { Go2joyModule } from '../go2joy/go2joy.module';
import { AuditModule } from '../audit/audit.module';
import { CompanyService } from './company.service';
import { CompanyController } from './company.controller';

/**
 * B2B companies (PLN-261022 stage 2). Repositories only — no ChatModule /
 * CustomerModule import, so the embed and chat modules can depend on this one
 * without a cycle.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Company, CompanyContact, Customer, Conversation, ProductCache, User]),
    Go2joyModule,
    AuditModule,
  ],
  controllers: [CompanyController],
  providers: [CompanyService],
  exports: [CompanyService],
})
export class CompanyModule {}
