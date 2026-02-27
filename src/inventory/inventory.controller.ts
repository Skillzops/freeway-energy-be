import { SkipThrottle } from '@nestjs/throttler';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseFilePipeBuilder,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { InventoryService } from './inventory.service';
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
import { AuthService } from 'src/auth/auth.service';
import { UpdateInventoryDto } from './dto/update-inventory.dto';

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
    private readonly authService: AuthService,
  ) {}

  @UseGuards(JwtAuthGuard)
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
    await this.authService.validateUserPermissions({
      userId: requestUserId,
      extraPermissions: [
        { action: ActionEnum.manage, subject: SubjectEnum.Inventory },
        { action: ActionEnum.write, subject: SubjectEnum.Inventory },
      ],
      allowAgents: false,
      allowedWarehouseManagers: 'main',
    });

    return await this.inventoryService.createInventory(
      requestUserId,
      createInventoryDto,
      file,
    );
  }

  @UseGuards(JwtAuthGuard)
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
    await this.authService.validateUserPermissions({
      userId: requestUserId,
      extraPermissions: [
        { action: ActionEnum.manage, subject: SubjectEnum.Inventory },
        { action: ActionEnum.write, subject: SubjectEnum.Inventory },
      ],
      allowAgents: false,
      allowedWarehouseManagers: 'main',
    });
    return await this.inventoryService.createInventoryBatch(
      requestUserId,
      createInventoryDto,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Get('')
  @ApiOkResponse({
    description: 'Fetch all inventory with pagination',
    isArray: true,
  })
  @ApiBadRequestResponse({})
  @ApiExtraModels(FetchInventoryQueryDto)
  @HttpCode(HttpStatus.OK)
  async getInventories(
    @Query() query: FetchInventoryQueryDto,
    @GetSessionUser('id') requestUserId: string,
  ) {
    await this.authService.validateUserPermissions({
      userId: requestUserId,
      extraPermissions: [
        { action: ActionEnum.manage, subject: SubjectEnum.Inventory },
        { action: ActionEnum.read, subject: SubjectEnum.Inventory },
      ],
      allowAgents: false,
      allowedWarehouseManagers: 'all',
    });
    return await this.inventoryService.getInventories(query, requestUserId);
  }

  @UseGuards(JwtAuthGuard)
  @Get('stats')
  @ApiOkResponse({
    description: 'Fetch Inventory Statistics',
    isArray: true,
  })
  @ApiBadRequestResponse({})
  @HttpCode(HttpStatus.OK)
  async getInventoryStats(@GetSessionUser('id') requestUserId: string) {
    await this.authService.validateUserPermissions({
      userId: requestUserId,
      extraPermissions: [
        { action: ActionEnum.manage, subject: SubjectEnum.Inventory },
        { action: ActionEnum.read, subject: SubjectEnum.Inventory },
      ],
      allowAgents: false,
      allowedWarehouseManagers: 'all',
    });
    return await this.inventoryService.getInventoryStats(requestUserId);
  }

  @UseGuards(JwtAuthGuard)
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
  async getInventoryDetails(
    @Param('id') inventoryId: string,
    @GetSessionUser('id') requestUserId: string,
  ) {
    await this.authService.validateUserPermissions({
      userId: requestUserId,
      extraPermissions: [
        { action: ActionEnum.manage, subject: SubjectEnum.Inventory },
        { action: ActionEnum.read, subject: SubjectEnum.Inventory },
      ],
      allowAgents: false,
      allowedWarehouseManagers: 'all',
    });
    return await this.inventoryService.getInventory(inventoryId, requestUserId);
  }

  @UseGuards(JwtAuthGuard)
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
  async getInventoryBatchDetails(
    @Param('id') inventoryId: string,
    @GetSessionUser('id') requestUserId: string,
  ) {
    await this.authService.validateUserPermissions({
      userId: requestUserId,
      extraPermissions: [
        { action: ActionEnum.manage, subject: SubjectEnum.Inventory },
        { action: ActionEnum.read, subject: SubjectEnum.Inventory },
      ],
      allowAgents: false,
      allowedWarehouseManagers: 'all',
    });
    return await this.inventoryService.getInventoryBatch(
      inventoryId,
      requestUserId,
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/toggle-hide')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Toggle inventory visibility' })
  async toggleInventoryVisibility(
    @Param('id') inventoryId: string,
    @GetSessionUser('id') requestUserId: string,
  ) {
    await this.authService.validateUserPermissions({
      userId: requestUserId,
      extraPermissions: [
        { action: ActionEnum.manage, subject: SubjectEnum.Inventory },
        { action: ActionEnum.write, subject: SubjectEnum.Inventory },
      ],
      allowAgents: false,
      allowedWarehouseManagers: 'main',
    });
    return this.inventoryService.toggleHideInventory(inventoryId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Edit inventory details' })
  async updateInventory(
    @Param('id') inventoryId: string,
    @Body() dto: UpdateInventoryDto,
    @GetSessionUser('id') requestUserId: string,
  ) {
    await this.authService.validateUserPermissions({
      userId: requestUserId,
      extraPermissions: [
        { action: ActionEnum.manage, subject: SubjectEnum.Inventory },
        { action: ActionEnum.write, subject: SubjectEnum.Inventory },
      ],
      allowAgents: false,
      allowedWarehouseManagers: 'main',
    });
    return this.inventoryService.updateInventory(inventoryId, dto);
  }

  @UseGuards(JwtAuthGuard)
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
    @GetSessionUser('id') requestUserId: string,
  ) {
    await this.authService.validateUserPermissions({
      userId: requestUserId,
      extraPermissions: [
        { action: ActionEnum.manage, subject: SubjectEnum.Inventory },
        { action: ActionEnum.write, subject: SubjectEnum.Inventory },
      ],
      allowAgents: false,
      allowedWarehouseManagers: 'main',
    });

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
    await this.authService.validateUserPermissions({
      userId: requestUserId,
      extraPermissions: [
        { action: ActionEnum.manage, subject: SubjectEnum.Sales },
        { action: ActionEnum.write, subject: SubjectEnum.Sales },
        { action: ActionEnum.manage, subject: SubjectEnum.Inventory },
        { action: ActionEnum.read, subject: SubjectEnum.Inventory },
      ],
      agentCategory: AgentCategory.SALES,
      allowedWarehouseManagers: 'main',
    });

    return await this.inventoryService.getInventoryCategories();
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
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
  async getInventoryTabs(
    @Param('id') inventoryId: string,
    @GetSessionUser('id') requestUserId: string,
  ) {
    await this.authService.validateUserPermissions({
      userId: requestUserId,
      extraPermissions: [
        { action: ActionEnum.manage, subject: SubjectEnum.Inventory },
        { action: ActionEnum.read, subject: SubjectEnum.Inventory },
      ],
      allowAgents: false,
      allowedWarehouseManagers: 'all',
    });
    return this.inventoryService.getInventoryTabs(inventoryId);
  }
}
