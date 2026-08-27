import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { pickAgentDetails } from '../../common/utils/agent-details.util';

@Injectable()
export class AgentAccessGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) return false;

    // A user can now hold more than one Agent profile (one per category).
    // This guard has no category/request context to disambiguate with, so
    // it only succeeds when there's exactly one unambiguous profile -
    // never guesses between two.
    const agents = await this.prisma.agent.findMany({
      where: { userId: user.id },
    });

    const agent = pickAgentDetails(agents);

    if (!agent) {
      return false;
    }

    request.user.agent = agent;

    return true;
  }
}
