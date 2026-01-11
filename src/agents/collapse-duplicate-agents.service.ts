import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CollapseDuplicateAgentRecordsDto } from './dto/collapse-dupliacte-agent-record.dto';

@Injectable()
export class AgentCollapseService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Collapse duplicate agent records by transferring all data from duplicates to the correct agent
   * @param body Contains correct agentId and array of duplicateAgentIds
   * @returns Summary of operations performed
   */
  async collapseDuplicateAgentRecords(
    body: CollapseDuplicateAgentRecordsDto,
  ): Promise<{
    success: boolean;
    message: string;
    summary: {
      correctAgentId: string;
      duplicateAgentsDeleted: number;
      recordsTransferred: Record<string, number>;
      errors: string[];
    };
  }> {
    const { agentId: correctAgentId, duplicateAgentIds } = body;
    const errors: string[] = [];
    const recordsTransferred: Record<string, number> = {};

    try {
      // Validate correct agent exists
      const correctAgent = await this.prisma.agent.findUnique({
        where: { id: correctAgentId },
      });

      if (!correctAgent) {
        throw new NotFoundException(
          `Correct agent ${correctAgentId} not found`,
        );
      }

      // Validate no duplicates in the correct agent
      if (duplicateAgentIds.includes(correctAgentId)) {
        throw new BadRequestException(
          'Correct agent ID cannot be in the duplicate list',
        );
      }

      // Verify all duplicate agents exist
      const existingDuplicates = await this.prisma.agent.findMany({
        where: {
          id: { in: duplicateAgentIds },
          category: correctAgent.category,
        },
      });

      if (existingDuplicates.length !== duplicateAgentIds.length) {
        throw new BadRequestException(
          `Some duplicate agents not found. Found ${existingDuplicates.length} of ${duplicateAgentIds.length}`,
        );
      }

      // Transfer all records from duplicates to correct agent
      recordsTransferred['agentCustomers'] = await this.transferAgentCustomers(
        correctAgentId,
        duplicateAgentIds,
        errors,
      );

      recordsTransferred['wallets'] = await this.transferWallets(
        correctAgentId,
        duplicateAgentIds,
        errors,
      );

      recordsTransferred['walletTransactions'] =
        await this.transferWalletTransactions(
          correctAgentId,
          duplicateAgentIds,
          errors,
        );

      recordsTransferred['productAssignments'] =
        await this.transferProductAssignments(
          correctAgentId,
          duplicateAgentIds,
          errors,
        );

      recordsTransferred['taskAssignments'] =
        await this.transferTaskAssignments(
          correctAgentId,
          duplicateAgentIds,
          errors,
        );

      recordsTransferred['installerTasks'] = await this.transferInstallerTasks(
        correctAgentId,
        duplicateAgentIds,
        errors,
      );

      recordsTransferred['requestingAgentTasks'] =
        await this.transferRequestingAgentTasks(
          correctAgentId,
          duplicateAgentIds,
          errors,
        );

      recordsTransferred['auditLogs'] = await this.transferAuditLogs(
        correctAgentId,
        duplicateAgentIds,
        errors,
      );

      recordsTransferred['createdSales'] = await this.transferCreatedSales(
        correctAgentId,
        duplicateAgentIds,
        errors,
      );

      recordsTransferred['createdCustomers'] =
        await this.transferCreatedCustomers(
          correctAgentId,
          duplicateAgentIds,
          errors,
        );

      // Delete duplicate agents
      const deletedCount = await this.deleteDuplicateAgents(
        duplicateAgentIds,
        errors,
      );

      return {
        success: errors.length === 0,
        message:
          errors.length === 0
            ? `Successfully collapsed ${duplicateAgentIds.length} duplicate agents into ${correctAgentId}`
            : `Completed with ${errors.length} errors. Check the errors array for details.`,
        summary: {
          correctAgentId,
          duplicateAgentsDeleted: deletedCount,
          recordsTransferred,
          errors: errors.length > 0 ? errors : [],
        },
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Transfer AgentCustomer records from duplicates to correct agent
   */
  private async transferAgentCustomers(
    correctAgentId: string,
    duplicateAgentIds: string[],
    errors: string[],
  ): Promise<number> {
    try {
      // Find existing customer assignments for correct agent
      const existingAssignments = await this.prisma.agentCustomer.findMany({
        where: {
          agentId: correctAgentId,
        },
        select: { customerId: true },
      });

      const existingCustomerIds = new Set(
        existingAssignments.map((a) => a.customerId),
      );

      // Get duplicate assignments that aren't already assigned to correct agent
      const duplicateAssignments = await this.prisma.agentCustomer.findMany({
        where: {
          agentId: { in: duplicateAgentIds },
        },
      });

      let transferredCount = 0;

      for (const assignment of duplicateAssignments) {
        // Skip if already assigned to correct agent
        if (existingCustomerIds.has(assignment.customerId)) {
          continue;
        }

        try {
          await this.prisma.agentCustomer.update({
            where: { id: assignment.id },
            data: { agentId: correctAgentId },
          });
          transferredCount++;
        } catch (error) {
          errors.push(
            `Failed to transfer AgentCustomer ${assignment.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      // Delete remaining duplicate assignments (duplicates that were already assigned to correct agent)
      await this.prisma.agentCustomer.deleteMany({
        where: {
          agentId: { in: duplicateAgentIds },
        },
      });

      return transferredCount;
    } catch (error) {
      errors.push(
        `Error transferring AgentCustomer: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }

  /**
   * Transfer Wallet records from duplicates to correct agent
   */
  private async transferWallets(
    correctAgentId: string,
    duplicateAgentIds: string[],
    errors: string[],
  ): Promise<number> {
    try {
      // Get or create wallet for correct agent
      let correctAgentWallet = await this.prisma.wallet.findFirst({
        where: { agentId: correctAgentId },
      });

      if (!correctAgentWallet) {
        correctAgentWallet = await this.prisma.wallet.create({
          data: {
            agentId: correctAgentId,
            balance: 0,
          },
        });
      }

      // Get duplicate wallets
      const duplicateWallets = await this.prisma.wallet.findMany({
        where: {
          agentId: { in: duplicateAgentIds },
        },
      });

      let transferredCount = 0;

      for (const dupWallet of duplicateWallets) {
        try {
          // Add duplicate wallet balance to correct agent's wallet
          const newBalance = correctAgentWallet.balance + dupWallet.balance;

          await this.prisma.wallet.update({
            where: { id: correctAgentWallet.id },
            data: { balance: newBalance },
          });

          transferredCount++;
        } catch (error) {
          errors.push(
            `Failed to merge wallet for duplicate agent ${dupWallet.agentId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      // Delete duplicate wallets (their balance is now merged)
      await this.prisma.wallet.deleteMany({
        where: {
          agentId: { in: duplicateAgentIds },
        },
      });

      return transferredCount;
    } catch (error) {
      errors.push(
        `Error transferring Wallets: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }

  /**
   * Transfer WalletTransaction records from duplicates to correct agent
   */
  private async transferWalletTransactions(
    correctAgentId: string,
    duplicateAgentIds: string[],
    errors: string[],
  ): Promise<number> {
    try {
      const transactions = await this.prisma.walletTransaction.updateMany({
        where: {
          agentId: { in: duplicateAgentIds },
        },
        data: {
          agentId: correctAgentId,
        },
      });

      return transactions.count;
    } catch (error) {
      errors.push(
        `Error transferring WalletTransactions: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }

  /**
   * Transfer AgentProduct records from duplicates to correct agent
   */
  private async transferProductAssignments(
    correctAgentId: string,
    duplicateAgentIds: string[],
    errors: string[],
  ): Promise<number> {
    try {
      // Find existing product assignments for correct agent
      const existingAssignments = await this.prisma.agentProduct.findMany({
        where: {
          agentId: correctAgentId,
        },
        select: { productId: true },
      });

      const existingProductIds = new Set(
        existingAssignments.map((a) => a.productId),
      );

      // Get duplicate assignments
      const duplicateAssignments = await this.prisma.agentProduct.findMany({
        where: {
          agentId: { in: duplicateAgentIds },
        },
      });

      let transferredCount = 0;

      for (const assignment of duplicateAssignments) {
        // Skip if already assigned to correct agent
        if (existingProductIds.has(assignment.productId)) {
          continue;
        }

        try {
          await this.prisma.agentProduct.update({
            where: { id: assignment.id },
            data: { agentId: correctAgentId },
          });
          transferredCount++;
        } catch (error) {
          errors.push(
            `Failed to transfer product assignment ${assignment.id}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      // Delete remaining duplicate assignments
      await this.prisma.agentProduct.deleteMany({
        where: {
          agentId: { in: duplicateAgentIds },
        },
      });

      return transferredCount;
    } catch (error) {
      errors.push(
        `Error transferring ProductAssignments: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }

  /**
   * Transfer task assignments (assignedAgentInstallers) from duplicates to correct agent
   * Handles both: when agent is the assigner AND when agent is the installer being assigned
   */
  private async transferTaskAssignments(
    correctAgentId: string,
    duplicateAgentIds: string[],
    errors: string[],
  ): Promise<number> {
    try {
      let totalTransferred = 0;

      // Case 1: Agent is the assigner (user who assigned the installer)
      const assignerTransfers =
        await this.prisma.agentInstallerAssignment.updateMany({
          where: {
            agentId: { in: duplicateAgentIds },
          },
          data: {
            agentId: correctAgentId,
          },
        });
      totalTransferred += assignerTransfers.count;

      // Case 2: Agent IS the installer being assigned
      // When a duplicate installer agent is assigned to a sales agent,
      // we need to update it to the correct installer agent
      const installerTransfers =
        await this.prisma.agentInstallerAssignment.updateMany({
          where: {
            installerId: { in: duplicateAgentIds },
          },
          data: {
            installerId: correctAgentId,
          },
        });
      totalTransferred += installerTransfers.count;

      return totalTransferred;
    } catch (error) {
      errors.push(
        `Error transferring TaskAssignments: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }
  /**
   * Transfer InstallerTask records from duplicates to correct agent
   */
  private async transferInstallerTasks(
    correctAgentId: string,
    duplicateAgentIds: string[],
    errors: string[],
  ): Promise<number> {
    try {
      const tasks = await this.prisma.installerTask.updateMany({
        where: {
          installerAgentId: { in: duplicateAgentIds },
        },
        data: {
          installerAgentId: correctAgentId,
        },
      });

      return tasks.count;
    } catch (error) {
      errors.push(
        `Error transferring InstallerTasks: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }

  /**
   * Transfer InstallerTask records where agent is the requesting agent
   */
  private async transferRequestingAgentTasks(
    correctAgentId: string,
    duplicateAgentIds: string[],
    errors: string[],
  ): Promise<number> {
    try {
      const tasks = await this.prisma.installerTask.updateMany({
        where: {
          requestingAgentId: { in: duplicateAgentIds },
        },
        data: {
          requestingAgentId: correctAgentId,
        },
      });

      return tasks.count;
    } catch (error) {
      errors.push(
        `Error transferring RequestingAgentTasks: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }

  /**
   * Transfer AuditLog records from duplicates to correct agent (if applicable)
   */
  private async transferAuditLogs(
    correctAgentId: string,
    duplicateAgentIds: string[],
    errors: string[],
  ): Promise<number> {
    try {
      // AuditLogs are typically read-only for historical purposes
      // We'll only update if they reference the agent's user ID
      const user = await this.prisma.user.findFirst({
        where: { agentDetails: { id: correctAgentId } },
        select: { id: true },
      });

      if (!user) {
        return 0;
      }

      const duplicateUsers = await this.prisma.user.findMany({
        where: {
          agentDetails: { id: { in: duplicateAgentIds } },
        },
        select: { id: true },
      });

      if (duplicateUsers.length === 0) {
        return 0;
      }

      const duplicateUserIds = duplicateUsers.map((u) => u.id);

      // Update audit logs to reference the correct user
      const logs = await this.prisma.auditLog.updateMany({
        where: {
          userId: { in: duplicateUserIds },
        },
        data: {
          userId: user.id,
        },
      });

      return logs.count;
    } catch (error) {
      errors.push(
        `Error transferring AuditLogs: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }

  /**
   * Delete duplicate agents after all records have been transferred
   */
  private async deleteDuplicateAgents(
    duplicateAgentIds: string[],
    errors: string[],
  ): Promise<number> {
    try {
      const agentUserIds = await this.prisma.agent.findMany({
        where: {
          id: { in: duplicateAgentIds },
        },
        select: { userId: true },
      });

      await this.prisma.user.deleteMany({
        where: {
          id: { in: agentUserIds.map((agentUser) => agentUser.userId) },
        },
      });

      const result = await this.prisma.agent.deleteMany({
        where: {
          id: { in: duplicateAgentIds },
        },
      });

      return result.count;
    } catch (error) {
      errors.push(
        `Error deleting duplicate agents: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }

  /**
   * Transfer Sales records where agent's user is the creator
   */
  private async transferCreatedSales(
    correctAgentId: string,
    duplicateAgentIds: string[],
    errors: string[],
  ): Promise<number> {
    try {
      // Get the user associated with correct agent
      const correctUser = await this.prisma.user.findFirst({
        where: { agentDetails: { id: correctAgentId } },
        select: { id: true },
      });

      if (!correctUser) {
        return 0;
      }

      // Get users associated with duplicate agents
      const duplicateUsers = await this.prisma.user.findMany({
        where: {
          agentDetails: { id: { in: duplicateAgentIds } },
        },
        select: { id: true },
      });

      if (duplicateUsers.length === 0) {
        return 0;
      }

      const duplicateUserIds = duplicateUsers.map((u) => u.id);

      // Transfer Sales created by duplicate agents' users
      const sales = await this.prisma.sales.updateMany({
        where: {
          creatorId: { in: duplicateUserIds },
        },
        data: {
          creatorId: correctUser.id,
        },
      });

      return sales.count;
    } catch (error) {
      errors.push(
        `Error transferring Sales (creatorId): ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }

  /**
   * Transfer Customer records where agent's user is the creator
   */
  private async transferCreatedCustomers(
    correctAgentId: string,
    duplicateAgentIds: string[],
    errors: string[],
  ): Promise<number> {
    try {
      // Get the user associated with correct agent
      const correctUser = await this.prisma.user.findFirst({
        where: { agentDetails: { id: correctAgentId } },
        select: { id: true },
      });

      if (!correctUser) {
        return 0;
      }

      // Get users associated with duplicate agents
      const duplicateUsers = await this.prisma.user.findMany({
        where: {
          agentDetails: { id: { in: duplicateAgentIds } },
        },
        select: { id: true },
      });

      if (duplicateUsers.length === 0) {
        return 0;
      }

      const duplicateUserIds = duplicateUsers.map((u) => u.id);

      // Transfer Customers created by duplicate agents' users
      const customers = await this.prisma.customer.updateMany({
        where: {
          creatorId: { in: duplicateUserIds },
        },
        data: {
          creatorId: correctUser.id,
        },
      });

      return customers.count;
    } catch (error) {
      errors.push(
        `Error transferring Customers (creatorId): ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }

  /**
   * Get duplicate agent records for review (before collapsing)
   */
  async getDuplicateAgentSummary(agentIds: string[]): Promise<{
    agents: any[];
    recordCounts: Record<string, Record<string, number>>;
  }> {
    const agents = await this.prisma.agent.findMany({
      where: { id: { in: agentIds } },
      include: {
        user: { select: { id: true, firstname: true, lastname: true } },
      },
    });

    const recordCounts: Record<string, Record<string, number>> = {};

    for (const agent of agents) {
      // Get user IDs for created records queries
      const userIds = agents
        .filter((a) => a.id === agent.id)
        .map((a) => a.userId);

      recordCounts[agent.id] = {
        customers: await this.prisma.agentCustomer.count({
          where: { agentId: agent.id },
        }),
        createdCustomers: await this.prisma.customer.count({
          where: { creatorId: { in: userIds } },
        }),
        wallets: await this.prisma.wallet.count({
          where: { agentId: agent.id },
        }),
        walletTransactions: await this.prisma.walletTransaction.count({
          where: { agentId: agent.id },
        }),
        installerAssignments: await this.prisma.agentInstallerAssignment.count({
          where: { agentId: agent.id },
        }),
        assignedAsInstaller: await this.prisma.agentInstallerAssignment.count({
          where: { installerId: agent.id },
        }),
        productAssignments: await this.prisma.agentProduct.count({
          where: { agentId: agent.id },
        }),
        createdSales: await this.prisma.sales.count({
          where: { creatorId: { in: userIds } },
        }),
        installerTasks: await this.prisma.installerTask.count({
          where: { installerAgentId: agent.id },
        }),
        requestingAgentTasks: await this.prisma.installerTask.count({
          where: { requestingAgentId: agent.id },
        }),
      };
    }

    return { agents, recordCounts };
  }
}
