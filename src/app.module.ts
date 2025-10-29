import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { RolesModule } from './roles/roles.module';
import { UsersModule } from './users/users.module';
import { PermissionsModule } from './permissions/permissions.module';
import { PrismaModule } from './prisma/prisma.module';
import { EmailModule } from './mailer/email.module';
import { CloudinaryModule } from './cloudinary/cloudinary.module';
import { InventoryModule } from './inventory/inventory.module';
import { ProductsModule } from './products/products.module';
import { AgentsModule } from './agents/agents.module';
import { CustomersModule } from './customers/customers.module';
import { SalesModule } from './sales/sales.module';
import { PaymentModule } from './payment/payment.module';
import { DeviceModule } from './device/device.module';
import { ContractModule } from './contract/contract.module';
import { OpenpaygoModule } from './openpaygo/openpaygo.module';
import { FlutterwaveModule } from './flutterwave/flutterwave.module';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { CronjobsModule } from './cronjobs/cronjobs.module';
import { TermiiModule } from './termii/termii.module';
import { JobstatusModule } from './jobstatus/jobstatus.module';
import { CsvUploadModule } from './csv-upload/csv-upload.module';
import { WalletModule } from './wallet/wallet.module';
import { OgaranyaModule } from './ogaranya/ogaranya.module';
import { InstallerModule } from './installer/installer.module';
import { TaskManagementModule } from './task-management/task-management.module';
import { ReportsModule } from './reports/reports.module';
import { WarehouseModule } from './warehouse/warehouse.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { NotificationModule } from './notification/notification.module';
import { ExportModule } from './export/export.module';
import { OdysseyModule } from './odyssey/odyssey.module';
import { TokenRestorationModule } from './token-restoration/token-restoration.module';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => ({
        connection: {
          // host: configService.get<string>('REDIS_HOST'),
          // port: configService.get<number>('REDIS_PORT'),
          // password: configService.get<string>('REDIS_PASSWORD'),
          // username: configService.get<string>('REDIS_USERNAME'),
          url: configService.get<string>('REDIS_URL'),
        },
      }),
    }),
    ThrottlerModule.forRoot([
      {
        ttl: 10000, // 15 minutes
        limit: 6,
        blockDuration: 120000, // 2 mins
      },
    ]),

    ScheduleModule.forRoot(),

    ConfigModule.forRoot({
      isGlobal: true,
    }),
    EmailModule,
    CloudinaryModule,
    PrismaModule,
    AuthModule,
    RolesModule,
    UsersModule,
    PermissionsModule,
    InventoryModule,
    ProductsModule,
    AgentsModule,
    CustomersModule,
    SalesModule,
    PaymentModule,
    DeviceModule,
    ContractModule,
    OpenpaygoModule,
    FlutterwaveModule,
    CronjobsModule,
    TermiiModule,
    JobstatusModule,
    CsvUploadModule,
    WalletModule,
    OgaranyaModule,
    InstallerModule,
    TaskManagementModule,
    ReportsModule,
    WarehouseModule,
    AnalyticsModule,
    NotificationModule,
    ExportModule,
    OdysseyModule,
    TokenRestorationModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
