import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { ActionEnum, SubjectEnum } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class AdminOrWarehouseManagerGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    
    if (!user) return false;

    const httpMethod = request.method.toLowerCase();

    const userWithRole = await this.prisma.user.findUnique({
      where: { id: user.id },
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
      },
    });

    // Map HTTP methods to required actions
    const getRequiredAction = (method: string): ActionEnum[] => {
      switch (method) {
        case 'get':
        case 'head':
          return [ActionEnum.read, ActionEnum.manage];
        case 'post':
        case 'put':
        case 'patch':
          return [ActionEnum.write, ActionEnum.manage];
        case 'delete':
          return [ActionEnum.delete, ActionEnum.manage];
        default:
          return [ActionEnum.manage]; // Default to most restrictive
      }
    };

    const requiredActions = getRequiredAction(httpMethod);

    // Check if user has warehouse permissions for the specific HTTP method
    const hasWarehousePermissions = userWithRole?.role.permissions.some(
      (permission) =>
        (permission.subject === SubjectEnum.Warehouse ||
         permission.subject === SubjectEnum.all) &&
        requiredActions.includes(permission.action)
    );

    if (hasWarehousePermissions) {
      request.userType = 'admin';
      return true;
    }

    // Check if user is a warehouse manager
    const warehouseManager = await this.prisma.warehouseManager.findUnique({
      where: { userId: user.id },
      include: {
        warehouse: true,
        user: true,
      },
    });

    if (warehouseManager && warehouseManager.warehouse.isActive) {
      request.userType = 'warehouseManager';
      request.warehouseManager = warehouseManager;
      return true;
    }

    return false;
  }
}