// import { Injectable, OnModuleInit } from '@nestjs/common';
// import { PrismaClient } from '@prisma/client';

// @Injectable()
// export class PrismaService extends PrismaClient implements OnModuleInit {
//   async onModuleInit() {
//     await this.$connect();
//     // this.$extends
//   }
// }

import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaAuditExtension } from './prisma-audit.extension';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ClsService } from 'nestjs-cls';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(
    @Inject(forwardRef(() => AuditLogService))
    private readonly auditLogService: AuditLogService,
    private readonly clsService: ClsService,
  ) {
    super();

    // Create a fresh PrismaClient to pass to extension
    const prismaClient = new PrismaClient();

    // Apply extension with prismaClient parameter
    const extended = this.$extends(
      PrismaAuditExtension.getExtension(
        this.auditLogService,
        this.clsService,
        prismaClient, // Pass the prismaClient for old value queries
      ),
    );

    // Merge extended client into this
    Object.assign(this, extended);
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}