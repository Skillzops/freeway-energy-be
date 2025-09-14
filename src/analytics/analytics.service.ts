import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  PaymentStatus,
  Prisma,
  TaskStatus,
  InventoryStatus,
} from '@prisma/client';
import { AdminDashboardFilterDto } from './dto/dashboard-filter.dto';

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  async getAdminDashboardOverview(filters: AdminDashboardFilterDto) {
    const [
      overviewStats,
      salesChartData,
      userDistribution,
      agentDistribution,
      paymentAnalytics,
      inventoryStats,
      taskStats,
      topPerformingAgents,
      recentActivities,
      geographicalData,
    ] = await Promise.all([
      this.getOverviewStatistics(filters),
      this.getSalesChartData(filters),
      this.getUserDistribution(filters),
      this.getAgentDistribution(filters),
      this.getPaymentAnalytics(filters),
      this.getInventoryStatistics(filters),
      this.getTaskStatistics(filters),
      this.getTopPerformingAgents(filters),
      this.getRecentActivities(filters),
      this.getGeographicalData(filters),
    ]);

    return {
      overview: overviewStats,
      charts: {
        salesChart: salesChartData,
        userDistributionChart: userDistribution,
        agentDistributionChart: agentDistribution,
        paymentAnalyticsChart: paymentAnalytics,
        monthlyTrends: await this.getMonthlyTrends(filters),
        productCategoriesChart: await this.getProductCategoriesChart(filters),
      },
      statistics: {
        inventory: inventoryStats,
        tasks: taskStats,
        geographical: geographicalData,
      },
      insights: {
        topPerformingAgents,
        recentActivities,
      },
    };
  }

  private async getOverviewStatistics(filters: AdminDashboardFilterDto) {
    const dateFilter = this.buildDateFilter(filters);
    const salesWhere = this.buildSalesWhereFilter(filters);

    const [
      totalRevenue,
      totalSales,
      totalAgents,
      totalCustomers,
      totalDevices,
      completedPayments,
      pendingTasks,
      activeInventoryItems,
    ] = await Promise.all([
      this.prisma.payment.aggregate({
        _sum: { amount: true },
        where: {
          paymentStatus: PaymentStatus.COMPLETED,
          ...dateFilter,
          ...(filters.paymentStatus && {
            paymentStatus: filters.paymentStatus,
          }),
        },
      }),
      this.prisma.sales.count({ where: salesWhere }),
      this.prisma.agent.count({
        where: filters.agentCategory ? { category: filters.agentCategory } : {},
      }),
      this.prisma.customer.count({
        where: {
          ...dateFilter,
          ...(filters.userStatus && { status: filters.userStatus }),
        },
      }),
      this.prisma.device.count({ where: dateFilter }),
      this.prisma.payment.count({
        where: {
          paymentStatus: PaymentStatus.COMPLETED,
          ...dateFilter,
        },
      }),
      this.prisma.installerTask.count({
        where: {
          status: { in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS] },
          ...dateFilter,
        },
      }),
      this.prisma.inventory.count({
        where: { status: InventoryStatus.IN_STOCK },
      }),
    ]);

    return {
      totalRevenue: totalRevenue._sum.amount || 0,
      totalSales,
      totalAgents,
      totalCustomers,
      totalDevices,
      completedPayments,
      pendingTasks,
      activeInventoryItems,
    };
  }

  private async getSalesChartData(filters: AdminDashboardFilterDto) {
    const dateFilter = this.buildDateFilter(filters);
    const salesWhere = this.buildSalesWhereFilter(filters);

    const salesData = await this.prisma.sales.findMany({
      where: { ...salesWhere, ...dateFilter },
      select: {
        createdAt: true,
        totalPrice: true,
        status: true,
        category: true,
      },
    });

    // Group by day for the chart
    const dailyData = salesData.reduce((acc, sale) => {
      const date = sale.createdAt.toISOString().split('T')[0];
      if (!acc[date]) {
        acc[date] = { date, count: 0, value: 0 };
      }
      acc[date].count += 1;
      acc[date].value += sale.totalPrice;
      return acc;
    }, {});

    return Object.values(dailyData).sort(
      (a: any, b: any) =>
        new Date(a.date).getTime() - new Date(b.date).getTime(),
    );
  }

  private async getUserDistribution(filters: AdminDashboardFilterDto) {
    const [agents, customers, admins] = await Promise.all([
      this.prisma.agent.count({
        where: filters.agentCategory ? { category: filters.agentCategory } : {},
      }),
      this.prisma.customer.count({
        where: filters.userStatus ? { status: filters.userStatus } : {},
      }),
      this.prisma.user.count({
        where: {
          agentDetails: null, // Users who are not agents
          ...(filters.userStatus && { status: filters.userStatus }),
        },
      }),
    ]);

    return [
      { name: 'Agents', value: agents, percentage: 0 },
      { name: 'Customers', value: customers, percentage: 0 },
      { name: 'Admins', value: admins, percentage: 0 },
    ].map((item) => {
      const total = agents + customers + admins;
      return {
        ...item,
        percentage: total > 0 ? Math.round((item.value / total) * 100) : 0,
      };
    });
  }

  private async getAgentDistribution(filters: AdminDashboardFilterDto) {
    const agentsByCategory = await this.prisma.agent.groupBy({
      by: ['category'],
      _count: { category: true },
      where: filters.agentCategory ? { category: filters.agentCategory } : {},
    });

    const totalAgents = agentsByCategory.reduce(
      (sum, item) => sum + item._count.category,
      0,
    );

    return agentsByCategory.map((item) => ({
      name: item.category,
      value: item._count.category,
      percentage:
        totalAgents > 0
          ? Math.round((item._count.category / totalAgents) * 100)
          : 0,
    }));
  }

  private async getPaymentAnalytics(filters: AdminDashboardFilterDto) {
    const dateFilter = this.buildDateFilter(filters);

    const paymentsByStatus = await this.prisma.payment.groupBy({
      by: ['paymentStatus'],
      _count: { paymentStatus: true },
      _sum: { amount: true },
      where: {
        ...dateFilter,
        ...(filters.paymentStatus && { paymentStatus: filters.paymentStatus }),
      },
    });

    return paymentsByStatus.map((item) => ({
      status: item.paymentStatus,
      count: item._count.paymentStatus,
      totalAmount: item._sum.amount || 0,
    }));
  }

  private async getInventoryStatistics(filters: AdminDashboardFilterDto) {
    const [totalInventory, inStock, outOfStock, discontinued] =
      await Promise.all([
        this.prisma.inventory.count(),
        this.prisma.inventory.count({
          where: { status: InventoryStatus.IN_STOCK },
        }),
        this.prisma.inventory.count({
          where: { status: InventoryStatus.OUT_OF_STOCK },
        }),
        this.prisma.inventory.count({
          where: { status: InventoryStatus.DISCONTINUED },
        }),
      ]);

    const lowStockItems = await this.prisma.inventoryBatch.count({
      where: { remainingQuantity: { lt: 10 } },
    });

    return {
      total: totalInventory,
      inStock,
      outOfStock,
      discontinued,
      lowStockItems,
    };
  }

  private async getTaskStatistics(filters: AdminDashboardFilterDto) {
    const dateFilter = this.buildDateFilter(filters);

    const tasksByStatus = await this.prisma.installerTask.groupBy({
      by: ['status'],
      _count: { status: true },
      where: dateFilter,
    });

    const taskStats: any = tasksByStatus.reduce((acc, task) => {
      acc[task.status.toLowerCase()] = task._count.status;
      return acc;
    }, {});

    return {
      pending: taskStats.pending || 0,
      accepted: taskStats.accepted || 0,
      inProgress: taskStats.in_progress || 0,
      completed: taskStats.completed || 0,
      rejected: taskStats.rejected || 0,
      cancelled: taskStats.cancelled || 0,
    };
  }

  private async getTopPerformingAgents(
    filters: AdminDashboardFilterDto,
    limit = 10,
  ) {
    const dateFilter = this.buildDateFilter(filters);

    const topAgents = await this.prisma.sales.groupBy({
      by: ['creatorId'],
      _count: { id: true },
      _sum: { totalPrice: true },
      where: {
        ...dateFilter,
        creatorId: { not: null },
      },
      orderBy: { _sum: { totalPrice: 'desc' } },
      take: limit,
    });

    // Get agent details
    const agentDetails = await this.prisma.user.findMany({
      where: { id: { in: topAgents.map((agent) => agent.creatorId) } },
      //   include: { agentDetails: true },
      select: {
        id: true,
        firstname: true,
        lastname: true,
        email: true,
        agentDetails: {
          select: { agentId: true, category: true },
        },
      },
    });

    return topAgents.map((agent) => {
      const details = agentDetails.find(
        (detail) => detail.id === agent.creatorId,
      );
      return {
        agentId: details?.agentDetails?.agentId || 'N/A',
        name:
          `${details?.firstname || ''} ${details?.lastname || ''}`.trim() ||
          'Unknown',
        email: details?.email || 'N/A',
        category: details?.agentDetails?.category || 'N/A',
        salesCount: agent._count.id,
        totalRevenue: agent._sum.totalPrice || 0,
      };
    });
  }

  private async getRecentActivities(
    filters: AdminDashboardFilterDto,
    limit = 20,
  ) {
    const dateFilter = this.buildDateFilter(filters);

    const [recentSales, recentPayments, recentTasks] = await Promise.all([
      this.prisma.sales.findMany({
        where: dateFilter,
        include: {
          customer: { select: { firstname: true, lastname: true } },
          creatorDetails: { select: { firstname: true, lastname: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: Math.floor(limit / 3),
      }),
      this.prisma.payment.findMany({
        where: {
          ...dateFilter,
          paymentStatus: PaymentStatus.COMPLETED,
          sale: {
            is: {},
          },
        },
        include: {
          sale: {
            include: {
              customer: { select: { firstname: true, lastname: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: Math.floor(limit / 3),
      }),
      this.prisma.installerTask.findMany({
        where: {
          ...dateFilter,
          sale: {
            is: {},
          },
        },
        include: {
          //   customer: { select: { firstname: true, lastname: true } },
          requestingAgent: {
            include: { user: { select: { firstname: true, lastname: true } } },
          },
          sale: {
            include: {
              customer: { select: { firstname: true, lastname: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: Math.floor(limit / 3),
      }),
    ]);

    const activities = [
      ...recentSales.map((sale) => ({
        type: 'sale',
        id: sale.id,
        description: `New sale created for ${sale.customer.firstname} ${sale.customer.lastname}`,
        amount: sale.totalPrice,
        createdAt: sale.createdAt,
        user: sale.creatorDetails
          ? `${sale.creatorDetails.firstname} ${sale.creatorDetails.lastname}`
          : 'System',
      })),
      ...recentPayments.map((payment) => ({
        type: 'payment',
        id: payment.id,
        description: `Payment completed for ${payment.sale.customer.firstname} ${payment.sale.customer.lastname}`,
        amount: payment.amount,
        createdAt: payment.createdAt,
        user: 'Customer',
      })),
      ...recentTasks.map((task) => ({
        type: 'task',
        id: task.id,
        description: `Installation task ${task.status.toLowerCase()} for ${task.sale.customer.firstname} ${task.sale.customer.lastname}`,
        amount: null,
        createdAt: task.createdAt,
        user: task.requestingAgent?.user
          ? `${task.requestingAgent.user.firstname} ${task.requestingAgent.user.lastname}`
          : 'System',
      })),
    ];

    return activities
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
      .slice(0, limit);
  }

  private async getGeographicalData(filters: AdminDashboardFilterDto) {
    const customers = await this.prisma.customer.findMany({
      where: filters.userStatus ? { status: filters.userStatus } : {},
      select: { state: true, lga: true },
    });

    const stateDistribution = customers.reduce((acc, customer) => {
      if (customer.state) {
        acc[customer.state] = (acc[customer.state] || 0) + 1;
      }
      return acc;
    }, {});

    const lgaDistribution = customers.reduce((acc, customer) => {
      if (customer.lga) {
        acc[customer.lga] = (acc[customer.lga] || 0) + 1;
      }
      return acc;
    }, {});

    return {
      states: Object.entries(stateDistribution).map(([state, count]) => ({
        state,
        count,
      })),
      lgas: Object.entries(lgaDistribution).map(([lga, count]) => ({
        lga,
        count,
      })),
    };
  }

  private async getMonthlyTrends(filters: AdminDashboardFilterDto) {
    const currentYear = new Date().getFullYear();
    const dateWhere =
      filters.startDate || filters.endDate
        ? {
            gte: filters.startDate ?? new Date(`${currentYear}-01-01`),
            lte: filters.endDate ?? new Date(`${currentYear + 1}-01-01`),
          }
        : {
            gte: new Date(`${currentYear}-01-01`),
            lte: new Date(`${currentYear + 1}-01-01`),
          };

    const [salesData, paymentData] = await Promise.all([
      this.prisma.sales.findMany({
        where: {
          createdAt: dateWhere,
          ...this.buildSalesWhereFilter(filters),
        },
        select: { createdAt: true, totalPrice: true },
      }),
      this.prisma.payment.findMany({
        where: {
          createdAt: dateWhere,
          paymentStatus: PaymentStatus.COMPLETED,
        },
        select: { createdAt: true, amount: true },
      }),
    ]);

    const months = Array.from({ length: 12 }, (_, i) => ({
      month: new Date(2000, i).toLocaleString('default', { month: 'short' }),
      sales: 0,
      salesValue: 0,
      payments: 0,
      paymentsValue: 0,
    }));

    salesData.forEach((sale) => {
      const monthIndex = new Date(sale.createdAt).getMonth();
      months[monthIndex].sales += 1;
      months[monthIndex].salesValue += sale.totalPrice;
    });

    paymentData.forEach((payment) => {
      const monthIndex = new Date(payment.createdAt).getMonth();
      months[monthIndex].payments += 1;
      months[monthIndex].paymentsValue += payment.amount;
    });

    return months;
  }

  private async getProductCategoriesChart(filters: AdminDashboardFilterDto) {
    const salesWithItems = await this.prisma.sales.findMany({
      where: this.buildSalesWhereFilter(filters),
      include: {
        saleItems: {
          include: {
            product: {
              include: { category: true },
            },
          },
        },
      },
    });

    const categoryStats = new Map<string, { count: number; value: number }>();

    salesWithItems.forEach((sale) => {
      sale.saleItems.forEach((item) => {
        const categoryName = item.product.category.name;
        const existing = categoryStats.get(categoryName) || {
          count: 0,
          value: 0,
        };
        existing.count += item.quantity;
        existing.value += item.totalPrice;
        categoryStats.set(categoryName, existing);
      });
    });

    const totalValue = Array.from(categoryStats.values()).reduce(
      (sum, cat) => sum + cat.value,
      0,
    );

    return Array.from(categoryStats.entries()).map(([name, stats]) => ({
      name,
      count: stats.count,
      value: stats.value,
      percentage:
        totalValue > 0 ? ((stats.value / totalValue) * 100).toFixed(2) : '0',
    }));
  }

  private buildDateFilter(filters: AdminDashboardFilterDto) {
    const dateFilter: any = {};
    if (filters.startDate || filters.endDate) {
      dateFilter.createdAt = {};
      if (filters.startDate) dateFilter.createdAt.gte = filters.startDate;
      if (filters.endDate) dateFilter.createdAt.lte = filters.endDate;
    }
    return dateFilter;
  }

  private buildSalesWhereFilter(
    filters: AdminDashboardFilterDto,
  ): Prisma.SalesWhereInput {
    const where: Prisma.SalesWhereInput = {};

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.categoryId) {
      where.saleItems = {
        some: {
          product: {
            categoryId: filters.categoryId,
          },
        },
      };
    }

    if (filters.agentId) {
      where.creatorId = filters.agentId;
    }

    return where;
  }
}
