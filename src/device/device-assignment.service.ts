import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import {
  DeviceAssignmentHistoryAction,
  AgentCategory,
  DeviceAssignmentBatchMode,
  DeviceAssignmentBatchStatus,
} from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { ListAgentDevicesQueryDto } from './dto/list-agent-devices';

@Injectable()
export class DeviceAssignmentService {
  constructor(private readonly prisma: PrismaService) {}

  async assignDevice(
    deviceSerial: string,
    agentId: string,
    actorId: string,
    reason?: string,
  ) {
    const device = await this.prisma.device.findFirst({
      where: {
        serialNumber: {
          equals: deviceSerial,
          mode: 'insensitive',
        },
      },
    });

    if (!device) {
      throw new NotFoundException(`Device ${deviceSerial} not found`);
    }

    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId, category: AgentCategory.SALES },
    });

    if (!agent) {
      throw new NotFoundException(`Agent ${agentId} not found`);
    }

    // Check if already assigned to this agent
    const existing = await this.prisma.deviceAssignment.findFirst({
      where: {
        deviceId: device.id,
        agentId,
        isActive: true,
      },
    });

    if (existing) {
      throw new ConflictException(`Device already assigned to this agent`);
    }

    // Check if assigned to another agent
    const activeAssignment = await this.prisma.deviceAssignment.findFirst({
      where: {
        deviceId: device.id,
        isActive: true,
      },
    });

    const fromAgentId = activeAssignment?.agentId;

    // Atomic transaction
    const assignment = await this.prisma.$transaction(async (tx) => {
      // Unassign from previous agent if exists
      if (activeAssignment) {
        await tx.deviceAssignment.update({
          where: { id: activeAssignment.id },
          data: { isActive: false, unassignedAt: new Date() },
        });
      }

      // Create new assignment
      const newAssignment = await tx.deviceAssignment.create({
        data: {
          deviceId: device.id,
          agentId,
          isActive: true,
        },
        include: { device: true, agent: true },
      });

      // Log history
      await tx.deviceAssignmentHistory.create({
        data: {
          deviceId: device.id,
          actorId,
          action: fromAgentId
            ? DeviceAssignmentHistoryAction.REASSIGN
            : DeviceAssignmentHistoryAction.ASSIGN,
          fromAgentId,
          toAgentId: agentId,
          reason,
        },
      });

      return newAssignment;
    });

    return assignment;
  }

  async bulkAssignDevices(
    deviceSerials: string[],
    agentId: string,
    actorId: string,
    mode: DeviceAssignmentBatchMode = DeviceAssignmentBatchMode.ATOMIC,
    reason?: string,
  ) {
    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
    });

    if (!agent) {
      throw new NotFoundException(`Agent ${agentId} not found`);
    }

    // Get all devices
    const devices = await this.prisma.device.findMany({
      where: { serialNumber: { in: deviceSerials } },
    });

    const deviceMap = new Map(devices.map((d) => [d.serialNumber, d]));
    const notFound = deviceSerials.filter((s) => !deviceMap.has(s));

    if (notFound.length > 0 && mode === DeviceAssignmentBatchMode.ATOMIC) {
      throw new BadRequestException(
        `Devices not found: ${notFound.join(', ')}`,
      );
    }

    // Check for already assigned
    const activeAssignments = await this.prisma.deviceAssignment.findMany({
      where: {
        deviceId: { in: devices.map((d) => d.id) },
        isActive: true,
      },
      select: { deviceId: true, agentId: true },
    });

    const assignmentMap = new Map(
      activeAssignments.map((a) => [a.deviceId, a.agentId]),
    );

    const alreadyAssigned = devices.filter(
      (d) => assignmentMap.has(d.id) && assignmentMap.get(d.id) === agentId,
    );

    if (
      alreadyAssigned.length > 0 &&
      mode === DeviceAssignmentBatchMode.ATOMIC
    ) {
      throw new ConflictException(
        `Already assigned: ${alreadyAssigned.map((d) => d.serialNumber).join(', ')}`,
      );
    }

    // Create batch
    const batch = await this.prisma.deviceAssignmentBatch.create({
      data: {
        createdBy: actorId,
        mode,
        totalDevices: devices.length,
        status: DeviceAssignmentBatchStatus.PROCESSING,
      },
    });

    // Process assignments
    const results = [];
    let successCount = 0;
    let failureCount = 0;

    for (const device of devices) {
      try {
        const existing = assignmentMap.get(device.id);

        const result = await this.prisma.$transaction(async (tx) => {
          if (existing && existing !== agentId) {
            await tx.deviceAssignment.updateMany({
              where: { deviceId: device.id, isActive: true },
              data: { isActive: false, unassignedAt: new Date() },
            });
          }

          // Only create if not already assigned to this agent
          if (!existing || existing !== agentId) {
            const assignment = await tx.deviceAssignment.create({
              data: {
                deviceId: device.id,
                agentId,
                batchId: batch.id,
              },
              include: { device: true },
            });

            await tx.deviceAssignmentHistory.create({
              data: {
                deviceId: device.id,
                actorId,
                action:
                  existing && existing !== agentId
                    ? DeviceAssignmentHistoryAction.REASSIGN
                    : DeviceAssignmentHistoryAction.ASSIGN,
                fromAgentId: existing,
                toAgentId: agentId,
                reason,
                batchId: batch.id,
              },
            });

            return { success: true, device: assignment.device, error: null };
          }

          return {
            success: false,
            device,
            error: 'Already assigned to this agent',
          };
        });

        results.push(result);
        if (result.success) successCount++;
        else failureCount++;
      } catch (error) {
        failureCount++;
        results.push({
          success: false,
          device,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Update batch status
    await this.prisma.deviceAssignmentBatch.update({
      where: { id: batch.id },
      data: {
        successCount,
        failureCount,
        status:
          failureCount === 0
            ? DeviceAssignmentBatchStatus.COMPLETED
            : DeviceAssignmentBatchStatus.COMPLETED,
      },
    });

    return { batchId: batch.id, mode, results, successCount, failureCount };
  }

  async unassignDevice(deviceId: string, actorId: string, reason?: string) {
    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
    });

    if (!device) {
      throw new NotFoundException(`Device ${deviceId} not found`);
    }

    const assignment = await this.prisma.deviceAssignment.findFirst({
      where: { deviceId: device.id, isActive: true },
    });

    if (!assignment) {
      throw new NotFoundException(`Device not assigned`);
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.deviceAssignment.update({
        where: { id: assignment.id },
        data: { isActive: false, unassignedAt: new Date() },
      });

      await tx.deviceAssignmentHistory.create({
        data: {
          deviceId: device.id,
          actorId,
          action: DeviceAssignmentHistoryAction.UNASSIGN,
          fromAgentId: assignment.agentId,
          reason,
        },
      });

      return { deviceSerial: deviceId, unassignedFrom: assignment.agentId };
    });

    return result;
  }

  async getAgentDevices(agentId: string, query: ListAgentDevicesQueryDto) {
    const { page = 1, limit = 100 } = query;

    const pageNumber = parseInt(String(page), 10);
    const limitNumber = parseInt(String(limit), 10);

    const skip = (pageNumber - 1) * limitNumber;

    const [devices, total] = await Promise.all([
      this.prisma.deviceAssignment.findMany({
        where: { agentId, isActive: true },
        skip,
        take: limitNumber,
        include: { device: true },
        orderBy: { assignedAt: 'desc' },
      }),
      this.prisma.deviceAssignment.count({
        where: { agentId, isActive: true },
      }),
    ]);

    return {
      devices: devices.map((d) => d.device),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limitNumber),
      },
    };
  }

  async getDeviceHistory(deviceId: string) {
    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
    });

    if (!device) {
      throw new NotFoundException(`Device ${deviceId} not found`);
    }

    return this.prisma.deviceAssignmentHistory.findMany({
      where: { deviceId: device.id },
      include: {
        actor: { select: { id: true, firstname: true, lastname: true } },
        fromAgent: { select: { id: true } },
        toAgent: { select: { id: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async validateDevicesForAgent(
    ids: string[],
    agentId: string,
  ): Promise<boolean> {
    const devices = await this.prisma.device.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });

    const deviceIds = devices.map((d) => d.id);

    const assigned = await this.prisma.deviceAssignment.count({
      where: {
        deviceId: { in: deviceIds },
        agentId,
        isActive: true,
      },
    });

    return assigned === deviceIds.length;
  }

  async getAgentAssignedDevices(
    agentId: string,
    query: ListAgentDevicesQueryDto,
  ) {
    const { page = 1, limit = 100 } = query;
    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
    });

    if (!agent) {
      throw new NotFoundException(`Agent ${agentId} not found`);
    }

    const pageNumber = parseInt(String(page), 10);
    const limitNumber = parseInt(String(limit), 10);

    const skip = (pageNumber - 1) * limitNumber;
    const [assignments, total] = await Promise.all([
      this.prisma.deviceAssignment.findMany({
        where: { agentId, isActive: true },
        skip,
        take: limitNumber,
        include: {
          device: true,
          agent: { select: { id: true } },
        },
        orderBy: { assignedAt: 'desc' },
      }),
      this.prisma.deviceAssignment.count({
        where: { agentId, isActive: true },
      }),
    ]);

    return {
      agentId,
      devices: assignments.map((a) => a.device),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limitNumber),
      },
    };
  }
}
