import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Agent, AgentCategory, TaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTaskDto } from 'src/task-management/dto/create-task.dto';
import { DeviceService } from 'src/device/device.service';
import { UpdateDeviceLocationDto } from 'src/device/dto/update-device.dto';
import { AgentsService } from 'src/agents/agents.service';

@Injectable()
export class InstallerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deviceService: DeviceService,
    private readonly agentService: AgentsService,
  ) {}

  async createTask(
    data: CreateTaskDto & {
      customerId: string;
      assignedBy?: string;
      requestingAgentId?: string;
    },
  ) {
    const {
      // installerAgentId,
      customerId,
      requestingAgentId,
      saleId,
      scheduledDate,
      assignedBy,
      ...rest
    } = data;

    // const agent = await this.prisma.installerTask.findFirst({
    //   where: {
    //     id: installerAgentId,
    //   },
    // });

    // if (!agent) {
    //   throw new NotFoundException('Installer agent not found');
    // }

    // const customer = await this.prisma.customer.findFirst({
    //   where: {
    //     id: customerId,
    //   },
    // });

    // if (!customer) {
    //   throw new NotFoundException('Customer agent not found');
    // }

    return this.prisma.installerTask.create({
      data: {
        ...rest,
        status: TaskStatus.PENDING,
        sale: { connect: { id: saleId } },
        customer: { connect: { id: customerId } },
        // scheduledDate: scheduledDate ? new Date(scheduledDate) : undefined,
        // assigner: { connect: { id: assignedBy } },
        // installerAgent: { connect: { id: installerAgentId } },
        ...(assignedBy && {
          assigner: { connect: { id: assignedBy } },
        }),
        ...(requestingAgentId && {
          requestingAgent: { connect: { id: requestingAgentId } },
        }),
        ...(scheduledDate && {
          scheduledDate: new Date(scheduledDate),
        }),
      },
    });
  }

  async acceptTask(taskId: string, installerAgentId: string) {
    const task = await this.prisma.installerTask.findFirst({
      where: {
        id: taskId,
        installerAgentId,
        status: TaskStatus.PENDING,
      },
    });

    if (!task) {
      throw new NotFoundException('Task not found or not available');
    }

    return this.prisma.installerTask.update({
      where: { id: taskId },
      data: {
        status: TaskStatus.ACCEPTED,
        acceptedAt: new Date(),
      },
    });
  }

  async rejectTask(taskId: string, installerAgentId: string, reason?: string) {
    const task = await this.prisma.installerTask.findFirst({
      where: {
        id: taskId,
        installerAgentId,
        status: TaskStatus.PENDING,
      },
    });

    if (!task) {
      throw new NotFoundException('Task not found or not available');
    }

    return this.prisma.installerTask.update({
      where: { id: taskId },
      data: {
        status: TaskStatus.REJECTED,
        rejectedAt: new Date(),
        rejectionReason: reason,
      },
    });
  }

  async completeTask(taskId: string, installerAgentId: string) {
    const task = await this.prisma.installerTask.findFirst({
      where: {
        id: taskId,
        installerAgentId,
        status: { in: [TaskStatus.ACCEPTED, TaskStatus.IN_PROGRESS] },
      },
    });

    if (!task) {
      throw new NotFoundException('Task not found or not in progress');
    }

    return this.prisma.installerTask.update({
      where: { id: taskId },
      data: {
        status: TaskStatus.COMPLETED,
        completedDate: new Date(),
      },
    });
  }

  async getTaskHistory(installerAgentId: string) {
    return this.prisma.installerTask.findMany({
      where: {
        installerAgentId,
        status: { in: [TaskStatus.COMPLETED, TaskStatus.REJECTED] },
      },
      include: {
        sale: {
          include: {
            saleItems: {
              include: {
                product: true,
                devices: true,
              },
            },
          },
        },
        customer: true,
        requestingAgent: {
          include: { user: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getInstallationHistory(installerAgentId: string) {
    return this.prisma.installerTask.findMany({
      where: {
        installerAgentId,
        status: TaskStatus.COMPLETED,
      },
      include: {
        sale: {
          include: {
            saleItems: {
              include: {
                product: true,
                devices: true,
              },
            },
          },
        },
        customer: true,
      },
      orderBy: { completedDate: 'desc' },
    });
  }

  async getInstallerDashboard(agentId: string) {
    const agent = await this.prisma.agent.findUnique({
      where: { id: agentId },
      include: { user: true },
    });

    if (!agent || agent.category !== AgentCategory.INSTALLER) {
      throw new BadRequestException('Invalid agent or category');
    }

    const installationStats = await this.getInstallationStatistics(agentId);
    const taskStats = await this.getTaskStatistics(agentId);
    const newTasks = await this.getNewTasks(agentId);
    const recentInstallations = await this.getRecentInstallations(agentId);

    return {
      overview: {
        totalInstallations: installationStats.total,
        totalDevices: installationStats.devices,
        newTasks: taskStats.pending,
      },
      taskStatistics: {
        total: taskStats.total,
        pending: taskStats.pending,
        accepted: taskStats.accepted,
        completed: taskStats.completed,
        cancelled: taskStats.cancelled,
      },
      installationStatistics: {
        total: installationStats.total,
        devices: installationStats.devices,
        completionRate: installationStats.completionRate,
      },
      newTasks: newTasks.slice(0, 5),
      recentActivity: recentInstallations.slice(0, 10),
    };
  }

  async updateInstallationLocation(
    agent: Agent,
    taskId: string,
    locationData: UpdateDeviceLocationDto,
  ) {
    const task = await this.agentService.getAgentTask(agent, taskId);

    const deviceIds = task.sale.saleItems.flatMap((item) =>
      item.devices.map((device) => device.id),
    );

    if (deviceIds.length === 0) {
      throw new BadRequestException(
        'No devices found for this installation task',
      );
    }

    const results = [];
    for (const deviceId of deviceIds) {
      const updatedDevice = await this.deviceService.updateDeviceLocation(
        deviceId,
        locationData,
        agent.id,
      );
      results.push(updatedDevice);
    }

    await this.completeTask(taskId, agent.id);

    return {
      message: 'Installation location updated and task completed',
      updatedDevices: results,
      completedTask: taskId,
    };
  }

  private async getInstallationStatistics(agentId: string) {
    const completedTasks = await this.prisma.installerTask.findMany({
      where: {
        installerAgentId: agentId,
        status: TaskStatus.COMPLETED,
        NOT: {
          sale: null
        }
      },
      include: {
        sale: {
          include: {
            saleItems: {
              include: {
                devices: true,
              },
            },
          },
        },
      },
    });

    const totalDevices = completedTasks.reduce((sum, task) => {
      return (
        sum +
        task.sale.saleItems.reduce((itemSum, item) => {
          return itemSum + item.devices.length;
        }, 0)
      );
    }, 0);

    const totalTasks = await this.prisma.installerTask.count({
      where: { installerAgentId: agentId },
    });

    const completionRate =
      totalTasks > 0 ? (completedTasks.length / totalTasks) * 100 : 0;

    return {
      total: completedTasks.length,
      devices: totalDevices,
      completionRate: Math.round(completionRate),
    };
  }

  private async getTaskStatistics(agentId: string) {
    const taskCounts = await this.prisma.installerTask.groupBy({
      by: ['status'],
      where: { installerAgentId: agentId },
      _count: {
        id: true,
      },
    });

    const stats = {
      total: 0,
      pending: 0,
      accepted: 0,
      completed: 0,
      cancelled: 0,
    };

    taskCounts.forEach((count) => {
      stats.total += count._count.id;
      switch (count.status) {
        case TaskStatus.PENDING:
          stats.pending = count._count.id;
          break;
        case TaskStatus.ACCEPTED:
        case TaskStatus.IN_PROGRESS:
          stats.accepted += count._count.id;
          break;
        case TaskStatus.COMPLETED:
          stats.completed = count._count.id;
          break;
        case TaskStatus.CANCELLED:
        case TaskStatus.REJECTED:
          stats.cancelled += count._count.id;
          break;
      }
    });

    return stats;
  }

  private async getNewTasks(agentId: string) {
    return this.prisma.installerTask.findMany({
      where: {
        installerAgentId: agentId,
        status: TaskStatus.PENDING,
      },
      include: {
        customer: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            phone: true,
            location: true,
          },
        },
        sale: {
          include: {
            saleItems: {
              include: {
                product: {
                  select: {
                    name: true,
                    category: true,
                  },
                },
                devices: {
                  select: {
                    id: true,
                    serialNumber: true,
                    isTokenable: true,
                  },
                },
              },
            },
          },
        },
        requestingAgent: {
          include: {
            user: {
              select: {
                firstname: true,
                lastname: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
  }

  private async getRecentInstallations(agentId: string) {
    return this.prisma.installerTask.findMany({
      where: {
        installerAgentId: agentId,
        status: TaskStatus.COMPLETED,
      },
      include: {
        customer: {
          select: {
            firstname: true,
            lastname: true,
            location: true,
          },
        },
        sale: {
          include: {
            saleItems: {
              include: {
                product: {
                  select: {
                    name: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { completedDate: 'desc' },
      take: 15,
    });
  }
}
