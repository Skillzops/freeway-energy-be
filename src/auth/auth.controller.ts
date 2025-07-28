import {
  Controller,
  Post,
  Body,
  HttpCode,
  Param,
  Res,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Response } from 'express';
import { AuthService } from './auth.service';
import { UserEntity } from '../users/entity/user.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { ForgotPasswordDTO } from './dto/forgot-password.dto';
import { PasswordResetDTO } from './dto/password-reset.dto';
import { LoginUserDTO } from './dto/login-user.dto';
import { SkipThrottle } from '@nestjs/throttler';
import { plainToClass } from 'class-transformer';
import { CreateSuperUserDto } from './dto/create-super-user.dto';
import { JwtAuthGuard } from './guards/jwt.guard';
import { RolesAndPermissionsGuard } from './guards/roles.guard';
import { ActionEnum, SubjectEnum, TokenType } from '@prisma/client';
import { RolesAndPermissions } from './decorators/roles.decorator';
import {
  CreateUserPasswordDto,
  CreateUserPasswordParamsDto,
} from './dto/create-user-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { GetSessionUser } from './decorators/getUser';

@SkipThrottle()
@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Customers}`,
      `${ActionEnum.write}:${SubjectEnum.Customers}`,
    ],
  })
  @Post('add-user')
  @ApiBearerAuth('access_token')
  @ApiCreatedResponse({})
  @ApiBadRequestResponse({})
  @ApiInternalServerErrorResponse({})
  @ApiBody({
    type: CreateUserDto,
    description: 'Json structure for request payload',
  })
  @HttpCode(HttpStatus.CREATED)
  async addUser(@Body() registerUserDto: CreateUserDto) {
    const newUser = await this.authService.addUser(registerUserDto);
    return plainToClass(UserEntity, newUser);
  }

  @Post('create-superuser')
  @ApiCreatedResponse({})
  @ApiBadRequestResponse({})
  @ApiForbiddenResponse({})
  @ApiInternalServerErrorResponse({})
  @ApiBody({
    type: CreateSuperUserDto,
    description: 'Json structure for request payload',
  })
  @HttpCode(HttpStatus.CREATED)
  // @ApiExcludeEndpoint()
  async createSuperuser(@Body() registerUserDto: CreateSuperUserDto) {
    const newUser = await this.authService.createSuperuser(registerUserDto);
    return plainToClass(UserEntity, newUser);
  }

  @SkipThrottle({ default: false })
  @Post('login')
  @ApiOkResponse({})
  @ApiBadRequestResponse({})
  @ApiUnauthorizedResponse({})
  @ApiInternalServerErrorResponse({})
  @ApiBody({
    type: LoginUserDTO,
    description: 'Json structure for request payload',
  })
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() userDetails: LoginUserDTO,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.authService.login(userDetails, res);
  }

  @Post('forgot-password')
  @ApiOkResponse({})
  @ApiBadRequestResponse({})
  @ApiInternalServerErrorResponse({})
  @ApiBody({
    type: ForgotPasswordDTO,
    description: 'Json structure for request payload',
  })
  @HttpCode(HttpStatus.OK)
  forgotPassword(@Body() forgotPasswordDetails: ForgotPasswordDTO) {
    return this.authService.forgotPassword(forgotPasswordDetails);
  }

  @Post('verify-reset-token/:userid/:token')
  @ApiParam({
    name: 'userid',
    description: 'userid of user',
  })
  @ApiParam({
    name: 'token',
    description: 'The token used for password reset verification',
    type: String,
  })
  @ApiOkResponse({})
  @ApiBadRequestResponse({})
  @ApiInternalServerErrorResponse({})
  @HttpCode(HttpStatus.OK)
  async verifyResetToken(@Param() params: CreateUserPasswordParamsDto) {
    return await this.authService.verifyToken(
      params.token,
      TokenType.password_reset,
      params.userid,
    );
  }

  @Post('verify-email-verification-token/:userid/:token')
  @ApiParam({
    name: 'userid',
    description: 'userid of user',
  })
  @ApiParam({
    name: 'token',
    description: 'The token used for email verification',
    type: String,
  })
  @ApiOkResponse({})
  @ApiBadRequestResponse({})
  @ApiInternalServerErrorResponse({})
  @HttpCode(HttpStatus.OK)
  async verifyEmailVerficationToken(
    @Param() params: CreateUserPasswordParamsDto,
  ) {
    return await this.authService.verifyToken(
      params.token,
      TokenType.email_verification,
      params.userid,
    );
  }

  @Post('create-user-password/:userid/:token')
  @ApiParam({
    name: 'userid',
    description: 'userid of the new user',
  })
  @ApiParam({
    name: 'token',
    description: 'valid password creation token',
  })
  @ApiOkResponse({})
  @ApiBadRequestResponse({})
  @ApiInternalServerErrorResponse({})
  @HttpCode(HttpStatus.OK)
  createUserPassword(
    @Body() body: CreateUserPasswordDto,
    @Param() params: CreateUserPasswordParamsDto,
  ) {
    return this.authService.createUserPassword(body, params);
  }

  // @UseGuards(JwtAuthGuard)
  @Post('change-password')
  @ApiBearerAuth('access_token')
  @ApiOkResponse({})
  @ApiBadRequestResponse({})
  @ApiInternalServerErrorResponse({})
  @HttpCode(HttpStatus.OK)
  changePassword(
    @Body() body: ChangePasswordDto,
    @GetSessionUser('id') userId: string,
  ) {
    return this.authService.changePassword(body, userId);
  }

  @Post('reset-password')
  @ApiOkResponse({})
  @ApiBadRequestResponse({})
  @ApiInternalServerErrorResponse({})
  @ApiBody({
    type: PasswordResetDTO,
    description: 'Json structure for request payload',
  })
  @HttpCode(HttpStatus.OK)
  resetPassword(@Body() resetPasswordDetails: PasswordResetDTO) {
    return this.authService.resetPassword(resetPasswordDetails);
  }
}
