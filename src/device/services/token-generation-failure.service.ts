import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TokenGenerationFailureService {
  constructor(private readonly prisma: PrismaService) {}

  async recordFailure(
    saleId: string,
    deviceId: string | null,
    serialNumber: string | null,
    reason: string,
    errorStack?: string,
  ) {
    const failure = await this.prisma.tokenGenerationFailure.create({
      data: {
        saleId,
        deviceId,
        serialNumber,
        reason,
        errorStack,
        retryCount: 0,
      },
    });

    const formattedError = `[${failure.createdAt}] ${serialNumber}: ${reason}`;

    await this.prisma.sales.update({
      where: { id: saleId },
      data: { lastTokenGenerationError: formattedError },
    });
  }

  async getFailuresBySale(saleId: string) {
    return this.prisma.tokenGenerationFailure.findMany({
      where: { saleId },
      include: { device: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getUnresolvedFailures() {
    return this.prisma.tokenGenerationFailure.findMany({
      where: { resolvedAt: null },
      include: {
        sale: {
          select: {
            id: true,
            formattedSaleId: true,
            customer: {
              select: { firstname: true, lastname: true, phone: true },
            },
          },
        },
        device: {
          select: { id: true, serialNumber: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

//   async retryTokenGeneration(
//     failureId: string,
//     generateTokenFn: () => Promise<any>,
//   ) {
//     const failure = await this.prisma.tokenGenerationFailure.findUnique({
//       where: { id: failureId },
//     });

//     if (!failure) {
//       throw new NotFoundException('Failure record not found');
//     }

//     if (failure.resolvedAt) {
//       throw new Error('This failure has already been resolved');
//     }

//     try {
//       const result = await generateTokenFn();

//       await this.prisma.tokenGenerationFailure.update({
//         where: { id: failureId },
//         data: {
//           resolvedAt: new Date(),
//           lastRetryAt: new Date(),
//         },
//       });

//       return { success: true, result };
//     } catch (error) {
//       await this.prisma.tokenGenerationFailure.update({
//         where: { id: failureId },
//         data: {
//           retryCount: { increment: 1 },
//           lastRetryAt: new Date(),
//           reason: error.message,
//           errorStack: error.stack,
//         },
//       });

//       throw error;
//     }
//   }

  async resolveFailure(failureId: string, resolvedBy: string, notes?: string) {
    return this.prisma.tokenGenerationFailure.update({
      where: { id: failureId },
      data: {
        resolvedAt: new Date(),
        resolvedBy,
        notes,
      },
    });
  }

  async getFailureSummary() {
    const [total, unresolved, byReason] = await Promise.all([
      this.prisma.tokenGenerationFailure.count(),
      this.prisma.tokenGenerationFailure.count({
        where: { resolvedAt: null },
      }),
      this.prisma.tokenGenerationFailure.groupBy({
        by: ['reason'],
        _count: { id: true },
        where: { resolvedAt: null },
      }),
    ]);

    return {
      total,
      unresolved,
      unresolvedByReason: byReason.map((r) => ({
        reason: r.reason,
        count: r._count.id,
      })),
    };
  }

  async deleteFailure(failureId: string) {
    return this.prisma.tokenGenerationFailure.delete({
      where: { id: failureId },
    });
  }
}
