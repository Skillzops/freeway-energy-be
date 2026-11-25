import { ExportService } from './export.service';
import { ExportType } from './dto/export-query.dto';

describe('Report filter intersections', () => {
  let service: any;
  let prisma: any;
  beforeEach(() => {
    prisma = {
      agent: { findUnique: jest.fn(), findMany: jest.fn() },
      sales: { findMany: jest.fn().mockResolvedValue([]) },
      customer: { aggregateRaw: jest.fn().mockResolvedValue([]) },
      payment: { aggregateRaw: jest.fn().mockResolvedValue([]) },
      device: { aggregateRaw: jest.fn().mockResolvedValue([]) },
      saleItem: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new ExportService(prisma);
    jest.spyOn(service, 'getAgentInfo').mockResolvedValue({ agentId: 'a', userId: 'u', category: 'SALES' });
  });
  it.each(['json', 'csv'])('intersects payment customer, agent, channel, status and amounts for %s', async format => {
    prisma.sales.findMany.mockResolvedValue([{ id: 's' }]);
    await service.exportData({ exportType: ExportType.PAYMENTS, format, customerId: 'c', agentId: 'a',
      agentCategory: 'SALES', paymentMethod: 'WALLET', paymentStatus: 'COMPLETED', minAmount: 0, maxAmount: 100 });
    expect(prisma.sales.findMany).toHaveBeenCalledWith({ where: {
      OR: [{ agentId: { in: ['a'] } }, { creatorId: { in: ['u'] } }], customerId: 'c',
    }, select: { id: true } });
    for (const [query] of prisma.payment.aggregateRaw.mock.calls) expect(query.pipeline[0]).toEqual({ $match: {
      deletedAt: null, saleId: { $in: [{ $oid: 's' }] }, paymentMethod: 'WALLET',
      paymentStatus: 'COMPLETED', amount: { $gte: 0, $lte: 100 },
    } });
  });
  it('does not broaden a selected agent when a conflicting category is provided', async () => {
    expect(await service.reportAgentSaleWhere({ agentId: 'a', agentCategory: 'INSTALLER' })).toEqual({ id: { in: [] } });
  });
  it('keeps the specific installer when the installer category is also selected', async () => {
    service.getAgentInfo.mockResolvedValue({ agentId: 'i', category: 'INSTALLER' });
    expect(await service.reportAgentSaleWhere({ agentId: 'i', agentCategory: 'INSTALLER' }))
      .toEqual({ installerTasks: { some: { installerAgentId: 'i' } } });
  });
  it.each(['SALES', 'BUSINESS'])('resolves category-only %s without an undefined ObjectId', async category => {
    prisma.agent.findMany.mockResolvedValue([{ id: 'a', userId: 'u' }]);
    expect(await service.reportAgentSaleWhere({ agentCategory: category })).toEqual({
      OR: [{ agentId: { in: ['a'] } }, { creatorId: { in: ['u'] } }],
    });
  });
  it.each([true, false])('filters customer debt (%s) before pagination in both rows and counts', async hasOutstandingDebt => {
    await service.exportData({ exportType: ExportType.CUSTOMERS, hasOutstandingDebt, page: 2, limit: 20 });
    const queries = prisma.customer.aggregateRaw.mock.calls.map(([q]) => q.pipeline);
    expect(queries).toHaveLength(2);
    expect(queries[1].slice(0, queries[0].length - 1)).toEqual(queries[0].slice(0, -1));
    expect(queries[1].findIndex(s => s.$match?.outstandingDebt)).toBeLessThan(queries[1].findIndex(s => s.$skip));
    expect(queries[1]).toContainEqual({ $match: { outstandingDebt: hasOutstandingDebt ? { $gt: 0 } : { $lte: 0 } } });
  });
  it('scopes device counts before pagination, including an empty match', async () => {
    await service.exportData({ exportType: ExportType.DEVICES, customerId: 'c' });
    expect(prisma.sales.findMany).toHaveBeenCalledWith({ where: { customerId: 'c' }, select: { id: true } });
    expect(prisma.device.aggregateRaw.mock.calls[0][0].pipeline[0]).toEqual({ $match: { _id: { $in: [] } } });
  });
  it('rejects an inverted amount range', async () => {
    await expect(service.exportData({ exportType: ExportType.PAYMENTS, minAmount: 200, maxAmount: 100 })).rejects.toThrow('Minimum amount');
    expect(prisma.payment.aggregateRaw).not.toHaveBeenCalled();
  });
});
