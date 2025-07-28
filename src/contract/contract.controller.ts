import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  Query,
  UploadedFile,
  ParseFilePipeBuilder,
  UseInterceptors,
} from '@nestjs/common';
import { ContractService } from './contract.service';
import { SkipThrottle } from '@nestjs/throttler';
import { RolesAndPermissions } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { RolesAndPermissionsGuard } from '../auth/guards/roles.guard';
import { ActionEnum, SubjectEnum } from '@prisma/client';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConsumes,
  ApiExtraModels,
  ApiHeader,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { PaginationQueryDto } from '../utils/dto/pagination.dto';
import { FileInterceptor } from '@nestjs/platform-express';

@SkipThrottle()
@ApiTags('Contract')
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
@Controller('contract')
export class ContractController {
  constructor(private readonly contractService: ContractService) {}

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Contracts}`,
      `${ActionEnum.read}:${SubjectEnum.Contracts}`,
    ],
  })
  @ApiBadRequestResponse({})
  @ApiExtraModels(PaginationQueryDto)
  @HttpCode(HttpStatus.OK)
  @Get('')
  async getContracts(@Query() query: PaginationQueryDto) {
    return await this.contractService.getAllContracts(query);
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Contracts}`,
      `${ActionEnum.read}:${SubjectEnum.Contracts}`,
    ],
  })
  @ApiBadRequestResponse({})
  @HttpCode(HttpStatus.OK)
  @ApiParam({
    name: 'id',
    description: 'Contract id to fetch details.',
  })
  @Get(':id')
  async getContract(@Param('id') id: string) {
    return await this.contractService.getContract(id);
  }

  @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
  @RolesAndPermissions({
    permissions: [
      `${ActionEnum.manage}:${SubjectEnum.Contracts}`,
      `${ActionEnum.write}:${SubjectEnum.Contracts}`,
    ],
  })
  @ApiBadRequestResponse({})
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('signature'))
  @HttpCode(HttpStatus.CREATED)
  @ApiParam({
    name: 'id',
    description: 'Contract id to upload signage for.',
  })
  @Post(':id/upload-signage')
  async uploadSignage(
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addFileTypeValidator({ fileType: /(jpeg|jpg|png|svg)$/i })
        .build({ errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY }),
    )
    file: Express.Multer.File,
  ) {
    return await this.contractService.uploadSignage(id, file);
  }
}
