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
  ApiBearerAuth,
} from '@nestjs/swagger';
import { OdysseyPaymentResponseDto } from './dto/odyssey.dto';
import { OdysseyService } from './odyssey.service';

export const ODYSSEY_PAYMENTS_PATH = 'api/payments/odyssey';

@ApiTags('Odyssey Integration')
@Controller(ODYSSEY_PAYMENTS_PATH)
export class OdysseyController {
  private readonly logger = new Logger(OdysseyController.name);

  constructor(private readonly odysseyPaymentService: OdysseyService) {}

  @Get()
  @ApiOperation({
    summary: 'Odyssey Standard Payment API',
    description: `
      Returns payment data for a specified time period in Odyssey-compliant format.
      This endpoint provides payment information for Solar Home Systems (SHS) devices
      to enable verification by financial institutions.
      
      Authentication: Bearer token required in Authorization header.
      Format: All timestamps in UTC using ISO 8601 format.
    `,
  })
  @ApiBearerAuth('odyssey_api_key')
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
    @Headers() headers: Record<string, string | undefined>,
    @Query('FROM') fromDate: string,
    @Query('TO') toDate: string,
    @Query('COUNTRY') country?: string,
  ): Promise<OdysseyPaymentResponseDto> {
    try {
      const authorization = headers.authorization;

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

      if (from >= to) {
        throw new BadRequestException('FROM date must be before TO date');
      }

      // Log the request
      console.log(
        `Odyssey payment request: ${from.toISOString()} to ${to.toISOString()}` +
          (country ? ` [Country: ${country}]` : ''),
      );

      // Fetch payments
      const result = await this.odysseyPaymentService.getPayments({
        from,
        to,
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
