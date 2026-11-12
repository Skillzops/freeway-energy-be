import { Test, TestingModule } from '@nestjs/testing';
import { OdysseyService } from './odyssey.service';
import { PrismaService } from '../prisma/prisma.service';

describe('OdysseyService', () => {
  let service: OdysseyService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OdysseyService,
        {
          provide: PrismaService,
          useValue: {
            payment: { findMany: jest.fn() },
            apiAuthToken: {
              findFirst: jest.fn(),
              findMany: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<OdysseyService>(OdysseyService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it.each([
    ['device', ['7.34', '3.82'], ['7.41', '3.85'], ['7.34', '3.82']],
    ['customer fallback', [null, null], ['7.41', '3.85'], ['7.41', '3.85']],
    ['missing coordinates', [null, null], [null, null], ['', '']],
    ['invalid coordinates', ['91', '3.82'], ['invalid', '3.85'], ['', '']],
  ])('exports payments with %s', async (_label, device, customer, expected) => {
    const payment = {
      id: 'payment-1',
      paymentDate: new Date('2026-10-08T20:34:33.471Z'),
      amount: 10000,
      sale: {
        totalPaid: 10000,
        totalPrice: 80000,
        customer: {
          id: 'customer-1',
          firstname: 'Example',
          lastname: 'Customer',
          latitude: customer[0],
          longitude: customer[1],
        },
        saleItems: [{
          devices: [{
            serialNumber: 'device-1',
            installationLatitude: device[0],
            installationLongitude: device[1],
          }],
        }],
      },
    };
    (prisma.payment.findMany as jest.Mock).mockResolvedValue([payment]);

    const result = await service.getPayments({
      from: new Date('2026-10-08T00:00:00Z'),
      to: new Date('2026-10-09T00:00:00Z'),
    });

    expect(result.errors).toBe('');
    expect(result.payments).toHaveLength(1);
    expect(result.payments[0]).toMatchObject({
      transactionId: payment.id,
      latitude: expected[0],
      longitude: expected[1],
    });
  });
});
