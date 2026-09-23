import { Module } from '@nestjs/common';
import { MailService } from './mail.service.js';

/**
 * A genuinely separate concern: `mail` owns no table and reads none. It knows
 * a recipient, a subject and a body, and one of two transports.
 */
@Module({
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
