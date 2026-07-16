import { PrismaClient, TokenType} from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../mailer/email.service';
import { TermiiService } from '../termii/termii.service';
import { CreateUserDto } from './dto/create-user.dto';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { ForgotPasswordDTO } from './dto/forgot-password.dto';
import { MESSAGES } from '../constants';
import * as argon from 'argon2';
import { fakeData } from '../../src/../test/mockData/user';

jest.mock('argon2', () => ({
  verify: jest.fn(),
  hash: jest.fn(),
}));

jest.mock('../utils/helpers.util', () => ({
  hashPassword: jest.fn().mockResolvedValue(expect.any(String)),
  cleanPhoneNumber: jest.fn((phone: string) => phone),
}));

describe('AuthService', () => {
  let service: AuthService;
  let prisma: PrismaService;

  let mockPrismaService: DeepMockProxy<PrismaClient>;

  const mockEmailService = {
    sendMail: jest.fn(),
  };

  const mockTermiiService = {
    sendSms: jest.fn().mockResolvedValue({ success: true }),
    formatNewUserOnboardingMessage: jest
      .fn()
      .mockReturnValue('Welcome onboarding SMS'),
  };

  const mockJwtService = {
    sign: jest.fn(),
  };

  const testData = {
    firstname: 'John',
    lastname: 'Doe',
    email: 'john.doe@example.com',
    phone: '09062736182',
    role: '66dce4173c5d3b2fd5f5728',
    location: 'Abuja',
  };

  const tokenData = {
    id: 'token-id',
    userId: 'user-id',
    token_type: TokenType.password_reset,
    token: 'token',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    created_at: new Date(),
    updated_at: new Date(),
    deleted_at: null,
  };

  const mockConfigService = {
    get: jest.fn((key: string) => {
      if (key === 'mail.from') {
        return 'no-reply@freewave.com';
      }
      return null;
    }),
  };

  beforeEach(async () => {
    mockPrismaService = mockDeep<PrismaClient>();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: EmailService, useValue: mockEmailService },
        { provide: TermiiService, useValue: mockTermiiService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('Add User', () => {
    it('should create a new user and send email', async () => {
      const dto: CreateUserDto = { ...testData };

      (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.role.findFirst as jest.Mock).mockResolvedValue({
        id: 'role-id',
        name: 'admin',
      });

      (prisma.user.create as jest.Mock).mockResolvedValue({
        id: 'user-id',
        phone: dto.phone,
        ...dto,
      });
      (prisma.tempToken.create as jest.Mock).mockResolvedValue(tokenData);

      const result = await service.addUser(dto);

      expect(result).toEqual({ id: 'user-id', phone: dto.phone, ...dto });
      expect(prisma.user.create).toHaveBeenCalled();

      expect(mockEmailService.sendMail).toHaveBeenCalled();
      expect(mockTermiiService.sendSms).toHaveBeenCalled();
    });

    it('should throw BadRequestException if email already exists', async () => {
      const dto: CreateUserDto = {
        ...testData,
      };

      (prisma.user.findFirst as jest.Mock).mockResolvedValue({
        id: 'existing-id',
      });

      await expect(service.addUser(dto)).rejects.toThrow(BadRequestException);
      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { email: dto.email },
      });
    });

    it('should throw BadRequestException if role does not exist', async () => {
      const { role, ...dataWithoutRole } = testData;

      const dto: CreateUserDto = {
        ...dataWithoutRole,
        role: role + 'non-existent-role-id',
      };

      (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.role.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.addUser(dto)).rejects.toThrow(BadRequestException);
      expect(prisma.role.findFirst).toHaveBeenCalledWith({
        where: { id: dto.role },
      });
    });
  });

  describe('login', () => {
    it('should return a user and access token', async () => {
      const mockUser = {
        id: fakeData.id,
        email: fakeData.email,
        password: fakeData.password,
      };
      const mockPayload = { sub: 'user-id' };
      const mockAccessToken = 'token';

      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);
      (argon.verify as jest.Mock).mockResolvedValue(true);
      (mockJwtService.sign as jest.Mock).mockReturnValue(mockAccessToken);

      const mockRes = {
        setHeader: jest.fn(),
      } as unknown as Response;

      const result = await service.login(
        { email: fakeData.email, password: 'password' },
        mockRes,
      );

      expect(prisma.user.findUnique).toHaveBeenCalled()
      expect(mockJwtService.sign).toHaveBeenCalledWith(mockPayload);
      expect(result).toHaveProperty('id');
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Access-Control-Expose-Headers',
        'access_token',
      );
    });

    it('should throw UnauthorizedException for invalid credentials', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.login(
          { email: fakeData.email, password: fakeData.password },
          {} as any,
        ),
      ).rejects.toThrow(new UnauthorizedException(MESSAGES.INVALID_CREDENTIALS));
    });
  });

  describe('forgotPassword', () => {
    const forgotPasswordDTO: ForgotPasswordDTO = {
      email: testData.email,
    };

    it('should throw error if user is not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.forgotPassword(forgotPasswordDTO)).rejects.toThrow(
        new BadRequestException('User not found'),
      );
    });

    it('should send a reset password email if user exists', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(fakeData);
      (prisma.tempToken.create as jest.Mock).mockResolvedValue(tokenData);

      await service.forgotPassword(forgotPasswordDTO);

      expect(mockPrismaService.tempToken.create).toHaveBeenCalled();
      expect(mockEmailService.sendMail).toHaveBeenCalled();
    });
  });

  describe('verifyResetToken', () => {
    it('should verify reset token', async () => {
      const resetToken = 'valid-token';

      mockPrismaService.tempToken.findFirst.mockResolvedValue(tokenData);
      const result = await service.verifyToken(resetToken);
      expect(result).toHaveProperty("id");
    });

    it('should throw BadRequestException if token is invalid or expired', async () => {
      mockPrismaService.tempToken.findFirst.mockResolvedValue(null);

      await expect(service.verifyToken('invalid-token')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('resetPassword', () => {
    const resetPasswordDto = {
      userid: 'user-id',
      newPassword: 'new-password',
      confirmNewPassword: 'new-password',
      resetToken: 'valid-token',
    };

    it('should reset password successfully', async () => {
      mockPrismaService.tempToken.findFirst.mockResolvedValue(tokenData);
      mockPrismaService.user.update.mockResolvedValue(fakeData);
      mockPrismaService.tempToken.update.mockResolvedValue(null);

      const result = await service.resetPassword(resetPasswordDto);

      expect(result).toEqual({ message: MESSAGES.PWD_RESET_SUCCESS });
      expect(mockPrismaService.user.update).toHaveBeenCalledWith({
        where: { id: 'user-id' },
        data: { password: expect.any(String) },
      });
      expect(mockPrismaService.tempToken.update).toHaveBeenCalledWith({
        where: { id: tokenData.id },
        data: {
          token: null,
          expiresAt: expect.any(Date),
        },
      });
    });

    it('should throw BadRequestException if token is invalid or expired', async () => {
      mockPrismaService.tempToken.findFirst.mockResolvedValue(null);

      await expect(service.resetPassword(resetPasswordDto)).rejects.toThrow(
        BadRequestException,
      );
    });
  });
});
