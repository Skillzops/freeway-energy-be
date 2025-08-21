import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  ParseFilePipeBuilder,
  UploadedFile,
  UseInterceptors,
  Get,
  Query,
  Param,
} from '@nestjs/common';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiExtraModels,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { RolesAndPermissions } from '../auth/decorators/roles.decorator';
import { ActionEnum, Product, SubjectEnum } from '@prisma/client';
import { RolesAndPermissionsGuard } from '../auth/guards/roles.guard';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import { GetProductsDto } from './dto/get-products.dto';
import { CreateProductCategoryDto } from './dto/create-category.dto';
import { GetSessionUser } from '../auth/decorators/getUser';

@ApiTags('Products')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [`${ActionEnum.manage}:${SubjectEnum.Products}`],
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
  @ApiBody({
    type: CreateProductDto,
    description: 'Json structure for request payload',
  })
  @ApiOperation({
    summary: 'Create product',
    description: 'Create product',
  })
  @ApiBadRequestResponse({})
  @ApiConsumes('multipart/form-data')
  @HttpCode(HttpStatus.CREATED)
  @Post()
  @UseInterceptors(FileInterceptor('productImage'))
  async create(
    @Body() CreateProductDto: CreateProductDto,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: /(jpeg|jpg|png|svg)$/i })
        .build({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY }),
    )
    file: Express.Multer.File,
    @GetSessionUser('id') id: string,
  ) {
    return await this.productsService.create(CreateProductDto, file, id);
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Products}`,
      `${ActionEnum.read}:${SubjectEnum.Products}`,
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
  @Get()
  @ApiOkResponse({
    description: 'Fetch all products with pagination',
    isArray: true,
  })
  @ApiOperation({
    summary: 'Fetch all products with pagination',
    description: 'Fetch all products with pagination',
  })
  @ApiBadRequestResponse({})
  @ApiExtraModels(GetProductsDto)
  @HttpCode(HttpStatus.OK)
  async getAllProducts(@Query() getProductsDto: GetProductsDto) {
    return this.productsService.getAllProducts(getProductsDto);
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Products}`,
      `${ActionEnum.read}:${SubjectEnum.Products}`,
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
    description: 'ID of the product to fetch',
  })
  @ApiResponse({
    status: 200,
    description: 'The details of the product.',
  })
  @ApiResponse({
    status: 404,
    description: 'Product not found.',
  })
  @Get(':id')
  @ApiOperation({
    summary: 'Fetch product details',
    description:
      'This endpoint allows a permitted user fetch a product details.',
  })
  async getProduct(@Param('id') id: string): Promise<Product> {
    const product = await this.productsService.getProduct(id);

    return product;
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [`${ActionEnum.manage}:${SubjectEnum.Products}`],
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
  @Post('create-category')
  @ApiOperation({
    summary: 'Create product category',
    description:
      'This endpoint allows a permitted user to create a product category.',
  })
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedResponse({ description: 'Product category created successfully' })
  @ApiBadRequestResponse({
    description: 'Invalid product category creation data',
  })
  async createCategory(@Body() createCategoryDto: CreateProductCategoryDto) {
    return this.productsService.createProductCategory(createCategoryDto);
  }

  @UseGuards(JwtAuthGuard)
  // @RolesAndPermissions({
  //   permissions: [
  //     `${ActionEnum.manage}:${SubjectEnum.Products}`,
  //     `${ActionEnum.read}:${SubjectEnum.Products}`,
  //   ],
  // })
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
  @Get('/categories/all')
  @ApiOperation({
    summary: 'Fetch all product categories',
    description:
      'This endpoint allows an authenticated user fetch  all product categories.',
  })
  async getAllCategories() {
    return this.productsService.getAllCategories();
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [`${ActionEnum.manage}:${SubjectEnum.Products}`],
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
    description: 'Product id to fetch tabs',
  })
  @ApiOkResponse({
    description: 'Fetch Product Tabs',
    isArray: true,
  })
  @ApiOperation({
    summary: 'Fetch Product Tabs for a particular product',
    description: 'Fetch Product Tabs for a particular product',
  })
  @ApiBadRequestResponse({})
  @HttpCode(HttpStatus.OK)
  @Get(':id/tabs')
  async getInventoryTabs(@Param('id') productId: string) {
    return this.productsService.getProductTabs(productId);
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [`${ActionEnum.manage}:${SubjectEnum.Products}`],
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
    description: 'Product id to fetch product inventory',
  })
  @ApiOkResponse({
    description: 'Fetch Product Inventory',
    isArray: true,
  })
  @ApiOperation({
    summary: 'Fetch product inventory for a particular product',
    description: 'Fetch product inventory for a particular product',
  })
  @ApiBadRequestResponse({})
  @HttpCode(HttpStatus.OK)
  @Get(':id/inventory')
  async getProductInventory(@Param('id') productId: string) {
    return this.productsService.getProductInventory(productId);
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [`${ActionEnum.manage}:${SubjectEnum.Products}`],
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
  @ApiOkResponse({
    description: 'Fetch Product statistics',
  })
  @ApiOperation({
    summary: 'Fetch Product statistics',
    description: 'Fetch Product statistics',
  })
  @ApiBadRequestResponse({})
  @HttpCode(HttpStatus.OK)
  @Get('/statistics/view')
  async getProductStatistics() {
    return this.productsService.getProductStatistics();
  }
}
