import {
  Controller,
  Get,
  Query,
  Headers,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiHeader,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { OdysseyPaymentResponseDto } from './dto/odyssey.dto';
import { OdysseyService } from './odyssey.service';

@ApiTags('Odyssey Integration')
@Controller('api/payments')
export class OdysseyController {
  private readonly logger = new Logger(OdysseyController.name);

  constructor(private readonly odysseyPaymentService: OdysseyService) {}

  @Get('odyssey')
  @ApiOperation({
    summary: 'Odyssey Standard Payment API',
    description: `
      Returns payment data for a specified time period in Odyssey-compliant format.
      This endpoint provides payment information for Solar Home Systems (SHS) devices
      to enable verification by financial institutions.
      
      Authentication: Bearer token required in Authorization header.
      Date Range: Maximum 24 hours of data per request.
      Format: All timestamps in UTC using ISO 8601 format.
    `,
  })
  @ApiBearerAuth()
  @ApiHeader({
    name: 'Authorization',
    description: 'Bearer token for authentication',
    required: true,
    schema: {
      type: 'string',
      example:
        'Bearer e25080c723345c3bbd0095f21a4f9efa808051a99c33a085415258535',
    },
  })
  @ApiQuery({
    name: 'FROM',
    description: 'Start of date range (ISO 8601 format in UTC)',
    required: true,
    type: 'string',
    example: '2024-01-01T00:00:00.000Z',
  })
  @ApiQuery({
    name: 'TO',
    description: 'End of date range (ISO 8601 format in UTC)',
    required: true,
    type: 'string',
    example: '2024-01-02T00:00:00.000Z',
  })
  @ApiQuery({
    name: 'FINANCING_ID',
    description: 'Optional financing program ID filter',
    required: false,
    type: 'string',
    example: 'REA_NEP_OBF',
  })
  @ApiQuery({
    name: 'SITE_ID',
    description: 'Optional site ID filter',
    required: false,
    type: 'string',
  })
  @ApiQuery({
    name: 'COUNTRY',
    description: 'Optional country filter',
    required: false,
    type: 'string',
    example: 'NG',
  })
  @ApiResponse({
    status: 200,
    description: 'Payment data retrieved successfully',
    type: OdysseyPaymentResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid or missing bearer token',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 401 },
        message: { type: 'string', example: 'Unauthorized' },
        error: { type: 'string', example: 'Unauthorized' },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Invalid date format or date range too large',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 400 },
        message: { type: 'string', example: 'Invalid date format or range' },
        error: { type: 'string', example: 'Bad Request' },
      },
    },
  })
  async getPayments(
    @Headers('authorization') authorization: string,
    @Query('FROM') fromDate: string,
    @Query('TO') toDate: string,
    @Query('FINANCING_ID') financingId?: string,
    @Query('SITE_ID') siteId?: string,
    @Query('COUNTRY') country?: string,
  ): Promise<OdysseyPaymentResponseDto> {
    try {
      // Validate authorization header
      if (!authorization || !authorization.startsWith('Bearer ')) {
        throw new UnauthorizedException('Invalid authorization header format');
      }

      const token = authorization.substring(7); // Remove 'Bearer ' prefix
      await this.validateToken(token);

      // Validate required parameters
      if (!fromDate || !toDate) {
        throw new BadRequestException('FROM and TO parameters are required');
      }

      // Parse and validate dates
      const from = this.parseAndValidateDate(fromDate, 'FROM');
      const to = this.parseAndValidateDate(toDate, 'TO');

      // Validate date range (max 24 hours)
      // const diffHours = (to.getTime() - from.getTime()) / (1000 * 60 * 60);
      // if (diffHours > 24) {
      //   throw new BadRequestException(
      //     'Date range cannot exceed 24 hours. Please use a smaller time window.',
      //   );
      // }

      if (from >= to) {
        throw new BadRequestException('FROM date must be before TO date');
      }

      // Log the request
      console.log(
        `Odyssey payment request: ${from.toISOString()} to ${to.toISOString()}` +
          (financingId ? ` [Financing: ${financingId}]` : '') +
          (siteId ? ` [Site: ${siteId}]` : '') +
          (country ? ` [Country: ${country}]` : ''),
      );

      // Fetch payments
      const result = await this.odysseyPaymentService.getPayments({
        from,
        to,
        financingId,
        siteId,
        country,
      });

      console.log(
        `Odyssey payment response: ${result.payments.length} payments found`,
      );

      return result;
    } catch (error) {
      console.error('Error processing Odyssey payment request', error);

      if (
        error instanceof UnauthorizedException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }

      // Return empty result with error for unexpected errors
      return {
        payments: [],
        errors: `Internal server error: ${error.message}`,
      };
    }
  }

  // @Post('tokens/generate')
  // @ApiOperation({
  //   summary: 'Generate new Odyssey API token',
  //   description:
  //     'Generate a new API token for Odyssey integration. Requires admin privileges.',
  // })
  // @ApiBearerAuth()
  // @ApiResponse({
  //   status: 201,
  //   description: 'Token generated successfully',
  //   type: TokenResponseDto,
  // })
  // @ApiResponse({
  //   status: 403,
  //   description: 'Forbidden - Insufficient privileges',
  // })
  // async generateToken(
  //   @Body() generateTokenDto: GenerateTokenDto,
  // ): Promise<TokenResponseDto> {
  //   try {
  //     const token = await this.odysseyPaymentService.generateApiToken(
  //       generateTokenDto.clientName,
  //       generateTokenDto.expirationDays || 365,
  //     );

  //     const expiresAt = new Date();
  //     expiresAt.setDate(
  //       expiresAt.getDate() + (generateTokenDto.expirationDays || 365),
  //     );

  //     console.log(
  //       `Generated new Odyssey API token for: ${generateTokenDto.clientName}`,
  //     );

  //     return {
  //       token,
  //       clientName: generateTokenDto.clientName,
  //       expiresAt,
  //       createdAt: new Date(),
  //     };
  //   } catch (error) {
  //     console.error('Error generating API token', error);
  //     throw error;
  //   }
  // }

  // @Get('tokens')
  // // @Roles('admin', 'super_admin')
  // @ApiOperation({
  //   summary: 'List all active Odyssey API tokens',
  //   description:
  //     'Retrieve list of all active API tokens with client information.',
  // })
  // @ApiBearerAuth()
  // @ApiResponse({
  //   status: 200,
  //   description: 'List of active tokens retrieved successfully',
  //   schema: {
  //     type: 'array',
  //     items: {
  //       type: 'object',
  //       properties: {
  //         id: { type: 'string' },
  //         clientName: { type: 'string' },
  //         createdAt: { type: 'string', format: 'date-time' },
  //         expiresAt: { type: 'string', format: 'date-time' },
  //         lastUsedAt: { type: 'string', format: 'date-time', nullable: true },
  //       },
  //     },
  //   },
  // })
  // async listTokens() {
  //   try {
  //     const tokens = await this.odysseyPaymentService.listActiveTokens();
  //     console.log(`Retrieved ${tokens.length} active Odyssey API tokens`);
  //     return tokens;
  //   } catch (error) {
  //     console.error('Error listing API tokens', error);
  //     throw error;
  //   }
  // }

  // @Delete('tokens/:token')
  // // @Roles('admin', 'super_admin')
  // @ApiOperation({
  //   summary: 'Revoke Odyssey API token',
  //   description: 'Revoke/deactivate an existing API token.',
  // })
  // @ApiBearerAuth()
  // @ApiParam({
  //   name: 'token',
  //   description: 'The API token to revoke',
  //   example: 'e25080c723345c3bbd0095f21a4f9efa808051a99c33a085415258535',
  // })
  // @ApiResponse({
  //   status: 200,
  //   description: 'Token revoked successfully',
  //   schema: {
  //     type: 'object',
  //     properties: {
  //       success: { type: 'boolean' },
  //       message: { type: 'string' },
  //     },
  //   },
  // })
  // @ApiResponse({
  //   status: 404,
  //   description: 'Token not found',
  // })
  // async revokeToken(@Param('token') token: string) {
  //   try {
  //     const success = await this.odysseyPaymentService.revokeApiToken(token);

  //     if (success) {
  //       console.log(
  //         `Revoked Odyssey API token: ${token.substring(0, 8)}...`,
  //       );
  //       return {
  //         success: true,
  //         message: 'Token revoked successfully',
  //       };
  //     } else {
  //       return {
  //         success: false,
  //         message: 'Token not found or already revoked',
  //       };
  //     }
  //   } catch (error) {
  //     console.error('Error revoking API token', error);
  //     throw error;
  //   }
  // }

  private async validateToken(token: string): Promise<void> {
    const isValid = await this.odysseyPaymentService.validateApiToken(token);
    if (!isValid) {
      throw new UnauthorizedException('Invalid API token');
    }
  }

  private parseAndValidateDate(dateString: string, paramName: string): Date {
    try {
      const date = new Date(dateString);

      if (isNaN(date.getTime())) {
        throw new BadRequestException(
          `Invalid ${paramName} date format. Use ISO 8601 format: YYYY-MM-DDTHH:mm:ss.SSSZ`,
        );
      }

      // Validate ISO 8601 format more strictly
      const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
      if (!iso8601Regex.test(dateString)) {
        throw new BadRequestException(
          `${paramName} date must be in ISO 8601 UTC format: YYYY-MM-DDTHH:mm:ss.SSSZ`,
        );
      }

      return date;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(
        `Invalid ${paramName} date format. Use ISO 8601 format: YYYY-MM-DDTHH:mm:ss.SSSZ`,
      );
    }
  }
}
