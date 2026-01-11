import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
  ApiOkResponse,
  ApiCreatedResponse,
  ApiBadRequestResponse,
  ApiNotFoundResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesAndPermissionsGuard } from '../auth/guards/roles.guard';
import { RolesAndPermissions } from '../auth/decorators/roles.decorator';
import { GetSessionUser } from '../auth/decorators/getUser';
import { ActionEnum, SubjectEnum } from '@prisma/client';
import {
  CreateCustomerInteractionDto,
  UpdateCustomerInteractionDto,
  ListCustomerInteractionsDto,
} from './dto/customer-interaction.dto';
import { CustomerInteractionService } from './customers-interaction.service';

@ApiTags('Customer Interactions')
@Controller('customers/:customerId/interactions')
@UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
@ApiBearerAuth('access_token')
export class CustomerInteractionController {
  constructor(
    private readonly interactionService: CustomerInteractionService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Customers}`,
      `${ActionEnum.write}:${SubjectEnum.Customers}`,
    ],
  })
  @ApiOperation({
    summary: 'Create customer interaction',
    description:
      'Create a new customer interaction record (call, email, meeting, etc.)',
  })
  @ApiCreatedResponse({
    description: 'Customer interaction created successfully',
  })
  @ApiBadRequestResponse({
    description: 'Invalid data or customer/user not found',
  })
  async createInteraction(
    @Param('customerId') customerId: string,
    @Body() dto: CreateCustomerInteractionDto,
    @GetSessionUser('id') userId: string,
  ) {
    return await this.interactionService.createInteraction(
      customerId,
      userId,
      dto,
    );
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Customers}`,
      `${ActionEnum.read}:${SubjectEnum.Customers}`,
    ],
  })
  @ApiOperation({
    summary: 'List customer interactions',
    description:
      'Retrieve interactions for a specific customer with pagination and filtering',
  })
  @ApiOkResponse({
    description: 'List of interactions retrieved successfully',
  })
  @ApiNotFoundResponse({
    description: 'Customer not found',
  })
  async listInteractions(
    @Param('customerId') customerId: string,
    @Query() query: ListCustomerInteractionsDto,
  ) {
    return await this.interactionService.listInteractions(customerId, query);
  }

  @Get('stats')
  @HttpCode(HttpStatus.OK)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Customers}`,
      `${ActionEnum.read}:${SubjectEnum.Customers}`,
    ],
  })
  @ApiOperation({
    summary: 'Get interaction statistics',
    description: 'Retrieve interaction statistics for a customer',
  })
  @ApiOkResponse({
    description: 'Interaction statistics retrieved successfully',
  })
  async getStats(@Param('customerId') customerId: string) {
    return await this.interactionService.getInteractionStats(customerId);
  }

  @Get(':interactionId')
  @HttpCode(HttpStatus.OK)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Customers}`,
      `${ActionEnum.read}:${SubjectEnum.Customers}`,
    ],
  })
  @ApiOperation({
    summary: 'Get single interaction',
    description: 'Retrieve details of a specific interaction',
  })
  @ApiOkResponse({
    description: 'Interaction retrieved successfully',
  })
  @ApiNotFoundResponse({
    description: 'Interaction not found',
  })
  async getInteraction(
    @Param('customerId') customerId: string,
    @Param('interactionId') interactionId: string,
  ) {
    return await this.interactionService.getInteractionById(
      interactionId,
      customerId,
    );
  }

  @Patch(':interactionId')
  @HttpCode(HttpStatus.OK)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Customers}`,
      `${ActionEnum.write}:${SubjectEnum.Customers}`,
    ],
  })
  @ApiOperation({
    summary: 'Update customer interaction',
    description: 'Update details of an existing customer interaction',
  })
  @ApiOkResponse({
    description: 'Interaction updated successfully',
  })
  @ApiBadRequestResponse({
    description: 'Invalid data provided',
  })
  @ApiNotFoundResponse({
    description: 'Interaction not found',
  })
  async updateInteraction(
    @Param('customerId') customerId: string,
    @Param('interactionId') interactionId: string,
    @Body() dto: UpdateCustomerInteractionDto,
    @GetSessionUser('id') userId: string,
  ) {
    return await this.interactionService.updateInteraction(
      interactionId,
      customerId,
      userId,
      dto,
    );
  }

  @Delete(':interactionId')
  @HttpCode(HttpStatus.OK)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Customers}`,
      `${ActionEnum.delete}:${SubjectEnum.Customers}`,
    ],
  })
  @ApiOperation({
    summary: 'Delete customer interaction',
    description: 'Delete (soft delete) a customer interaction record',
  })
  @ApiOkResponse({
    description: 'Interaction deleted successfully',
  })
  @ApiNotFoundResponse({
    description: 'Interaction not found',
  })
  async deleteInteraction(
    @Param('customerId') customerId: string,
    @Param('interactionId') interactionId: string,
  ) {
    return await this.interactionService.deleteInteraction(
      interactionId,
      customerId,
    );
  }
}
