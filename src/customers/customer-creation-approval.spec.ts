import { CustomersService } from './customers.service';
import { ForbiddenException } from '@nestjs/common';

describe('customer registration approval', () => {
  const makePrisma = (): any => ({
    user: { findUnique: jest.fn() },
    customer: { create: jest.fn(), findFirst: jest.fn() },
    agentCustomer: { create: jest.fn() },
  });
  const sales = { id: 'sales-agent', category: 'SALES', deletedAt: null };
  const installer = { id: 'installer-agent', category: 'INSTALLER', deletedAt: null };
  const dto = { firstname: 'Test', lastname: 'Customer', phone: '08000000000', addressType: 'HOME' } as any;

  it.each([[sales], [sales, installer], [installer, sales]])('requires approval for agent profiles %j', async (...profiles) => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({ agentDetails: profiles } as any);
    prisma.customer.create.mockResolvedValue({ id: 'customer' } as any);
    const service = new CustomersService(prisma, {} as any);
    await service.createCustomer('user', dto);
    expect(prisma.customer.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      status: 'inactive', isApproved: false, approvalStatus: 'PENDING', requiresReview: true,
    }) });
    expect(prisma.agentCustomer.create).toHaveBeenCalledWith({ data: {
      agentId: sales.id, customerId: 'customer', assignedBy: 'user',
    } });
  });

  it('creates staff registrations with consistent approved flags', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({ agentDetails: [] } as any);
    prisma.customer.create.mockResolvedValue({ id: 'customer' } as any);
    await new CustomersService(prisma, {} as any).createCustomer('admin', dto);
    expect(prisma.customer.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      status: 'active', isApproved: true, approvalStatus: 'APPROVED', requiresReview: false,
    }) });
    expect(prisma.agentCustomer.create).not.toHaveBeenCalled();
  });

  it('does not auto-approve an ambiguous agent', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({ agentDetails: [installer, { id: 'other', category: 'BUSINESS' }] } as any);
    await expect(new CustomersService(prisma, {} as any).createCustomer('user', dto)).rejects.toThrow(ForbiddenException);
    expect(prisma.customer.create).not.toHaveBeenCalled();
  });
});
