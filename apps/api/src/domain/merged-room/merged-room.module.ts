import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MergedRoom } from './entity/merged-room.entity';
import { MergedRoomSession } from './entity/merged-room-session.entity';
import { Session } from '../session/entity/session.entity';
import { Conversation } from '../chat/entity/conversation.entity';
import { Customer } from '../customer/entity/customer.entity';
import { AuditModule } from '../audit/audit.module';
import { MergedRoomService } from './merged-room.service';

/**
 * Merged room over the same customer's sessions (PLN-261023). Repositories +
 * audit only, so the chat path (auto-join) and the console can both import it
 * without a module cycle.
 */
@Module({
  imports: [TypeOrmModule.forFeature([MergedRoom, MergedRoomSession, Session, Conversation, Customer]), AuditModule],
  providers: [MergedRoomService],
  exports: [MergedRoomService],
})
export class MergedRoomModule {}
