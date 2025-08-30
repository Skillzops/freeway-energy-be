import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
    const user = await this.prisma.user.findUnique({
      where: { id: reqUserId },
      include: {
        agentDetails: true,
      },
    });
    if (user.agentDetails) {
      const installers = await this.prisma.agentInstallerAssignment.findFirst({
        where: {
          agentId: user.agentDetails.id,
          installerId: installerAgentId,
        },
      });

      if (!installers) {
        throw new ForbiddenException(
          'You do not have permission to assign task to this installer',
        );
      }
    }

    return this.prisma.installerTask.update({
      where: { id: taskId },
      data: {
        installerAgentId: installerAgentId,
        assignedBy: reqUserId,
      },
    });
  }

  async getTasks(getTasksQuery: GetTaskQueryDto) {
    const {
      page = 1,
      limit = 10,
      agentId,
      sortField,
      sortOrder,
      search,
      status,
      customerId,
      installerId,
    } = getTasksQuery;

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
                { description: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {},
        agentId
          ? {
              requestingAgentId: agentId,
            }
          : {},
        installerId
          ? {
              installerAgentId: installerId,
            }
          : {},
        customerId
          ? {
              customerId: customerId,
            }
          : {},
      ],
    };

    const pageNumber = parseInt(String(page), 10);
    const limitNumber = parseInt(String(limit), 10);

    const skip = (pageNumber - 1) * limitNumber;
    const take = limitNumber;

    const orderBy = {
      [sortField || 'createdAt']: sortOrder || 'asc',
    };

    return this.prisma.installerTask.findMany({
      where: {
        ...whereConditions,
        ...(status ? { status } : {}),
      },
      skip,
      take,
      orderBy,
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
      },
    });
  }
}
