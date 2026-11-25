import { ExportService } from './export.service';
import { ExportType } from './dto/export-query.dto';

describe('Payment customer report scope', () => {
  let service: ExportService;
  let prisma: any;
  beforeEach(() => {
    prisma = { sales: { findMany: jest.fn() }, payment: { aggregateRaw: jest.fn() } };
    service = new ExportService(prisma);
  });
  it.each(['json', 'csv'])('scopes payment rows and counts to all customer sales for %s', async (format) => {
    prisma.sales.findMany.mockResolvedValue([{ id: 'sale-1' }, { id: 'sale-2' }] as any);
    prisma.payment.aggregateRaw.mockResolvedValue([] as any);

    await service.exportData({
      exportType: ExportType.PAYMENTS, customerId: 'customer-1',
      paymentMethod: 'WALLET', page: 2, limit: 20, format,
    } as any);

    expect(prisma.sales.findMany).toHaveBeenCalledWith({
      where: { customerId: 'customer-1' }, select: { id: true },
    });
    const calls = prisma.payment.aggregateRaw.mock.calls;
    expect(calls).toHaveLength(2);
    for (const [args] of calls) {
      expect(args.pipeline[0]).toEqual({ $match: {
        deletedAt: null, paymentMethod: 'WALLET',
        saleId: { $in: [{ $oid: 'sale-1' }, { $oid: 'sale-2' }] },
      } });
    }
    expect(calls[1][0].pipeline).toContainEqual({ $skip: 20 });
  });

  it('keeps an empty customer sale scope instead of returning everybody’s payments', async () => {
    prisma.sales.findMany.mockResolvedValue([]);
    prisma.payment.aggregateRaw.mockResolvedValue([] as any);
    const result = await service.exportData({
      exportType: ExportType.PAYMENTS, customerId: 'customer-without-sales',
    } as any);
    for (const [args] of prisma.payment.aggregateRaw.mock.calls) {
      expect(args.pipeline[0]).toEqual({ $match: { deletedAt: null, saleId: { $in: [] } } });
    }
    expect(result.allRecordsCount).toBe(0);
    expect(result.jsonData).toEqual([]);
  });

  it('leaves unfiltered payment exports unrestricted', async () => {
    prisma.payment.aggregateRaw.mockResolvedValue([] as any);
    await service.exportData({ exportType: ExportType.PAYMENTS } as any);
    expect(prisma.sales.findMany).not.toHaveBeenCalled();
    expect(prisma.payment.aggregateRaw.mock.calls[0][0].pipeline[0]).toEqual({
      $match: { deletedAt: null },
    });
  });

});
