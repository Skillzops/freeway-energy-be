import {
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { User } from '../interface/user.interface';
import { Agent } from '@prisma/client';

export const GetSessionUser = createParamDecorator(
  (
    data: keyof (User & { agent?: Agent }) | undefined,
    ctx: ExecutionContext,
  ) => {
    const request = ctx.switchToHttp().getRequest();

    const user = request.user as User & {
      agent?: Agent;
    };

    if (!user) {
      throw new ForbiddenException('User not found');
    }

    if (data) {
      return user?.[data];
    }

    return user;
  },
);
