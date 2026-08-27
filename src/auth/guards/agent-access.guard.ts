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
    // Disambiguate using the agent context resolved at login (carried on
    // the JWT -> request.user by JwtStrategy) so a dual-profile user's
    // SALES-session requests resolve to their SALES agent, not whichever
    // profile happens to be the only match by coincidence.
    const agents = await this.prisma.agent.findMany({
      where: { userId: user.id },
    });

    const agent = pickAgentDetails(agents, {
      agentId: user.agentId,
      agentCategory: user.agentCategory,
    });

    if (!agent) {
      return false;
    }

    request.user.agent = agent;

    return true;
  }
}
