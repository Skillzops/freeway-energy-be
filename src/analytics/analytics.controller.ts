import {
  Controller,
  Get,
  UseGuards,
  HttpCode,
  HttpStatus,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
  ApiExtraModels,
  ApiBadRequestResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { SkipThrottle } from '@nestjs/throttler';
import { AnalyticsService } from './analytics.service';
import { AdminDashboardFilterDto } from './dto/dashboard-filter.dto';
import { AuthService } from 'src/auth/auth.service';
import { GetSessionUser } from 'src/auth/decorators/getUser';

@SkipThrottle()
@ApiTags('Admin Analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly authService: AuthService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get('overview')
  @HttpCode(HttpStatus.OK)
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
  @ApiOperation({
    summary: 'Get comprehensive admin dashboard overview',
    description:
      'Retrieves comprehensive analytics and statistics for the admin dashboard including sales data, user distribution, agent performance, inventory status, and more.',
  })
  @ApiExtraModels(AdminDashboardFilterDto)
  @ApiBadRequestResponse({
    description: 'Bad request - Invalid filter parameters',
  })
  async getAdminDashboardOverview(
    @Query() filters: AdminDashboardFilterDto,
    @GetSessionUser('id') userId: string,
  ) {
    console.log({ userId });
    await this.authService.validateUserPermissions({ userId });
    return await this.analyticsService.getAdminDashboardOverview(filters);
  }
}
