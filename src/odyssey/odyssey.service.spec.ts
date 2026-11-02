import { Test, TestingModule } from '@nestjs/testing';
import { OdysseyService } from './odyssey.service';
import { PrismaService } from '../prisma/prisma.service';

describe('OdysseyService', () => {
  let service: OdysseyService;

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
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
