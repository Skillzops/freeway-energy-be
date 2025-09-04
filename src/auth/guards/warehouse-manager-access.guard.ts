import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class WarehouseManagerGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) return false;

    const warehouseManager = await this.prisma.warehouseManager.findUnique({
      where: { userId: user.id },
      include: {
        warehouse: true,
        user: true,
      },
    });

    if (!warehouseManager || !warehouseManager.warehouse.isActive) return false;

    request.user.warehouseManager = warehouseManager;

    return true;
  }
}
