import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ApiAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Invalid authorization header format');
    }

    
    const token = authHeader.substring(7);
    const isValid = await this.validateApiToken(token);
    if (!isValid) {
      throw new UnauthorizedException('Invalid API token');
    }

    return true;
  }

  async validateApiToken(token: string): Promise<boolean> {
    try {
      // Check if token exists in our API tokens table
      const apiToken = await this.prisma.apiAuthToken.findFirst({
        where: {
          token,
          isActive: true,
          expiresAt: {
            gt: new Date(),
          },
        },
      });

      if (apiToken) {
        // Update last used timestamp
        await this.prisma.apiAuthToken.update({
          where: { id: apiToken.id },
          data: { lastUsedAt: new Date() },
        });

        return true;
      }

      return false;
    } catch (error) {
      console.error('Error validating API token', error);
      return false;
    }
  }
}
