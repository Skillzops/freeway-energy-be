import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { DeviceAssignmentHistoryAction } from '@prisma/client';

@Injectable()
export class DeviceAssignmentMigrationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Backfill device assignments from existing sales
   * Creates assignment records for devices used in sales to their sale creator
   */
  async backfillDeviceAssignmentsFromSales(): Promise<{
    success: boolean;
    summary: {
      totalSales: number;
      totalDevices: number;
      assignmentsCreated: number;
      skipped: number;
      errors: string[];
    };
  }> {
    const errors: string[] = [];
    let assignmentsCreated = 0;
    let skipped = 0;

    try {
      // Get all sales with their items and devices
      const sales = await this.prisma.sales.findMany({
        include: {
          saleItems: {
            include: {
              devices: true,
            },
          },
          creatorDetails: {
            include: {
              agentDetails: true,
            },
          },
        },
      });

      if (sales.length === 0) {
        return {
          success: true,
          summary: {
            totalSales: 0,
            totalDevices: 0,
            assignmentsCreated: 0,
            skipped: 0,
            errors: [],
          },
        };
      }

      let totalDevices = 0;

      for (const sale of sales) {
        // Get agent from sale creator's user
        if (!sale.creatorDetails?.agentDetails) {
          errors.push(`Sale ${sale.id}: Creator has no agent details`);
          continue;
        }

        const agentId = sale.creatorDetails.agentDetails.id;

        // Get all devices from sale items
        const devices = sale.saleItems.flatMap((item) => item.devices || []);
        totalDevices += devices.length;

        for (const device of devices) {
          try {
            // Check if assignment already exists
            const existing = await this.prisma.deviceAssignment.findFirst({
              where: {
                deviceId: device.id,
                agentId,
                isActive: true,
              },
            });

            if (existing) {
              skipped++;
              continue;
            }

            // Check if device is assigned to another agent (active)
            const activeAssignment =
              await this.prisma.deviceAssignment.findFirst({
                where: {
                  deviceId: device.id,
                  isActive: true,
                },
              });

            const fromAgentId = activeAssignment?.agentId;

            // Create assignment in transaction
            await this.prisma.$transaction(async (tx) => {
              // Unassign from previous agent if exists
              if (activeAssignment) {
                await tx.deviceAssignment.update({
                  where: { id: activeAssignment.id },
                  data: {
                    isActive: false,
                    unassignedAt: new Date(),
                  },
                });
              }

              // Create new assignment
              await tx.deviceAssignment.create({
                data: {
                  deviceId: device.id,
                  agentId,
                  isActive: true,
                },
              });

              // Log history (system migration)
              await tx.deviceAssignmentHistory.create({
                data: {
                  deviceId: device.id,
                  actorId: sale.creatorDetails.id,
                  action: fromAgentId ? DeviceAssignmentHistoryAction.REASSIGN : DeviceAssignmentHistoryAction.ASSIGN,
                  fromAgentId,
                  toAgentId: agentId,
                  reason: `Backfill from sale ${sale.formattedSaleId || sale.id}`,
                },
              });
            });

            assignmentsCreated++;
          } catch (error) {
            errors.push(
              `Device ${device.serialNumber} in sale ${sale.id}: ${
                error instanceof Error ? error.message : 'Unknown error'
              }`,
            );
          }
        }
      }

      return {
        success: errors.length === 0,
        summary: {
          totalSales: sales.length,
          totalDevices,
          assignmentsCreated,
          skipped,
          errors: errors.length > 0 ? errors : [],
        },
      };
    } catch (error) {
      errors.push(
        `Migration failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      return {
        success: false,
        summary: {
          totalSales: 0,
          totalDevices: 0,
          assignmentsCreated,
          skipped,
          errors,
        },
      };
    }
  }

  /**
   * Get migration preview (what would be assigned)
   */
  async previewMigration(): Promise<{
    totalSales: number;
    totalDevices: number;
    wouldCreate: number;
    wouldSkip: number;
    preview: Array<{
      sale: { id: string; formattedSaleId: string };
      agentId: string;
      devices: Array<{ id: string; serialNumber: string }>;
    }>;
  }> {
    const sales = await this.prisma.sales.findMany({
      include: {
        saleItems: {
          include: {
            devices: true,
          },
        },
        creatorDetails: {
          include: {
            agentDetails: true,
          },
        },
      },
      take: 10, // Preview first 10 sales
    });

    let totalDevices = 0;
    let wouldCreate = 0;
    let wouldSkip = 0;
    const preview = [];

    for (const sale of sales) {
      if (!sale.creatorDetails?.agentDetails) continue;

      const devices = sale.saleItems.flatMap((item) => item.devices || []);
      totalDevices += devices.length;

      const devicesWithStatus = [];

      for (const device of devices) {
        const existing = await this.prisma.deviceAssignment.findFirst({
          where: {
            deviceId: device.id,
            agentId: sale.creatorDetails.agentDetails.id,
            isActive: true,
          },
        });

        if (existing) {
          wouldSkip++;
        } else {
          wouldCreate++;
          devicesWithStatus.push({
            id: device.id,
            serialNumber: device.serialNumber,
          });
        }
      }

      if (devicesWithStatus.length > 0) {
        preview.push({
          sale: {
            id: sale.id,
            formattedSaleId: sale.formattedSaleId || sale.id,
          },
          agentId: sale.creatorDetails.agentDetails.id,
          devices: devicesWithStatus,
        });
      }
    }

    return {
      totalSales: sales.length,
      totalDevices,
      wouldCreate,
      wouldSkip,
      preview,
    };
  }
}
