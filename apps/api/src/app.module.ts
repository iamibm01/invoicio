import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppController } from './app.controller.js';
import { AuthModule } from './auth/auth.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { ExtractionsModule } from './extractions/extractions.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { StorageModule } from './storage/storage.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.getOrThrow<string>('REDIS_URL') },
        // Namespaces every Redis key, so e2e tests can use their own queues
        // without touching (or being processed by) the dev server's.
        prefix: config.get<string>('QUEUE_PREFIX', 'invoicio'),
      }),
    }),
    PrismaModule,
    StorageModule,
    AuthModule,
    UsersModule,
    DocumentsModule,
    ExtractionsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
