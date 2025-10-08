import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UsersService } from './users.service';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiExtraModels,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { UserEntity } from './entity/user.entity';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesAndPermissionsGuard } from '../auth/guards/roles.guard';
import { ActionEnum, SubjectEnum, User } from '@prisma/client';
import { UpdateUserDto } from './dto/update-user.dto';
import { MESSAGES } from '../constants';
import { ListUsersQueryDto } from './dto/list-users.dto';
import { GetSessionUser } from '../auth/decorators/getUser';
import { RolesAndPermissions } from '../auth/decorators/roles.decorator';

@SkipThrottle()
@ApiTags('Users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.User}`,
      `${ActionEnum.read}:${SubjectEnum.User}`,
    ],
  })
  @Get()
  @ApiBearerAuth('access_token')
  @ApiOkResponse({
    description: 'List all users with pagination',
    type: UserEntity,
    isArray: true,
  })
  @ApiBadRequestResponse({})
  @ApiExtraModels(ListUsersQueryDto)
  @ApiHeader({
    name: 'Authorization',
    description: 'JWT token used for authentication',
    required: true,
    schema: {
      type: 'string',
      example: 'Bearer <token>',
    },
  })
  @HttpCode(HttpStatus.OK)
  async listUsers(@Query() query: ListUsersQueryDto) {
    return await this.usersService.getUsers(query);
  }

  @UseGuards(JwtAuthGuard)
  @Patch()
  @ApiBearerAuth('access_token')
  @ApiOperation({
    summary: 'Update user details',
    description:
      'This endpoint allows authenticated users to update their details. The userId for the user is derived from the JWT token provided in the Authorization header.',
  })
  @ApiBody({ type: UpdateUserDto })
  @ApiOkResponse({
    description: 'User profile updated successfully',
    type: UserEntity,
  })
  async updateUser(
    // @Param('id') id: string,
    @GetSessionUser('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
  ): Promise<User> {
    if (Object.keys(updateUserDto).length === 0) {
      throw new BadRequestException(MESSAGES.EMPTY_OBJECT);
    }
    return new UserEntity(
      await this.usersService.updateUser(id, updateUserDto),
    );
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.User}`,
      `${ActionEnum.write}:${SubjectEnum.User}`,
    ],
  })
  @Patch(':id')
  @ApiBearerAuth('access_token')
  @ApiOperation({
    summary: 'Update user details by superuser',
    description: 'This endpoint allows superusers to update user details.',
  })
  @ApiBody({ type: UpdateUserDto })
  @ApiOkResponse({
    description: 'User profile updated successfully',
    type: UserEntity,
  })
  async superUserUpdateUser(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
  ): Promise<User> {
    if (Object.keys(updateUserDto).length === 0) {
      throw new BadRequestException(MESSAGES.EMPTY_OBJECT);
    }
    return new UserEntity(
      await this.usersService.updateUser(id, updateUserDto),
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('/single')
  @ApiOperation({
    summary: 'Fetch user details',
    description:
      'This endpoint allows an authenticated user to fetch their details.',
  })
  @ApiBearerAuth('access_token')
  @ApiOkResponse({
    type: UserEntity,
  })
  async fetchUser(@GetSessionUser('id') id: string): Promise<User> {
    return new UserEntity(await this.usersService.fetchUser(id));
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.User}`,
      `${ActionEnum.read}:${SubjectEnum.User}`,
    ],
  })
  @ApiParam({
    name: 'id',
    description: "User's id to fetch details",
  })
  @Get('single/:id')
  @ApiOperation({
    summary: 'Fetch user details by superuser',
    description: 'This endpoint allows a permitted user fetch a user details.',
  })
  @ApiBearerAuth('access_token')
  @ApiOkResponse({
    type: UserEntity,
  })
  async superUserFetchUser(@Param('id') id: string): Promise<User> {
    return new UserEntity(await this.usersService.fetchUser(id));
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.User}`,
      `${ActionEnum.delete}:${SubjectEnum.User}`,
    ],
  })
  @ApiParam({
    name: 'id',
    description: "User's id",
  })
  @ApiOperation({
    summary: 'Delete user by superuser',
    description: 'This endpoint allows a permitted user to delete a user.',
  })
  @ApiBearerAuth('access_token')
  @ApiOkResponse({
    type: UserEntity,
  })
  @Delete(':id')
  async deleteUser(@Param('id') id: string) {
    return await this.usersService.deleteUser(id);
  }

  // @Post('bulk-password-reset')
  // async bulkPasswordReset(
  //   @Body() bulkPasswordResetDto,
  // ){
    
  //   return this.usersService.bulkPasswordReset(bulkPasswordResetDto.emails);
  // }
}
