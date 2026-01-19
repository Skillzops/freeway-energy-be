import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Get,
  Query,
  Param,
  Delete,
  UseInterceptors,
  UploadedFiles,
  ParseFilePipeBuilder,
  Patch,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { SkipThrottle } from '@nestjs/throttler';
import { RolesAndPermissions } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesAndPermissionsGuard } from '../auth/guards/roles.guard';
import { ActionEnum, AgentCategory, SubjectEnum, User } from '@prisma/client';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiExcludeEndpoint,
  ApiExtraModels,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { GetSessionUser } from '../auth/decorators/getUser';
import { UserEntity } from '../users/entity/user.entity';
import { ListCustomersQueryDto } from './dto/list-customers.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import {
  ApproveCustomerDto,
  BulkApproveCustomersDto,
  ListRejectedCustomersDto,
} from './dto/customer-approval.dto';
import { AuthService } from 'src/auth/auth.service';

@SkipThrottle()
@ApiTags('Customers')
@Controller('customers')
export class CustomersController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly authService: AuthService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('access_token')
  @ApiHeader({
    name: 'Authorization',
    description: 'JWT token used for authentication',
    required: true,
    schema: {
      type: 'string',
      example: 'Bearer <token>',
    },
  })
  @ApiBody({
    type: CreateCustomerDto,
    description: 'Json structure for request payload',
  })
  @ApiOperation({
    summary: 'Create customer',
    description:
      'Create a new customer with optional passport photo and ID image',
  })
  @ApiBadRequestResponse({})
  @ApiConsumes('multipart/form-data')
  @HttpCode(HttpStatus.CREATED)
  @Post('create')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'passportPhoto', maxCount: 1 },
      { name: 'idImage', maxCount: 1 },
      { name: 'contractFormImage', maxCount: 1 },
    ]),
  )
  async create(
    @Body() createCustomersDto: CreateCustomerDto,
    @UploadedFiles()
    files: {
      passportPhoto?: Express.Multer.File[];
      idImage?: Express.Multer.File[];
      contractFormImage?: Express.Multer.File[];
    },
    @GetSessionUser('id') requestUserId: string,
  ) {
    await this.authService.validateUserPermissions({
      userId: requestUserId,
      extraPermissions: [
        { action: ActionEnum.manage, subject: SubjectEnum.Agents },
        { action: ActionEnum.read, subject: SubjectEnum.Agents },
        { action: ActionEnum.manage, subject: SubjectEnum.Customers },
        { action: ActionEnum.write, subject: SubjectEnum.Customers },
      ],
      agentCategory: AgentCategory.SALES,
    });

    if (files?.passportPhoto?.[0]) {
      const passportPhotoValidator = new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: /(jpeg|jpg|png|svg)$/i })
        .build({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY });

      await passportPhotoValidator.transform(files.passportPhoto[0]);
    }

    if (files?.idImage?.[0]) {
      const idImageValidator = new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: /(jpeg|jpg|png|svg)$/i })
        .build({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY });

      await idImageValidator.transform(files.idImage[0]);
    }

    if (files?.contractFormImage?.[0]) {
      const contractFormImage = new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: /(jpeg|jpg|png|svg)$/i })
        .build({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY });

      await contractFormImage.transform(files.contractFormImage[0]);
    }

    return await this.customersService.createCustomer(
      requestUserId,
      createCustomersDto,
      files?.passportPhoto?.[0],
      files?.idImage?.[0],
      files?.contractFormImage?.[0],
    );
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Customers}`,
      `${ActionEnum.write}:${SubjectEnum.Customers}`,
    ],
  })
  @ApiParam({
    name: 'id',
    description: "Customer's id to update",
  })
  @ApiBody({
    type: UpdateCustomerDto,
    description: 'Json structure for update request payload',
  })
  @ApiOperation({
    summary: 'Update customer',
    description:
      'Update customer details with optional new passport photo and ID image',
  })
  @ApiBearerAuth('access_token')
  @ApiOkResponse({
    type: UserEntity,
    description: 'Updated customer details',
  })
  @ApiBadRequestResponse({})
  @ApiHeader({
    name: 'Authorization',
    description: 'JWT token used for authentication',
    required: true,
    schema: {
      type: 'string',
      example: 'Bearer <token>',
    },
  })
  @ApiConsumes('multipart/form-data')
  @HttpCode(HttpStatus.OK)
  @Patch(':id')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'passportPhoto', maxCount: 1 },
      { name: 'idImage', maxCount: 1 },
      { name: 'contractFormImage', maxCount: 1 },
    ]),
  )
  async updateCustomer(
    @Param('id') id: string,
    @Body() updateCustomerDto: UpdateCustomerDto,
    @UploadedFiles()
    files: {
      passportPhoto?: Express.Multer.File[];
      idImage?: Express.Multer.File[];
      contractFormImage?: Express.Multer.File[];
    },
  ) {
    if (files?.passportPhoto?.[0]) {
      const passportPhotoValidator = new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: /(jpeg|jpg|png|svg)$/i })
        .build({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY });

      await passportPhotoValidator.transform(files.passportPhoto[0]);
    }

    if (files?.idImage?.[0]) {
      const idImageValidator = new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: /(jpeg|jpg|png|svg)$/i })
        .build({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY });

      await idImageValidator.transform(files.idImage[0]);
    }

    if (files?.contractFormImage?.[0]) {
      const contractFormImage = new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: /(jpeg|jpg|png|svg)$/i })
        .build({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY });

      await contractFormImage.transform(files.contractFormImage[0]);
    }

    return await this.customersService.updateCustomer(
      id,
      updateCustomerDto,
      files?.passportPhoto?.[0],
      files?.idImage?.[0],
      files?.contractFormImage?.[0],
    );
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Customers}`,
      `${ActionEnum.read}:${SubjectEnum.Customers}`,
    ],
  })
  @Get()
  @ApiBearerAuth('access_token')
  @ApiOkResponse({
    description: 'List all customers with pagination',
    type: UserEntity,
    isArray: true,
  })
  @ApiBadRequestResponse({})
  @ApiExtraModels(ListCustomersQueryDto)
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
  async listCustomers(@Query() query: ListCustomersQueryDto) {
    return await this.customersService.getCustomers(query);
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Customers}`,
      `${ActionEnum.read}:${SubjectEnum.Customers}`,
    ],
  })
  @ApiParam({
    name: 'id',
    description: "Customer's id to fetch details",
  })
  @Get('single/:id')
  @ApiOperation({
    summary: 'Fetch customer details by superuser',
    description:
      'This endpoint allows a permitted user to fetch customer details.',
  })
  @ApiBearerAuth('access_token')
  @ApiOkResponse({
    type: UserEntity,
  })
  async fetchUser(@Param('id') id: string): Promise<User> {
    return new UserEntity(await this.customersService.getCustomer(id));
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Customers}`,
      `${ActionEnum.delete}:${SubjectEnum.Customers}`,
    ],
  })
  @ApiParam({
    name: 'id',
    description: "Customer's id",
  })
  @ApiOperation({
    summary: 'Delete customer by superuser',
    description: 'This endpoint allows a permitted user to delete a customer.',
  })
  @ApiBearerAuth('access_token')
  @ApiOkResponse({
    type: UserEntity,
  })
  @Delete(':id')
  async deleteUser(@Param('id') id: string) {
    return await this.customersService.deleteCustomer(id);
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Agents}`,
      `${ActionEnum.manage}:${SubjectEnum.Customers}`,
    ],
  })
  @ApiBearerAuth('access_token')
  @ApiHeader({
    name: 'Authorization',
    description: 'JWT token used for authentication',
    required: true,
    schema: {
      type: 'string',
      example: 'Bearer <token>',
    },
  })
  @Get('stats')
  @ApiOkResponse({
    description: 'Fetch Customer Statistics',
    isArray: true,
  })
  @ApiBadRequestResponse({})
  @HttpCode(HttpStatus.OK)
  async getCustomerStats() {
    return await this.customersService.getCustomerStats();
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Agents}`,
      `${ActionEnum.manage}:${SubjectEnum.Customers}`,
    ],
  })
  @ApiBearerAuth('access_token')
  @ApiHeader({
    name: 'Authorization',
    description: 'JWT token used for authentication',
    required: true,
    schema: {
      type: 'string',
      example: 'Bearer <token>',
    },
  })
  @ApiParam({
    name: 'id',
    description: 'Customer id to fetch tabs',
  })
  @ApiOkResponse({
    description: 'Fetch Customer Details Tabs',
    isArray: true,
  })
  @ApiBadRequestResponse({})
  @HttpCode(HttpStatus.OK)
  @Get(':id/tabs')
  async getCustomerTabs(@Param('id') customerId: string) {
    return this.customersService.getCustomerTabs(customerId);
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [`${ActionEnum.manage}:${SubjectEnum.Customers}`],
  })
  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve or reject a customer',
    description:
      'Admin endpoint to approve or reject customers created by agents. Approved customers become active, rejected customers remain inactive.',
  })
  @ApiBearerAuth('access_token')
  @ApiHeader({
    name: 'Authorization',
    description: 'JWT token used for authentication',
    required: true,
    schema: {
      type: 'string',
      example: 'Bearer <token>',
    },
  })
  @ApiParam({
    name: 'id',
    description: 'Customer ID to approve/reject',
  })
  @ApiBody({
    type: ApproveCustomerDto,
    description: 'Approval decision with optional rejection reason',
  })
  async approveCustomer(
    @Param('id') customerId: string,
    @Body() approveDto: ApproveCustomerDto,
    @GetSessionUser('id') approverUserId: string,
  ) {
    return await this.customersService.approveCustomer(
      customerId,
      approveDto,
      approverUserId,
    );
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [`${ActionEnum.manage}:${SubjectEnum.Customers}`],
  })
  @Post('bulk-approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Bulk approve or reject customers',
    description:
      'Admin endpoint to approve or reject multiple customers at once.',
  })
  @ApiBearerAuth('access_token')
  @ApiHeader({
    name: 'Authorization',
    description: 'JWT token used for authentication',
    required: true,
  })
  @ApiBody({
    type: BulkApproveCustomersDto,
    description: 'Array of customer IDs and approval decision',
  })
  @ApiOkResponse({
    description: 'Customers approval status updated',
  })
  async bulkApproveCustomers(
    @Body() bulkApproveDto: BulkApproveCustomersDto,
    @GetSessionUser('id') approverUserId: string,
  ) {
    return await this.customersService.bulkApproveCustomers(
      bulkApproveDto,
      approverUserId,
    );
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Customers}`,
      `${ActionEnum.read}:${SubjectEnum.Customers}`,
    ],
  })
  @ApiBearerAuth('access_token')
  @ApiParam({
    name: 'id',
    description: 'Customer ID',
  })
  @ApiOperation({
    summary: 'Get customer rejection details',
    description:
      'Get rejection reason and history for a rejected customer. Agent can see why their customer was rejected.',
  })
  @ApiOkResponse({
    description: 'Customer rejection details with history',
  })
  @Get(':id/rejection-details')
  @HttpCode(HttpStatus.OK)
  async getCustomerRejectionDetails(@Param('id') customerId: string) {
    return await this.customersService.getCustomerRejectionDetails(customerId);
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Customers}`,
      `${ActionEnum.read}:${SubjectEnum.Customers}`,
    ],
  })
  @ApiBearerAuth('access_token')
  @ApiOperation({
    summary: 'List rejected customers for resubmission',
    description:
      'List all customers created by this agent that were rejected and need resubmission',
  })
  @ApiOkResponse({
    description: 'List of rejected customers needing resubmission',
    isArray: true,
  })
  @Get('rejected-list')
  @HttpCode(HttpStatus.OK)
  async listRejectedCustomers(
    @Query() query: ListRejectedCustomersDto,
    @GetSessionUser('id') agentId: string,
  ) {
    return await this.customersService.listRejectedCustomers(agentId, query);
  }

  @ApiExcludeEndpoint()
  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Customers}`,
      `${ActionEnum.read}:${SubjectEnum.Customers}`,
    ],
  })
  @Get('fix/clean')
  async cleanCustomers(
  ) {
    return await this.customersService.cleanCustomers();
  }
}
