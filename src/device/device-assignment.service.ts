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
      throw new NotFoundException(
        `Device with serial ${deviceSerial} not found`,
      );
    }

    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId, category: AgentCategory.SALES },
    });

    if (!agent) {
      throw new NotFoundException(`Sales Agent with ID ${agentId} not found`);
    }

    // Check if device is already assigned (to any agent)
    const activeAssignment = await this.prisma.deviceAssignment.findFirst({
      where: {
        deviceId: device.id,
        isActive: true,
      },
      include: {
        agent: {
          select: {
            id: true,
            user: { select: { firstname: true, lastname: true } },
          },
        },
      },
    });

    if (activeAssignment) {
      throw new ConflictException(
        `Device ${deviceSerial} is already assigned to agent ${activeAssignment.agent.user.firstname} ${activeAssignment.agent.user.lastname} (ID: ${activeAssignment.agentId}). ` +
          `Use the reassign module to transfer this device to a different agent.`,
      );
    }

    // Create assignment
    const assignment = await this.prisma.$transaction(async (tx) => {
      const newAssignment = await tx.deviceAssignment.create({
        data: {
          deviceId: device.id,
          agentId,
          isActive: true,
        },
        include: {
          device: true,
          agent: {
            select: {
              id: true,
              user: { select: { firstname: true, lastname: true } },
            },
          },
        },
      });

      await tx.device.update({
        where: { id: device.id },
        data: {
          isAssigned: true,
        },
      });

      // Log history
      await tx.deviceAssignmentHistory.create({
        data: {
          deviceId: device.id,
          actorId,
          action: DeviceAssignmentHistoryAction.ASSIGN,
          toAgentId: agentId,
          reason,
        },
      });

      return newAssignment;
    });

    return {
      success: true,
      message: `Device ${deviceSerial} successfully assigned to agent ${assignment.agent.user.firstname} ${assignment.agent.user.lastname}`,
      assignment,
    };
  }

  /**
   * Reassign device from one agent to another
   * Only for already-assigned devices
   */
  async reassignDevice(
    deviceId: string,
    fromAgentId: string,
    toAgentId: string,
    actorId: string,
    reason?: string,
  ) {
    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
    });

    if (!device) {
      throw new NotFoundException(`Device with ID ${deviceId} not found`);
    }

    const toAgent = await this.prisma.agent.findUnique({
      where: { id: toAgentId, category: AgentCategory.SALES },
    });

    if (!toAgent) {
      throw new NotFoundException(`Sales Agent with ID ${toAgentId} not found`);
    }

    // Check if device is currently assigned to fromAgentId
    const currentAssignment = await this.prisma.deviceAssignment.findFirst({
      where: {
        deviceId,
        agentId: fromAgentId,
        isActive: true,
      },
      include: {
        agent: {
          select: {
            id: true,
            user: { select: { firstname: true, lastname: true } },
          },
        },
      },
    });

    if (!currentAssignment) {
      throw new BadRequestException(
        `Device ${device.serialNumber} is not currently assigned to agent ${fromAgentId}`,
      );
    }

    // Check if device already assigned to toAgent
    const existingAssignment = await this.prisma.deviceAssignment.findFirst({
      where: {
        deviceId,
        agentId: toAgentId,
        isActive: true,
      },
    });

    if (existingAssignment) {
      throw new ConflictException(
        `Device ${device.serialNumber} is already assigned to agent ${toAgentId}`,
      );
    }

    // Reassign
    const result = await this.prisma.$transaction(async (tx) => {
      // Unassign from old agent
      await tx.deviceAssignment.update({
        where: { id: currentAssignment.id },
        data: { isActive: false, unassignedAt: new Date() },
      });

      // Assign to new agent
      const newAssignment = await tx.deviceAssignment.create({
        data: {
          deviceId,
          agentId: toAgentId,
          isActive: true,
        },
        include: {
          device: true,
          agent: {
            select: {
              id: true,
              user: { select: { firstname: true, lastname: true } },
            },
          },
        },
      });

      await tx.device.update({
        where: { id: device.id },
        data: {
          isAssigned: true,
        },
      });

      // Log history
      await tx.deviceAssignmentHistory.create({
        data: {
          deviceId,
          actorId,
          action: DeviceAssignmentHistoryAction.REASSIGN,
          fromAgentId,
          toAgentId,
          reason,
        },
      });

      return newAssignment;
    });

    return {
      success: true,
      message: `Device ${device.serialNumber} successfully reassigned from ${currentAssignment.agent.user.firstname} ${currentAssignment.agent.user.lastname} to ${result.agent.user.firstname} ${result.agent.user.lastname}`,
      fromAgent: currentAssignment.agent,
      toAgent: result.agent,
      device: result.device,
    };
  }

  /**
   * Bulk assign - ONLY unassigned devices, with detailed error reporting
   */
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
      where: {
        serialNumber: {
          in: deviceSerials,
          mode: 'insensitive',
        },
      },
    });

    const deviceMap = new Map(
      devices.map((d) => [d.serialNumber.toUpperCase(), d]),
    );
    const notFoundSerials = deviceSerials.filter(
      (s) => !deviceMap.has(s.toUpperCase()),
    );

    if (
      notFoundSerials.length > 0 &&
      mode === DeviceAssignmentBatchMode.ATOMIC
    ) {
      throw new BadRequestException(
        `ATOMIC mode: Cannot proceed. Devices not found: ${notFoundSerials.join(', ')}. ` +
          `In ATOMIC mode, all devices must exist.`,
      );
    }

    // Check for already assigned devices
    const activeAssignments = await this.prisma.deviceAssignment.findMany({
      where: {
        deviceId: { in: devices.map((d) => d.id) },
        isActive: true,
      },
      // select: { deviceId: true, agentId: true },
      include: {
        agent: {
          select: {
            id: true,
            user: { select: { firstname: true, lastname: true } },
          },
        },
      },
    });

    const assignedDevices = new Map();
    for (const assignment of activeAssignments) {
      const device = devices.find((d) => d.id === assignment.deviceId);
      if (device) {
        assignedDevices.set(device.serialNumber.toUpperCase(), {
          agentId: assignment.agentId,
          agentName: `${assignment.agent.user.firstname} ${assignment.agent.user.lastname}`,
        });
      }
    }

    const alreadyAssignedSerials = Array.from(assignedDevices.keys());

    if (
      alreadyAssignedSerials.length > 0 &&
      mode === DeviceAssignmentBatchMode.ATOMIC
    ) {
      throw new ConflictException(
        `ATOMIC mode: Cannot proceed. Devices already assigned: ` +
          alreadyAssignedSerials
            .map((s) => `${s} (to ${assignedDevices.get(s).agentName})`)
            .join(', ') +
          `. In ATOMIC mode, no device can be pre-assigned. Use PARTIAL mode to skip already-assigned devices.`,
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

    // Categorize devices
    const toAssign = [];
    const skipped = [];
    const failed = [];

    for (const serial of deviceSerials) {
      const device = deviceMap.get(serial.toUpperCase());

      if (!device) {
        skipped.push({
          serial,
          reason: 'Device not found in system',
          status: 'NOT_FOUND',
        });
        continue;
      }

      const assignmentInfo = assignedDevices.get(
        device.serialNumber.toUpperCase(),
      );
      if (assignmentInfo) {
        skipped.push({
          serial: device.serialNumber,
          reason: `Already assigned to ${assignmentInfo.agentName}`,
          status: 'ALREADY_ASSIGNED',
          assignedAgentId: assignmentInfo.agentId,
        });
        continue;
      }

      toAssign.push(device);
    }

    // Process assignments
    const assigned = [];
    let successCount = 0;
    let failureCount = 0;

    for (const device of toAssign) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const assignment = await tx.deviceAssignment.create({
            data: {
              deviceId: device.id,
              agentId,
              batchId: batch.id,
            },
            include: { device: true },
          });

          await tx.device.update({
            where: { id: device.id },
            data: {
              isAssigned: true,
            },
          });

          await tx.deviceAssignmentHistory.create({
            data: {
              deviceId: device.id,
              actorId,
              action: DeviceAssignmentHistoryAction.ASSIGN,
              toAgentId: agentId,
              reason,
              batchId: batch.id,
            },
          });

          return { success: true, device: assignment.device };
        });

        assigned.push({
          serial: device.serialNumber,
          deviceId: device.id,
          status: 'SUCCESS',
        });
        successCount++;
      } catch (error) {
        failureCount++;
        failed.push({
          serial: device.serialNumber,
          error: error instanceof Error ? error.message : 'Unknown error',
          status: 'FAILED',
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

    return {
      batchId: batch.id,
      mode,
      summary: {
        totalRequested: deviceSerials.length,
        assigned: successCount,
        skipped: skipped.length,
        failed: failureCount,
      },
      assigned,
      skipped,
      failed,
    };
  }

  /**
   * Unassign device from agent
   */
  async unassignDevice(deviceId: string, actorId: string, reason?: string) {
    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
    });

    if (!device) {
      throw new NotFoundException(`Device with ID ${deviceId} not found`);
    }

    const assignment = await this.prisma.deviceAssignment.findFirst({
      where: { deviceId, isActive: true },
      include: {
        agent: {
          select: {
            id: true,
            user: { select: { firstname: true, lastname: true } },
          },
        },
      },
    });

    if (!assignment) {
      throw new NotFoundException(
        `Device ${device.serialNumber} is not currently assigned to any agent`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.deviceAssignment.update({
        where: { id: assignment.id },
        data: { isActive: false, unassignedAt: new Date() },
      });

      await tx.device.update({
        where: { id: device.id },
        data: {
          isAssigned: false,
        },
      });

      await tx.deviceAssignmentHistory.create({
        data: {
          deviceId,
          actorId,
          action: DeviceAssignmentHistoryAction.UNASSIGN,
          fromAgentId: assignment.agentId,
          reason,
        },
      });

      return {
        success: true,
        message: `Device ${device.serialNumber} successfully unassigned from ${assignment.agent.user.firstname} ${assignment.agent.user.lastname}`,
        deviceSerial: device.serialNumber,
        deviceId: device.id,
        unassignedFrom: assignment.agent,
      };
    });

    return result;
  }

  /**
   * Get unassigned devices
   */

  async getUnassignedDevices(page: number = 1, limit: number = 100) {
    const pageNumber = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNumber = Math.max(1, parseInt(String(limit), 10) || 100);
    const skip = (pageNumber - 1) * limitNumber;

    const [devices, total] = await Promise.all([
      this.prisma.device.findMany({
        where: { isAssigned: false },
        select: {
          id: true,
          serialNumber: true,
          key: true,
          isTokenable: true,
          hardwareModel: true,
          firmwareVersion: true,
          installationStatus: true,
          startingCode: true,
          timeDivider: true,
          count: true,
          isUsed: true,
          isAssigned: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNumber,
      }),
      this.prisma.device.count({ where: { isAssigned: false } }),
    ]);

    return {
      devices,
      pagination: {
        page: pageNumber,
        limit: limitNumber,
        total,
        totalPages: Math.ceil(total / limitNumber),
      },
    };
  }

  /**
   * Get agent's assigned devices
   */
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
        page: pageNumber,
        limit: limitNumber,
        total,
        totalPages: Math.ceil(total / limitNumber),
      },
    };
  }

  /**
   * Get device assignment history by device ID
   */
  async getDeviceHistory(deviceId: string) {
    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
    });

    if (!device) {
      throw new NotFoundException(`Device with ID ${deviceId} not found`);
    }

    const history = await this.prisma.deviceAssignmentHistory.findMany({
      where: { deviceId },
      include: {
        actor: { select: { id: true, firstname: true, lastname: true } },
        fromAgent: { select: { id: true } },
        toAgent: { select: { id: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      deviceId,
      deviceSerial: device.serialNumber,
      totalChanges: history.length,
      history,
    };
  }

  /**
   * Validate devices for agent (for sales creation)
   */
  async validateDevicesForAgent(
    deviceIds: string[],
    agentId: string,
  ): Promise<boolean> {
    const assigned = await this.prisma.deviceAssignment.count({
      where: {
        deviceId: { in: deviceIds },
        agentId,
        isActive: true,
      },
    });

    return assigned === deviceIds.length;
  }

  /**
   * Get admin view of agent's assigned devices
   */
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
        page: pageNumber,
        limit: limitNumber,
        total,
        totalPages: Math.ceil(total / limitNumber),
      },
    };
  }
}
