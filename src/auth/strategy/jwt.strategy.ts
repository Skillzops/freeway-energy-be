import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { ClsService } from 'nestjs-cls';
import { AuditContext } from 'src/prisma/prisma-audit.extension';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly clsService: ClsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET_KEY'),
    });
  }

  async validate(payload: {
    sub: string;
    agentId?: string;
    agentCategory?: string;
  }) {
    const user = await this.prisma.user.findUnique({
      where: {
        id: payload.sub,
      },
      // include: {
      //   role: true
      // },
      select: {
        id: true,
        role: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException();
    }

    const auditContext = this.clsService.get('auditContext') as AuditContext;
    this.clsService.set('auditContext', {
      ...auditContext,
      userId: user.id,
    });
    this.clsService.set('userId', user.id);

    // Carry the session's resolved agent context (set at login - see
    // AuthService.login) forward onto request.user, so guards/services that
    // need to know *which* of a user's possibly-multiple Agent profiles is
    // active for this session don't have to guess.
    return {
      ...user,
      agentId: payload.agentId,
      agentCategory: payload.agentCategory,
    };
  }
}
