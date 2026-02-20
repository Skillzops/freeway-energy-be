import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ActionEnum,
  AgentCategory,
  SubjectEnum,
  TaskStatus,
  TokenType,
  UserStatus,
} from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { v4 as uuidv4 } from 'uuid';
import * as argon from 'argon2';
import { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword } from '../utils/helpers.util';
import { CreateUserDto } from './dto/create-user.dto';
import { EmailService } from '../mailer/email.service';
import { ForgotPasswordDTO } from './dto/forgot-password.dto';
import { MESSAGES } from '../constants';
import { PasswordResetDTO } from './dto/password-reset.dto';
import { LoginUserDTO } from './dto/login-user.dto';
import { CreateSuperUserDto } from './dto/create-super-user.dto';
import {
  CreateUserPasswordDto,
  CreateUserPasswordParamsDto,
} from './dto/create-user-password.dto';
import { generateRandomPassword } from '../utils/generate-pwd';
import { plainToInstance } from 'class-transformer';
import { UserEntity } from '../users/entity/user.entity';
import { ChangePasswordDto } from './dto/change-password.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly Email: EmailService,
    private readonly config: ConfigService,
    private jwtService: JwtService,
  ) {}

  async addUser(userData: CreateUserDto) {
    const {
      email,
      firstname,
      lastname,
      location,
      phone,
      role: roleId,
    } = userData;

    const emailExists = await this.prisma.user.findFirst({
      where: {
        email,
      },
    });

    if (emailExists) {
      throw new BadRequestException(MESSAGES.EMAIL_EXISTS);
    }

    const roleExists = await this.prisma.role.findFirst({
      where: {
        id: roleId,
      },
    });

    if (!roleExists) {
      throw new BadRequestException(MESSAGES.customInvalidMsg('role'));
    }

    const newPwd = generateRandomPassword(30);

    const hashedPwd = await hashPassword(newPwd);

    const newUser = await this.prisma.user.create({
      data: {
        firstname,
        lastname,
        location,
        phone,
        email,
        password: hashedPwd,
        roleId,
        status: UserStatus.inactive,
      },
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
      },
    });

    const resetToken = uuidv4();
    const expirationTime = new Date();
    expirationTime.setHours(expirationTime.getFullYear() + 1);

    const token = await this.prisma.tempToken.create({
      data: {
        token: resetToken,
        expiresAt: expirationTime,
        token_type: TokenType.email_verification,
        userId: newUser.id,
      },
    });

    const platformName = 'A4T Energy';
    const clientUrl = this.config.get<string>('CLIENT_URL');

    const createPasswordUrl = `${clientUrl}create-password/${newUser.id}/${token.token}/`;

    await this.Email.sendMail({
      userId: newUser.id,
      to: email,
      from: this.config.get<string>('MAIL_FROM'),
      subject: `Welcome to ${platformName} - Let's Get You Started!`,
      template: './new-user-onboarding',
      context: {
        firstname,
        userEmail: email,
        platformName,
        createPasswordUrl,
        supportEmail: this.config.get<string>('MAIL_FROM') || 'a4t@gmail.com',
      },
    });

    return newUser;
  }

  async createSuperuser(userData: CreateSuperUserDto) {
    const { email, firstname, lastname, password, cKey } = userData;

    // this is a mock key that should be fetched
    // from an env or compared with a hashed value
    // in the database
    const adminCreationToken = '09yu2408h0wnh89h20';

    if (adminCreationToken !== cKey) {
      throw new ForbiddenException();
    }

    const emailExists = await this.prisma.user.findFirst({
      where: {
        email,
      },
    });

    if (emailExists) {
      throw new BadRequestException(MESSAGES.EMAIL_EXISTS);
    }

    const hashedPwd = await hashPassword(password);

    const newUser = await this.prisma.user.create({
      data: {
        firstname,
        lastname,
        email,
        password: hashedPwd,
        role: {
          connectOrCreate: {
            where: {
              role: 'admin',
            },
            create: {
              role: 'admin',
            },
          },
        },
      },
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
      },
    });

    return newUser;
  }

  async login(data: LoginUserDTO, res: Response) {
    const { email, password } = data;

    const user = await this.prisma.user.findUnique({
      where: {
        email,
      },
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
        agentDetails: true,
      },
    });

    if (!user) throw new BadRequestException(MESSAGES.INVALID_CREDENTIALS);

    const verifyPassword = await argon.verify(user.password, password);

    if (!verifyPassword)
      throw new BadRequestException(MESSAGES.INVALID_CREDENTIALS);

    const payload = { sub: user.id };

    const access_token = this.jwtService.sign(payload);

    res.setHeader('access_token', access_token);
    res.setHeader('Access-Control-Expose-Headers', 'access_token');

    return plainToInstance(UserEntity, user);
  }

  async forgotPassword(forgotPasswordDetails: ForgotPasswordDTO) {
    const { email } = forgotPasswordDetails;

    const existingUser = await this.prisma.user.findUnique({
      where: {
        email,
      },
    });

    if (!existingUser) {
      throw new BadRequestException(MESSAGES.USER_NOT_FOUND);
    }

    let existingToken = await this.prisma.tempToken.findFirst({
      where: {
        token_type: TokenType.password_reset,
        token: {
          not: null,
        },
        userId: existingUser.id,
        expiresAt: {
          gte: new Date(),
        },
      },
    });

    const resetToken = uuidv4();
    const newExpirationTime = new Date();
    newExpirationTime.setHours(newExpirationTime.getHours() + 1);

    if (existingToken) {
      await this.prisma.tempToken.update({
        where: { id: existingToken.id },
        data: {
          token: resetToken,
          expiresAt: newExpirationTime,
        },
      });
    } else {
      existingToken = await this.prisma.tempToken.create({
        data: {
          token: resetToken,
          expiresAt: newExpirationTime,
          token_type: TokenType.password_reset,
          userId: existingUser.id,
        },
      });
    }

    const platformName = 'A4T Energy';
    const clientUrl = this.config.get<string>('CLIENT_URL');
    // const resetLink = `${clentUrl}/resetPassword`;
    const resetLink = `${clientUrl}reset-password/${existingUser.id}/${existingToken.token}/`;

    await this.Email.sendMail({
      to: email,
      from: this.config.get<string>('MAIL_FROM'),
      subject: `Reset Your Password - ${platformName}`,
      template: './reset-password',
      context: {
        firstname: existingUser.firstname,
        resetLink,
        platformName,
        supportEmail: this.config.get<string>('MAIL_FROM'),
      },
    });

    return {
      message: MESSAGES.PWD_RESET_MAIL_SENT,
    };
  }

  async resetPassword(resetPasswordDetails: PasswordResetDTO) {
    const { newPassword, resetToken, userid } = resetPasswordDetails;

    const tokenValid = await this.verifyToken(
      resetToken,
      TokenType.password_reset,
      userid,
    );

    const hashedPwd = await hashPassword(newPassword);

    await this.prisma.user.update({
      where: {
        id: tokenValid.userId,
      },
      data: {
        password: hashedPwd,
      },
    });

    await this.prisma.tempToken.update({
      where: {
        id: tokenValid.id,
      },
      data: {
        token: null,
        expiresAt: new Date('2000-01-01T00:00:00Z'),
      },
    });

    return {
      message: MESSAGES.PWD_RESET_SUCCESS,
    };
  }

  // async verifyResetToken(resetToken: string) {
  //   await this.verifyToken(resetToken);

  //   return { message: MESSAGES.TOKEN_VALID };
  // }

  async createUserPassword(
    pwds: CreateUserPasswordDto,
    params: CreateUserPasswordParamsDto,
  ) {
    const tokenValid = await this.verifyToken(
      params.token,
      TokenType.email_verification,
      params.userid,
    );

    const hashedPwd = await hashPassword(pwds.password);

    const user = await this.prisma.user.update({
      where: {
        id: tokenValid.userId,
      },
      data: {
        password: hashedPwd,
        status: UserStatus.active,
      },
    });

    await this.prisma.tempToken.update({
      where: {
        id: tokenValid.id,
      },
      data: {
        token: null,
        expiresAt: new Date('2000-01-01T00:00:00Z'),
      },
    });

    return {
      message: MESSAGES.PWD_CREATION_SUCCESS,
      user: plainToInstance(UserEntity, user),
    };
  }

  async changePassword(pwds: ChangePasswordDto, userId: string) {
    const authUser = await this.prisma.user.findUnique({
      where: {
        id: userId,
      },
      include: {
        role: true,
      },
    });

    const { password, oldPassword } = pwds;

    const verifyPassword = await argon.verify(authUser.password, oldPassword);

    if (!verifyPassword)
      throw new BadRequestException(MESSAGES.INVALID_CREDENTIALS);

    const isNewPwdSameAsOld = await argon.verify(authUser.password, password);

    if (isNewPwdSameAsOld)
      throw new BadRequestException(MESSAGES.PWD_SIMILAR_TO_OLD);

    const hashedPwd = await hashPassword(password);

    await this.prisma.user.update({
      where: {
        id: authUser.id,
      },
      data: {
        password: hashedPwd,
      },
    });

    return {
      message: MESSAGES.PASSWORD_CHANGED_SUCCESS,
    };
  }

  async verifyToken(
    token: string,
    token_type: TokenType = TokenType.email_verification,
    userId?: string,
  ) {
    const tokenValid = await this.prisma.tempToken.findFirst({
      where: {
        token_type,
        token,
        ...(userId && { userId }),
        expiresAt: {
          gte: new Date(),
        },
      },
      include: {
        user: true,
      },
    });

    if (!tokenValid) {
      throw new BadRequestException(MESSAGES.INVALID_TOKEN);
    }

    return tokenValid;
  }

  async validateUserPermissions(data: {
    userId: string;
    deviceId?: string;
    extraPermissions?: { action: ActionEnum; subject: SubjectEnum }[];
    allowAgents?: boolean;
    allowedWarehouseManagers?: 'main' | 'all';
    agentCategory?: AgentCategory;
  }) {
    const {
      userId,
      deviceId,
      extraPermissions = [],
      allowAgents = true,
      allowedWarehouseManagers,
      agentCategory,
    } = data;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
        agentDetails: true,
        warehouseManager: {
          include: {
            warehouse: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const userRole = user.role.role;

    const hasManagePermission = user.role.permissions.some(
      (permission) =>
        permission.action === ActionEnum.manage &&
        permission.subject === SubjectEnum.all,
    );

    // allow admin and super-admin users to access resource
    if (
      userRole == 'admin' ||
      userRole == 'super-admin' ||
      hasManagePermission
    ) {
      return true;
    }

    const hasExtraPermission = extraPermissions.some((extra) =>
      user.role.permissions.some(
        (permission) =>
          permission.action === extra.action &&
          permission.subject === extra.subject,
      ),
    );

    if (hasExtraPermission) {
      return;
    }

    if (allowAgents) {
      if (user.agentDetails) {
        if (agentCategory && user.agentDetails.category !== agentCategory) {
          throw new ForbiddenException();
        }
        if (!deviceId) return true;
        await this.validateInstallerDeviceAssignment(
          deviceId,
          user.agentDetails.id,
        );
      } else {
        throw new ForbiddenException();
      }
    }

    if (allowedWarehouseManagers) {
      if (user.warehouseManager) {
        if (
          allowedWarehouseManagers === 'main' &&
          !user.warehouseManager.warehouse.isMain
        ) {
          throw new ForbiddenException();
        }
        return true;
      } else {
        throw new ForbiddenException();
      }
    }

    throw new ForbiddenException();
  }

  async validateInstallerDeviceAssignment(
    deviceId: string,
    installerAgentId: string,
  ) {
    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
      select: {
        saleItems: {
          select: {
            sale: {
              select: {
                installerTasks: {
                  where: {
                    installerAgentId,
                    status: {
                      in: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS],
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!device) {
      throw new ForbiddenException(
        'Device not assigned to this installer or task not active',
      );
    }
  }
}
