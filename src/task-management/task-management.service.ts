import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TaskStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { GetTaskQueryDto } from './dto/get-task-query.dto';

@Injectable()
export class TaskManagementService {
  constructor(private readonly prisma: PrismaService) {}

  async assignInstallerTask(
    taskId: string,
    installerAgentId: string,
    reqUserId: string,
  ) {
    // const user = await this.prisma.user.findUnique({
    //   where: { id: reqUserId },
    //   include: {
    //     agentDetails: true,
    //   },
    // });

    // if (user.agentDetails) {
    //   const installers = await this.prisma.agentInstallerAssignment.findFirst({
    //     where: {
    //       agentId: user.agentDetails.id,
    //       installerId: installerAgentId,
    //     },
    //   });

    //   if (!installers) {
    //     throw new ForbiddenException(
    //       'You do not have permission to assign task to this installer',
    //     );
    //   }
    // }

    return this.prisma.installerTask.update({
      where: { id: taskId },
      data: {
        installerAgentId: installerAgentId,
        assignedBy: reqUserId,
      },
    });
  }

  async getTasks(query: GetTaskQueryDto) {
    const {
      page = 1,
      limit = 10,
      agentId,
      agentIds,
      sortField = 'createdAt',
      sortOrder = 'desc',
      search,
      status,
      customerId,
      installerId,
      installerIds,
      fromDate,
      toDate,
      dueDateFrom,
      dueDateTo,
    } = query;

    const pageNumber = Math.max(1, parseInt(String(page), 10));
    const limitNumber = Math.max(1, parseInt(String(limit), 10));
    const skip = (pageNumber - 1) * limitNumber;

    // Prepare agent IDs array
    const finalAgentIds = agentIds || (agentId ? [agentId] : undefined);
    const finalInstallerIds =
      installerIds || (installerId ? [installerId] : undefined) || [];

    // Build WHERE conditions
    const whereConditions: Prisma.InstallerTaskWhereInput = {
      AND: [
        search
          ? {
              OR: [
                {
                  installationAddress: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
                {
                  description: {
                    contains: search,
                    mode: 'insensitive',
                  },
                },
                {
                  customer: {
                    OR: [
                      {
                        firstname: {
                          contains: search,
                          mode: 'insensitive',
                        },
                      },
                      {
                        lastname: {
                          contains: search,
                          mode: 'insensitive',
                        },
                      },
                      {
                        phone: {
                          contains: search,
                          mode: 'insensitive',
                        },
                      },
                      {
                        email: {
                          contains: search,
                          mode: 'insensitive',
                        },
                      },
                    ],
                  },
                },
              ],
            }
          : {},

        // Requesting agent filter
        finalAgentIds && finalAgentIds.length > 0
          ? { requestingAgentId: { in: finalAgentIds } }
          : {},

        // Installer agent filter
        finalInstallerIds && finalInstallerIds.length > 0
          ? { installerAgentId: { in: finalInstallerIds } }
          : {},

        // Customer filter
        customerId ? { customerId: customerId } : {},

        // Status filter
        status ? { status } : {},

        // Date range filters (created date)
        fromDate || toDate
          ? {
              createdAt: {
                ...(fromDate && { gte: new Date(fromDate) }),
                ...(toDate && { lte: new Date(toDate) }),
              },
            }
          : {},

        // Date range filters (scheduled/due date)
        dueDateFrom || dueDateTo
          ? {
              scheduledDate: {
                ...(dueDateFrom && { gte: new Date(dueDateFrom) }),
                ...(dueDateTo && { lte: new Date(dueDateTo) }),
              },
            }
          : {},
      ],
    };

    // Validate sort field
    const validSortFields = ['createdAt', 'scheduledDate', 'status'];
    const finalSortField = validSortFields.includes(sortField)
      ? sortField
      : 'createdAt';

    const orderBy: Prisma.InstallerTaskOrderByWithRelationInput = {
      [finalSortField]: sortOrder === 'asc' ? 'asc' : 'desc',
    };

    // Execute parallel queries
    const [tasks, totalCount, statusCounts] = await Promise.all([
      // Main task list
      this.prisma.installerTask.findMany({
        where: whereConditions,
        skip,
        take: limitNumber,
        orderBy,
        include: {
          sale: {
            include: {
              saleItems: {
                select: {
                  devices: true,
                }
              }
            }
          },
          customer: {
            select: {
              id: true,
              firstname: true,
              lastname: true,
              phone: true,
              email: true,
              location: true,
              state: true,
              lga: true,
            },
          },
          requestingAgent: {
            include: {
              user: {
                select: {
                  id: true,
                  firstname: true,
                  lastname: true,
                  email: true,
                },
              },
            },
          },
          installerAgent: {
            include: {
              user: {
                select: {
                  id: true,
                  firstname: true,
                  lastname: true,
                  email: true,
                  phone: true,
                },
              },
            },
          },
          assigner: {
            select: {
              id: true,
              firstname: true,
              lastname: true,
              email: true,
            },
          },
        },
      }),

      // Total count
      this.prisma.installerTask.count({
        where: whereConditions,
      }),

      // Status counts
      this.prisma.installerTask.groupBy({
        by: ['status'],
        where: whereConditions,
        _count: { id: true },
      }),
    ]);

    // Build status summary
    const byStatus: Record<string, number> = {};
    let pendingCount = 0;
    let inProgressCount = 0;
    let completedCount = 0;

    for (const count of statusCounts) {
      byStatus[count.status] = count._count.id;
      switch (count.status) {
        case TaskStatus.PENDING:
        case TaskStatus.ACCEPTED:
          pendingCount += count._count.id;
          break;
        case TaskStatus.IN_PROGRESS:
          inProgressCount += count._count.id;
          break;
        case TaskStatus.COMPLETED:
          completedCount += count._count.id;
          break;
      }
    }

    return {
      tasks,
      pagination: {
        page: pageNumber,
        limit: limitNumber,
        total: totalCount,
        totalPages: limitNumber === 0 ? 0 : Math.ceil(totalCount / limitNumber),
      },
      summary: {
        totalTasks: totalCount,
        byStatus,
        pendingCount,
        inProgressCount,
        completedCount,
      },
    };
  }

  async getTaskById(taskId: string) {
    const task = await this.prisma.installerTask.findUnique({
      where: { id: taskId },
      include: {
        sale: {
          include: {
            saleItems: {
              select: {
                devices: true,
              },
            },
          },
        },
        customer: {
          select: {
            id: true,
            firstname: true,
            lastname: true,
            phone: true,
            email: true,
            location: true,
            state: true,
            lga: true,
          },
        },
        requestingAgent: {
          select: {
            id: true,
            category: true,
            user: {
              select: {
                id: true,
                firstname: true,
                lastname: true,
                email: true,
              },
            },
          },
        },
        installerAgent: {
          select: {
            id: true,
            category: true,
            user: {
              select: {
                id: true,
                firstname: true,
                lastname: true,
                email: true,
                phone: true,
              },
            },
          },
        },
        assigner: {
          select: { id: true, firstname: true, lastname: true, email: true },
        },
      },
    });

    if (!task) {
      throw new NotFoundException(`Task with ID ${taskId} not found`);
    }

    return task;
  }
}
