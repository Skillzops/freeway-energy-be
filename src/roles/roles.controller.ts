import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Delete,
  NotFoundException,
  InternalServerErrorException,
  ConflictException,
  UseGuards,
} from '@nestjs/common';
import { RolesService } from './roles.service';
import {
  ApiTags,
  ApiResponse,
  ApiOperation,
  ApiParam,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { AssignUserToRoleDto } from './dto/assign-user.dto';
import { RolesAndPermissions } from '../auth/decorators/roles.decorator';
import { ActionEnum, SubjectEnum } from '@prisma/client';
import { RolesAndPermissionsGuard } from '../auth/guards/roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { GetSessionUser } from '../auth/decorators/getUser';

@ApiTags('Roles')
@Controller('roles')
export class RolesController {
  constructor(private readonly roleService: RolesService) {}

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.User}`,
      `${ActionEnum.write}:${SubjectEnum.User}`,
    ],
  })
  @ApiBearerAuth('access_token')
  @Post()
  @ApiOperation({ summary: 'Create a new role' })
  @ApiResponse({ status: 201, description: 'Role created successfully' })
  @ApiResponse({
    status: 400,
    description: 'Bad Request. Role already exists or invalid input.',
  })
  @ApiBody({
    type: CreateRoleDto,
    description: 'Data for creating a new role',
    examples: {
      example1: {
        summary: 'Example of a role creation',
        value: {
          role: 'Admin',
          active: true,
          permissionIds: ['permId1', 'permId2'],
        },
      },
    },
  })
  async create(
    @Body() createRoleDto: CreateRoleDto,
    @GetSessionUser('id') id: string,
  ) {
    try {
      return await this.roleService.create(createRoleDto, id);
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      throw new InternalServerErrorException('Error creating role');
    }
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.User}`,
      `${ActionEnum.read}:${SubjectEnum.User}`,
    ],
  })
  @ApiBearerAuth('access_token')
  @Get()
  @ApiOperation({ summary: 'Retrieve all roles with permissions' })
  @ApiResponse({ status: 200, description: 'Roles retrieved successfully' })
  async findAll() {
    try {
      return await this.roleService.findAll();
    } catch (error) {
      console.log({ error });
      throw new InternalServerErrorException('Error retrieving roles');
    }
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.User}`,
      `${ActionEnum.read}:${SubjectEnum.User}`,
    ],
  })
  @ApiBearerAuth('access_token')
  @Get(':id')
  @ApiOperation({ summary: 'Get a role by ID with permissions' })
  @ApiParam({ name: 'id', description: 'Role ID to retrieve' })
  @ApiResponse({ status: 200, description: 'Role retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  async findOne(@Param('id') id: string) {
    const role = await this.roleService.findOne(id);
    if (!role) {
      throw new NotFoundException(`Role with ID ${id} not found`);
    }
    return role;
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.User}`,
      `${ActionEnum.write}:${SubjectEnum.User}`,
    ],
  })
  @ApiBearerAuth('access_token')
  @Put(':id')
  @ApiOperation({ summary: 'Update a role' })
  @ApiParam({ name: 'id', description: 'ID of the role to update' })
  @ApiResponse({ status: 200, description: 'Role updated successfully' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  @ApiBody({
    type: UpdateRoleDto,
    description: 'Data for updating a role',
    examples: {
      example1: {
        summary: 'Example of a role update',
        value: {
          role: 'Manager',
          active: false,
          permissionIds: ['perm1', 'perm3'],
        },
      },
    },
  })
  async update(@Param('id') id: string, @Body() updateRoleDto: UpdateRoleDto) {
    try {
      return await this.roleService.update(id, updateRoleDto);
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      throw new InternalServerErrorException('Error updating role');
    }
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.User}`,
      `${ActionEnum.delete}:${SubjectEnum.User}`,
    ],
  })
  @ApiBearerAuth('access_token')
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a role by ID' })
  @ApiParam({ name: 'id', description: 'ID of the role to delete' })
  @ApiResponse({ status: 200, description: 'Role deleted successfully' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  async remove(@Param('id') id: string): Promise<{ message: string }> {
    const deletedRole = await this.roleService.remove(id);
    if (!deletedRole) {
      throw new NotFoundException(`Role with ID ${id} not found`);
    }
    return { message: 'Role deleted successfully' };
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.User}`,
      `${ActionEnum.write}:${SubjectEnum.User}`,
    ],
  })
  @ApiBearerAuth('access_token')
  @Post('/:id/assign')
  @ApiOperation({ summary: 'Assign a user to a role' })
  @ApiParam({ name: 'id', description: 'ID of the user to assign the role to' })
  @ApiResponse({
    status: 200,
    description: 'User assigned to role successfully',
  })
  @ApiResponse({ status: 404, description: 'Role or user not found' })
  @ApiBody({
    type: AssignUserToRoleDto,
    description: 'Data for assigning a user to a role',
    examples: {
      example1: {
        summary: 'Assigning a role to a user',
        value: { roleId: 'role1' },
      },
    },
  })
  async assignUserToRole(
    @Param('id') id: string,
    @Body() assignUserToRoleDto: AssignUserToRoleDto,
  ): Promise<{ message: string }> {
    const result = await this.roleService.assignUserToRole(
      id,
      assignUserToRoleDto,
    );
    if (!result) {
      throw new NotFoundException(
        `Role with ID ${id} not found or user not found`,
      );
    }
    return { message: 'User assigned to role successfully' };
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.User}`,
      `${ActionEnum.read}:${SubjectEnum.User}`,
    ],
  })
  @ApiBearerAuth('access_token')
  @Get('/more_details/:id')
  @ApiOperation({ summary: 'Get a role with users and permissions by ID' })
  @ApiParam({
    name: 'id',
    description: 'Role ID to retrieve with users and permissions',
  })
  @ApiResponse({
    status: 200,
    description: 'Role with users and permissions retrieved successfully',
  })
  @ApiResponse({ status: 404, description: 'Role not found' })
  async getRole(@Param('id') roleId: string): Promise<any> {
    const roleDetails =
      await this.roleService.getRoleWithUsersAndPermissions(roleId);
    if (!roleDetails) {
      throw new NotFoundException(`Role with ID ${roleId} not found`);
    }
    return roleDetails;
  }
}
