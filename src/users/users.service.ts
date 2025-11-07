import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { plainToInstance } from 'class-transformer';
import { UserEntity } from './entity/user.entity';
import { UpdateUserDto } from './dto/update-user.dto';
import { MESSAGES } from '../constants';
import { validateOrReject } from 'class-validator';
import { ListUsersQueryDto } from './dto/list-users.dto';
import { Prisma, UserStatus } from '@prisma/client';
import { hashPassword } from 'src/utils/helpers.util';
import { generateRandomPassword } from 'src/utils/generate-pwd';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async userFilter(query: ListUsersQueryDto): Promise<Prisma.UserWhereInput> {
    const {
      search,
      firstname,
      lastname,
      username,
      email,
      phone,
      location,
      status,
      isBlocked,
      roleId,
      createdAt,
      updatedAt,
    } = query;

    const filterConditions: Prisma.UserWhereInput = {
      AND: [
        search
          ? {
              OR: [
                { firstname: { contains: search, mode: 'insensitive' } },
                { lastname: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { username: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {},
        firstname
          ? { firstname: { contains: firstname, mode: 'insensitive' } }
          : {},
        lastname
          ? { lastname: { contains: lastname, mode: 'insensitive' } }
          : {},
        username
          ? { username: { contains: username, mode: 'insensitive' } }
          : {},
        email ? { email: { contains: email, mode: 'insensitive' } } : {},
        phone ? { phone: { contains: phone, mode: 'insensitive' } } : {},
        location
          ? { location: { contains: location, mode: 'insensitive' } }
          : {},
        status ? { status } : {},
        isBlocked !== undefined ? { isBlocked } : {},
        roleId ? { roleId } : {},
        createdAt ? { createdAt: { gte: new Date(createdAt) } } : {},
        updatedAt ? { updatedAt: { gte: new Date(updatedAt) } } : {},
        { agentDetails: null },
      ],
    };

    return filterConditions;
  }

  async getUsers(query: ListUsersQueryDto) {
    const { page = 1, limit = 100, sortField, sortOrder } = query;

    const filterConditions = await this.userFilter(query);

    const pageNumber = parseInt(String(page), 10);
    const limitNumber = parseInt(String(limit), 10);

    const skip = (pageNumber - 1) * limitNumber;
    const take = limitNumber;

    const orderBy = {
      [sortField || 'createdAt']: sortOrder || 'asc',
    };

    const result = await this.prisma.user.findMany({
      skip,
      take,
      where: filterConditions,
      orderBy,
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
      },
    });

    const users = plainToInstance(UserEntity, result);

    const totalCount = await this.prisma.user.count({
      where: filterConditions,
    });

    return {
      users,
      total: totalCount,
      page,
      limit,
      totalPages: limitNumber === 0 ? 0 : Math.ceil(totalCount / limitNumber),
    };
  }

  async updateUser(id: string, updateUserDto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException(MESSAGES.USER_NOT_FOUND);
    }

    const validDto = plainToInstance(UpdateUserDto, updateUserDto);

    await validateOrReject(validDto);

    const updatedUser = await this.prisma.user.update({
      where: { id },
      data: {
        ...validDto,
      },
    });

    return updatedUser;
  }

  async fetchUser(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException(MESSAGES.USER_NOT_FOUND);
    }

    const serialisedData = plainToInstance(UpdateUserDto, user);

    return serialisedData;
  }

  async deleteUser(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException(MESSAGES.USER_NOT_FOUND);
    }

    await this.prisma.user.delete({
      where: { id },
    });

    return {
      message: MESSAGES.DELETED,
    };
  }

  async bulkPasswordReset(
    emails: string[],
  ) {
    const results = [];
    let successCount = 0;
    let failureCount = 0;

    console.log({emails})

    for (const email of emails) {
      try {
        // Find user by email
        const user = await this.prisma.user.findUnique({
          where: { email: email.toLowerCase().trim() },
          select: {
            id: true,
            email: true,
            firstname: true,
            lastname: true,
            username: true,
            status: true,
            isBlocked: true,
          },
        });

        if (!user) {
          results.push({
            id: '',
            email,
            newPassword: '',
            status: 'User not found',
            success: false,
          });
          failureCount++;
          continue;
        }

        // Generate new password
        // const newPassword = `${user.firstname}@${user.lastname}${generateRandomPassword(4)}`;
        const newPassword = `Macgarry@Uloko2KZR`;
        const hashedPassword = await hashPassword(newPassword);

        // Update user with new password and activate account
        const updatedUser = await this.prisma.user.update({
          where: { id: user.id },
          data: {
            password: hashedPassword,
            status: UserStatus.active,
            isBlocked: false,
            updatedAt: new Date(),
          },
          select: {
            id: true,
            email: true,
            firstname: true,
            lastname: true,
            username: true,
            status: true,
          },
        });

        results.push({
          id: updatedUser.id,
          email: updatedUser.email,
          firstname: updatedUser.firstname,
          lastname: updatedUser.lastname,
          username: updatedUser.username,
          newPassword,
          status: `Password reset successful - User activated`,
          success: true,
        });

        successCount++;
      } catch (error) {
        results.push({
          id: '',
          email,
          newPassword: '',
          status: `Error: ${error.message}`,
          success: false,
        });
        failureCount++;
      }
    }
    return {
      results,
      totalProcessed: emails.length,
      successCount,
      failureCount,
    };
  }
}
