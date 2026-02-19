import {
    Controller,
    Get,
    Patch,
    Delete,
    Param,
    Body,
    HttpCode,
    HttpStatus,
    UseGuards,
  } from '@nestjs/common';
  import { TokenGenerationFailureService } from '../services/token-generation-failure.service';
  import { JwtAuthGuard } from 'src/auth/guards/jwt.guard';
  import { RolesAndPermissionsGuard } from 'src/auth/guards/roles.guard';
  import { RolesAndPermissions } from 'src/auth/decorators/roles.decorator';
  import { ActionEnum, SubjectEnum } from '@prisma/client';
  import { ApiTags, ApiOperation } from '@nestjs/swagger';
  import { GetSessionUser } from 'src/auth/decorators/getUser';
  
  @ApiTags('Token Generation Failures')
  @Controller('token-failures')
  export class TokenGenerationFailureController {
    constructor(
      private readonly tokenFailureService: TokenGenerationFailureService,
    ) {}
  
    @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
    @RolesAndPermissions({
      permissions: [`${ActionEnum.read}:${SubjectEnum.Sales}`],
    })
    @Get()
    @ApiOperation({ summary: 'Get all unresolved token generation failures' })
    async getUnresolved() {
      return this.tokenFailureService.getUnresolvedFailures();
    }
  
    @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
    @RolesAndPermissions({
      permissions: [`${ActionEnum.read}:${SubjectEnum.Sales}`],
    })
    @Get('summary')
    @ApiOperation({ summary: 'Get failure summary statistics' })
    async getSummary() {
      return this.tokenFailureService.getFailureSummary();
    }
  
    @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
    @RolesAndPermissions({
      permissions: [`${ActionEnum.read}:${SubjectEnum.Sales}`],
    })
    @Get('sale/:saleId')
    @ApiOperation({ summary: 'Get failures for a specific sale' })
    async getFailuresBySale(@Param('saleId') saleId: string) {
      return this.tokenFailureService.getFailuresBySale(saleId);
    }
  
    @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
    @RolesAndPermissions({
      permissions: [`${ActionEnum.manage}:${SubjectEnum.Sales}`],
    })
    @Patch(':failureId/resolve')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Mark failure as resolved' })
    async resolve(
      @Param('failureId') failureId: string,
      @Body('notes') notes?: string,
      @GetSessionUser('id') userId?: string,
    ) {
      return this.tokenFailureService.resolveFailure(failureId, userId, notes);
    }
  
    // @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
    // @RolesAndPermissions({
    //   permissions: [`${ActionEnum.manage}:${SubjectEnum.Sales}`],
    // })
    // @Post(':failureId/retry')
    // @HttpCode(HttpStatus.OK)
    // @ApiOperation({ summary: 'Retry token generation (manual override)' })
    // async retry(@Param('failureId') failureId: string) {
    //   return this.tokenFailureService.retryTokenGeneration(failureId, async () => {
    //     return { message: 'Retry initiated - process manually in device service' };
    //   });
    // }
  
    @UseGuards(JwtAuthGuard, RolesAndPermissionsGuard)
    @RolesAndPermissions({
      permissions: [`${ActionEnum.manage}:${SubjectEnum.Sales}`],
    })
    @Delete(':failureId')
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Delete failure record' })
    async delete(@Param('failureId') failureId: string) {
      return this.tokenFailureService.deleteFailure(failureId);
    }
  }