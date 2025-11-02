import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
// import { User } from '../../../authentication/interface/user';
import { PrismaService } from '../../prisma/prisma.service';
import { User } from '../interface/user.interface';
import { MESSAGES } from '../../constants';
import { RolesArgs } from '../decorators/roles.decorator';
import { ActionEnum, SubjectEnum } from '@prisma/client';

@Injectable()
export class RolesAndPermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Retrieve roles and permissions metadata from the route handler
    const rolesDecoratorValues = this.reflector.get<RolesArgs>(
      'roles',
      context.getHandler(),
    );
    const requiredRoles = rolesDecoratorValues?.roles || [];
    const requiredPermissions = rolesDecoratorValues.permissions || [];

    // If no roles or permissions are required, allow access
    if (!requiredRoles && !requiredPermissions) {
      return true;
    }

    // Get the request object and the user from it
    const request = context.switchToHttp().getRequest();
    const user = request.user as User;

    if (!user) {
      throw new ForbiddenException(MESSAGES.USER_NOT_FOUND);
    }

    if (!Array.isArray(requiredRoles)) {
      throw new ForbiddenException(MESSAGES.ROLES_METADATA_INVALID);
    }

    if (!Array.isArray(requiredPermissions)) {
      throw new ForbiddenException(MESSAGES.PERMISSIONS_METADATA_INVALID);
    }

    // Check user roles
    const userRole = user.role.role;

    // allow admin and super-admin users to access resource
    if(userRole == "admin" || userRole == "super-admin"){
      return true
    }

    const hasRequiredRoles = requiredRoles.length
      ? requiredRoles.includes(userRole)
      : true;

    // Check user permissions
    const userPermissions = await this.getUserPermissions(user.role.id);

    // Check if any user permission has the subject 'all'
    const hasRequiredPermissions = requiredPermissions.length
      ? requiredPermissions.some(
          (requiredPermission) =>
            userPermissions.some((userPermission) => {
              const [action, subject] = userPermission.split(':');
              return subject === SubjectEnum.all && action == ActionEnum.manage; // allow for users with subject = "all" and action = "manage"
            }) || userPermissions.includes(requiredPermission),
        )
      : true;

    // If the user does not have required roles or permissions, throw a ForbiddenException
    if (!(hasRequiredRoles && hasRequiredPermissions)) {
      throw new ForbiddenException(MESSAGES.NOT_PERMITTED);
    }

    return true;
  }

  // Fetch user permissions from the database
  private async getUserPermissions(roleId: string): Promise<string[]> {
    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
      include: { permissions: true },
    });

    if (!role) {
      throw new ForbiddenException(MESSAGES.ROLE_NOT_FOUND);
    }

    return role.permissions.map(
      (permission) => `${permission.action}:${permission.subject}`,
    );
  }
}
