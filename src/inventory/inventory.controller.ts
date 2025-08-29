import { SkipThrottle } from '@nestjs/throttler';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseFilePipeBuilder,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { RolesAndPermissions } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesAndPermissionsGuard } from '../auth/guards/roles.guard';
import { ActionEnum, AgentCategory, SubjectEnum } from '@prisma/client';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiExtraModels,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { CreateInventoryDto } from './dto/create-inventory.dto';
import { FileInterceptor } from '@nestjs/platform-express';
import { FetchInventoryQueryDto } from './dto/fetch-inventory.dto';
import { CreateCategoryArrayDto } from './dto/create-category.dto';
import { CreateInventoryBatchDto } from './dto/create-inventory-batch.dto';
import { GetSessionUser } from '../auth/decorators/getUser';
import { DeviceService } from 'src/device/device.service';

@SkipThrottle()
@ApiTags('Inventory')
@Controller('inventory')
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
export class InventoryController {
  constructor(
    private readonly inventoryService: InventoryService,
    private readonly deviceService: DeviceService,
  ) {}

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Inventory}`,
      `${ActionEnum.write}:${SubjectEnum.Inventory}`,
    ],
  })
  @ApiBody({
    type: CreateInventoryDto,
    description: 'Json structure for request payload',
  })
  @ApiBadRequestResponse({})
  @ApiConsumes('multipart/form-data')
  @HttpCode(HttpStatus.CREATED)
  @Post('create')
  @UseInterceptors(FileInterceptor('inventoryImage'))
  async create(
    @Body() createInventoryDto: CreateInventoryDto,
    @GetSessionUser('id') requestUserId: string,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: /(jpeg|jpg|png|svg)$/i })
        .build({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY }),
    )
    file: Express.Multer.File,
  ) {
    return await this.inventoryService.createInventory(
      requestUserId,
      createInventoryDto,
      file,
    );
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Inventory}`,
      `${ActionEnum.write}:${SubjectEnum.Inventory}`,
    ],
  })
  @ApiBody({
    type: CreateInventoryBatchDto,
    description: 'Json structure for request payload',
  })
  @ApiBadRequestResponse({})
  @HttpCode(HttpStatus.CREATED)
  @Post('batch/create')
  async createInventoryBatch(
    @GetSessionUser('id') requestUserId: string,
    @Body() createInventoryDto: CreateInventoryBatchDto,
  ) {
    return await this.inventoryService.createInventoryBatch(
      requestUserId,
      createInventoryDto,
    );
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Inventory}`,
      `${ActionEnum.read}:${SubjectEnum.Inventory}`,
    ],
  })
  @Get('')
  @ApiOkResponse({
    description: 'Fetch all inventory with pagination',
    isArray: true,
  })
  @ApiBadRequestResponse({})
  @ApiExtraModels(FetchInventoryQueryDto)
  @HttpCode(HttpStatus.OK)
  async getInventories(@Query() query: FetchInventoryQueryDto) {
    return await this.inventoryService.getInventories(query);
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Inventory}`,
      `${ActionEnum.read}:${SubjectEnum.Inventory}`,
    ],
  })
  @Get('stats')
  @ApiOkResponse({
    description: 'Fetch Inventory Statistics',
    isArray: true,
  })
  @ApiBadRequestResponse({})
  @HttpCode(HttpStatus.OK)
  async getInventoryStats() {
    return await this.inventoryService.getInventoryStats();
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Inventory}`,
      `${ActionEnum.read}:${SubjectEnum.Inventory}`,
    ],
  })
  @ApiParam({
    name: 'id',
    description: 'Inventory id to fetch details',
  })
  @Get(':id')
  @ApiOperation({
    summary: 'Fetch Inventory details',
    description:
      'This endpoint allows a permitted user fetch an inventory batch details.',
  })
  @ApiBearerAuth('access_token')
  @ApiOkResponse({})
  @HttpCode(HttpStatus.OK)
  async getInventoryDetails(@Param('id') inventoryId: string) {
    return await this.inventoryService.getInventory(inventoryId);
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Inventory}`,
      `${ActionEnum.read}:${SubjectEnum.Inventory}`,
    ],
  })
  @ApiParam({
    name: 'id',
    description: 'Inventory Batch Id to fetch details',
  })
  @Get('/batch/:id')
  @ApiOperation({
    summary: 'Fetch Inventory details',
    description:
      'This endpoint allows a permitted user fetch an inventory batch details.',
  })
  @ApiBearerAuth('access_token')
  @ApiOkResponse({})
  @HttpCode(HttpStatus.OK)
  async getInventoryBatchDetails(@Param('id') inventoryId: string) {
    return await this.inventoryService.getInventoryBatch(inventoryId);
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Inventory}`,
      `${ActionEnum.write}:${SubjectEnum.Inventory}`,
    ],
  })
  @ApiBearerAuth('access_token')
  @ApiBody({
    type: CreateCategoryArrayDto,
    description: 'Category creation payload',
  })
  @HttpCode(HttpStatus.CREATED)
  @Post('category/create')
  @ApiOperation({
    summary: 'Create Inventory Category',
    description:
      'This endpoint allows a permitted user Create an Inventory Category',
  })
  @ApiOkResponse({})
  async createInventoryCategory(
    @Body() createCategoryArrayDto: CreateCategoryArrayDto,
  ) {
    return await this.inventoryService.createInventoryCategory(
      createCategoryArrayDto.categories,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('categories/all')
  @ApiOkResponse({
    description: 'Fetch all inventory categories',
    isArray: true,
  })
  @ApiBadRequestResponse({})
  @HttpCode(HttpStatus.OK)
  async getInventoryCategories(@GetSessionUser('id') requestUserId: string) {
    await this.deviceService.validateUpdatePermissions(
      requestUserId,
      undefined,
      [
        { action: ActionEnum.manage, subject: SubjectEnum.Sales },
        { action: ActionEnum.write, subject: SubjectEnum.Sales },
        { action: ActionEnum.manage, subject: SubjectEnum.Inventory },
        { action: ActionEnum.read, subject: SubjectEnum.Inventory },
      ],
      true,
      AgentCategory.SALES,
    );

    return await this.inventoryService.getInventoryCategories();
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Inventory}`,
      `${ActionEnum.read}:${SubjectEnum.Inventory}`,
    ],
  })
  @ApiParam({
    name: 'id',
    description: 'inventory id to fetch tabs',
  })
  @ApiOkResponse({
    description: 'Fetch Inventory Tabs',
    isArray: true,
  })
  @ApiBadRequestResponse({})
  @HttpCode(HttpStatus.OK)
  @Get(':id/tabs')
  async getInventoryTabs(@Param('id') inventoryId: string) {
    return this.inventoryService.getInventoryTabs(inventoryId);
  }
}
