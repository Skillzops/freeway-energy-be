import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';
import { FileParserService } from 'src/csv-upload/file-parser.service';
import { InstallationStatus } from '@prisma/client';
import { parseCoordinate } from 'src/utils/helpers.util';

export interface DeviceLocationUpdateRow {
  installationAddress?: string;
  lga?: string;
  state?: string;
  serialNumber: string;
  latitude?: string | number;
  longitude?: string | number;
}

export interface DeviceLocationUpdateSession {
  id: string;
  fileInfo: {
    name: string;
    size: number;
    type: string;
  };
  stats: {
    sessionId: string;
    totalRecords: number;
    processedRecords: number;
    updatedDevices: number;
    updatedCustomers: number;
    skippedDevices: number;
    errorRecords: number;
    progressPercentage: number;
    status: 'pending' | 'processing' | 'completed';
    startTime: Date;
    endTime?: Date;
    errors: Array<{
      row: number;
      serialNumber: string;
      message: string;
    }>;
  };
}

@Injectable()
export class DeviceLocationUpdateService {
  private readonly logger = new Logger(DeviceLocationUpdateService.name);
  private readonly sessions = new Map<string, DeviceLocationUpdateSession>();

  private readonly COLUMN_MAPPINGS = new Map([
    ['installation address', 'installationAddress'],
    ['installation_address', 'installationAddress'],
    ['address', 'installationAddress'],
    ['lga', 'lga'],
    ['state', 'state'],
    ['latitude', 'latitude'],
    ['lat', 'latitude'],
    ['longitude', 'longitude'],
    ['longtitude', 'longitude'],
    ['lng', 'longitude'],
    ['long', 'longitude'],
    ['serial number', 'serialNumber'],
    ['serial_number', 'serialNumber'],
    ['serial', 'serialNumber'],
  ]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fileParser: FileParserService,
  ) {}

  /**
   * Validate device location update file
   */
  async validateDeviceLocationFile(file: Express.Multer.File): Promise<{
    isValid: boolean;
    fileInfo: any;
    errors: string[];
    warnings: string[];
    columnMapping: Record<string, string>;
    detectedColumns: string[];
    sampleData: any[];
  }> {
    try {
      this.logger.log(`Validating device location file: ${file.originalname}`);

      const { data, headers } = await this.fileParser.parseSalesFile(file);

      if (!data || data.length === 0) {
        return {
          isValid: false,
          fileInfo: {
            name: file.originalname,
            size: file.size,
            type: file.mimetype,
          },
          errors: ['File contains no readable data'],
          warnings: [],
          columnMapping: {},
          detectedColumns: headers,
          sampleData: [],
        };
      }

      const columnMapping = this.mapColumns(headers);
      const validation = this.validateLocationColumns(columnMapping, headers);

      // Get sample data (first 3 rows)
      const sampleData = data
        .slice(0, 3)
        .map((row) => this.transformRowWithMapping(row, columnMapping));

      return {
        isValid: validation.errors.length === 0,
        fileInfo: {
          name: file.originalname,
          size: file.size,
          type: file.mimetype,
          totalRows: data.length,
        },
        errors: validation.errors,
        warnings: validation.warnings,
        columnMapping: Object.fromEntries(columnMapping),
        detectedColumns: headers,
        sampleData,
      };
    } catch (error) {
      this.logger.error('Error validating device location file', error);
      throw new BadRequestException(
        `Failed to validate file: ${error.message}`,
      );
    }
  }

  /**
   * Process device location update file
   */
  async processDeviceLocationFile(
    file: Express.Multer.File,
    skipValidation: boolean = false,
  ): Promise<{
    sessionId: string;
    success: boolean;
    message: string;
    stats: any;
  }> {
    const sessionId = uuidv4();
    this.logger.log(`Starting device location update session: ${sessionId}`);

    try {
      const { data, headers } = await this.fileParser.parseSalesFile(file);

      if (!data || data.length === 0) {
        throw new BadRequestException(
          'File contains no readable device location data',
        );
      }

      if (!skipValidation) {
        const validation = await this.validateDeviceLocationFile(file);
        if (!validation.isValid) {
          throw new BadRequestException(
            `File validation failed: ${validation.errors.join(', ')}`,
          );
        }
      }

      const columnMapping = this.mapColumns(headers);
      const transformedData = data.map((row) =>
        this.transformRowWithMapping(row, columnMapping),
      );

      // Create session
      const session = this.createSession(sessionId, file, transformedData);

      // Process all rows synchronously
      for (let i = 0; i < transformedData.length; i++) {
        const row = transformedData[i];
        await this.processDeviceLocationRow(sessionId, row, i);
      }

      // Mark session as completed
      session.stats.status = 'completed';
      session.stats.endTime = new Date();
      session.stats.progressPercentage = 100;

      this.logger.log(
        `Session ${sessionId} completed. Updated Devices: ${session.stats.updatedDevices}, Updated Customers: ${session.stats.updatedCustomers}, Skipped: ${session.stats.skippedDevices}, Errors: ${session.stats.errorRecords}`,
      );

      return {
        sessionId,
        success: true,
        message: `Device location update completed. ${session.stats.updatedDevices} devices updated, ${session.stats.updatedCustomers} customers updated, ${session.stats.skippedDevices} skipped, ${session.stats.errorRecords} errors.`,
        stats: session.stats,
      };
    } catch (error) {
      this.logger.error(
        `Error processing device location file in session ${sessionId}`,
        error,
      );
      throw new BadRequestException(`Failed to process file: ${error.message}`);
    }
  }

  /**
   * Process a single device location row (with customer location update)
   */
  private async processDeviceLocationRow(
    sessionId: string,
    row: DeviceLocationUpdateRow,
    rowIndex: number,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      session.stats.processedRecords++;

      // Validate serial number exists
      if (!row.serialNumber || row.serialNumber.toString().trim() === '') {
        session.stats.errorRecords++;
        session.stats.errors.push({
          row: rowIndex + 1,
          serialNumber: 'N/A',
          message: 'Serial number is required and cannot be empty',
        });
        return;
      }

      // Find device by serial number (case-insensitive)
      const device = await this.prisma.device.findFirst({
        where: {
          serialNumber: {
            equals: row.serialNumber.toString().trim(),
            mode: 'insensitive',
          },
        },
      });

      if (!device) {
        session.stats.skippedDevices++;
        session.stats.errors.push({
          row: rowIndex + 1,
          serialNumber: row.serialNumber.toString(),
          message: `Device with serial number "${row.serialNumber}" not found`,
        });
        return;
      }

      // Check if device has already been updated
      const hasExistingLocation = false
      // const hasExistingLocation =
      //   device.installationLatitude &&
      //   device.installationLatitude != '-' &&
      //   device.installationLongitude &&
      //   device.installationLongitude != '-';

      if (hasExistingLocation) {
        this.logger.debug(
          `Device ${device.serialNumber} already has location data, skipping`,
        );
        session.stats.skippedDevices++;
        // return;
      } else {
        // Prepare device update data
        const deviceUpdateData: any = {
          installationStatus: InstallationStatus.installed,
        };

        if (row.installationAddress) {
          deviceUpdateData.installationLocation =
            row.installationAddress.toString();
        }

        if (row.latitude) {
          const parsed = parseCoordinate(row.latitude);
          if (parsed) {
            deviceUpdateData.installationLatitude = parsed;
          }
        }

        if (row.longitude) {
          const parsed = parseCoordinate(row.longitude);
          if (parsed) {
            deviceUpdateData.installationLongitude = parsed;
          }
        }

        // Only update if there's something to update
        if (Object.keys(deviceUpdateData).length === 0) {
          session.stats.skippedDevices++;
          session.stats.errors.push({
            row: rowIndex + 1,
            serialNumber: row.serialNumber.toString(),
            message: 'No valid location data provided to update',
          });
          return;
        }

        // UPDATE DEVICE
        await this.prisma.device.update({
          where: { id: device.id },
          data: deviceUpdateData,
        });

        session.stats.updatedDevices++;
        this.logger.debug(
          `Updated device ${device.serialNumber} with location data`,
        );
      }

      // UPDATE RELATED CUSTOMER LOCATION (SMART & OPTIMAL)
      await this.updateRelatedCustomerLocation(
        sessionId,
        device.id,
        row,
        rowIndex,
      );
    } catch (error) {
      session.stats.errorRecords++;
      session.stats.errors.push({
        row: rowIndex + 1,
        serialNumber: row.serialNumber?.toString() || 'N/A',
        message: error.message || 'Unknown error during processing',
      });
      this.logger.error(
        `Error processing row ${rowIndex + 1} in session ${sessionId}`,
        error,
      );
    }

    // Update progress
    const session_current = this.sessions.get(sessionId);
    if (session_current) {
      session_current.stats.progressPercentage = Math.round(
        (session_current.stats.processedRecords /
          session_current.stats.totalRecords) *
          100,
      );
    }
  }

  /**
   * SMART: Update customer location via device -> saleItem -> sale -> customer
   * Only updates if customer doesn't already have coordinates
   */
  private async updateRelatedCustomerLocation(
    sessionId: string,
    deviceId: string,
    row: DeviceLocationUpdateRow,
    rowIndex: number,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      // Query: Device → SaleItem → Sale → Customer (optimal single query)
      const saleItem = await this.prisma.saleItem.findFirst({
        where: {
          deviceIDs: { has: deviceId },
        },
        select: {
          sale: {
            select: {
              customerId: true,
              customer: {
                select: {
                  id: true,
                  location: true,
                  latitude: true,
                  longitude: true,
                },
              },
            },
          },
        },
      });

      // If no saleItem/sale/customer relationship found, skip
      if (!saleItem?.sale?.customer) {
        this.logger.debug(
          `No customer found for device ${deviceId} via sale items`,
        );
        return;
      }

      const customer = saleItem.sale.customer;

      // SMART SKIP: Only skip if customer ALREADY HAS BOTH coordinates
      const hasExistingCoordinates = false

      // const hasExistingCoordinates =
      //   customer.latitude &&
      //   customer.latitude !== '-' &&
      //   customer.longitude &&
      //   customer.longitude !== '-';

      if (hasExistingCoordinates) {
        this.logger.debug(
          `Customer ${customer.id} already has coordinates, skipping`,
        );
        return;
      }

      // Prepare customer update data
      const customerUpdateData: any = {};

      // Update location if provided
      if (row.installationAddress) {
        customerUpdateData.location = row.installationAddress.toString();
      }

      // Update latitude if provided AND customer doesn't have it
      // if (row.latitude && (!customer.latitude || customer.latitude === '-')) {
      if (row.latitude) {
        const parsed = parseCoordinate(row.latitude);
        if (parsed) {
          customerUpdateData.latitude = parsed;
        }
      }

      // Update longitude if provided AND customer doesn't have it
      // if (
      //   row.longitude &&
      //   (!customer.longitude || customer.longitude === '-')
      // ) {
      if (
        row.longitude 
      ) {
        const parsed = parseCoordinate(row.longitude);
        if (parsed) {
          customerUpdateData.longitude = parsed
        }
      }

      // Only update if there's something to update
      if (Object.keys(customerUpdateData).length === 0) {
        return;
      }

      // UPDATE CUSTOMER with batch operation
      await this.prisma.customer.update({
        where: { id: customer.id },
        data: customerUpdateData,
      });

      session.stats.updatedCustomers++;
      this.logger.debug(
        `Updated customer ${customer.id} with location data from device ${deviceId}`,
      );
    } catch (error) {
      // Non-blocking error - log but don't fail the device update
      this.logger.warn(
        `Error updating customer location for device ${deviceId}:`,
        error,
      );
    }
  }

  /**
   * Get session stats
   */
  async getSessionStats(sessionId: string): Promise<any> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new BadRequestException('Session not found');
    }

    return session.stats;
  }

  /**
   * Map columns from file headers to standardized field names
   */
  private mapColumns(headers: string[]): Map<string, string> {
    const mapping = new Map<string, string>();

    for (const header of headers) {
      const normalizedHeader = header.toLowerCase().trim();
      const mappedField = this.COLUMN_MAPPINGS.get(normalizedHeader);

      if (mappedField) {
        mapping.set(header, mappedField);
      } else {
        // Try partial matching
        for (const [pattern, field] of this.COLUMN_MAPPINGS.entries()) {
          if (
            normalizedHeader.includes(pattern) ||
            pattern.includes(normalizedHeader)
          ) {
            mapping.set(header, field);
            break;
          }
        }
      }
    }

    return mapping;
  }

  /**
   * Validate required columns
   */
  private validateLocationColumns(
    columnMapping: Map<string, string>,
    headers: string[],
  ): { errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];
    const mappedFields = new Set(columnMapping.values());

    // Serial number is required
    if (!mappedFields.has('serialNumber')) {
      errors.push('Required column missing: serialNumber');
    }

    // At least one location field should be present
    const hasLocationField =
      mappedFields.has('installationAddress') ||
      mappedFields.has('latitude') ||
      mappedFields.has('longitude') ||
      mappedFields.has('lga') ||
      mappedFields.has('state');

    if (!hasLocationField) {
      errors.push(
        'At least one location field required: installationAddress, latitude, longitude, lga, or state',
      );
    }

    // Check for unmapped columns
    const unmappedColumns = headers.filter((h) => !columnMapping.has(h));
    if (unmappedColumns.length > 0) {
      warnings.push(
        `Unmapped columns (will be ignored): ${unmappedColumns.join(', ')}`,
      );
    }

    return { errors, warnings };
  }

  /**
   * Transform row with column mapping
   */
  private transformRowWithMapping(
    row: any,
    columnMapping: Map<string, string>,
  ): DeviceLocationUpdateRow {
    const transformed: any = {};

    for (const [originalColumn, mappedField] of columnMapping.entries()) {
      if (row[originalColumn] !== undefined && row[originalColumn] !== null) {
        transformed[mappedField] = this.cleanValue(row[originalColumn]);
      }
    }

    return transformed as DeviceLocationUpdateRow;
  }

  /**
   * Clean value
   */
  private cleanValue(value: any): any {
    if (typeof value === 'string') {
      return value.trim();
    }
    return value;
  }

  /**
   * Create processing session
   */
  private createSession(
    sessionId: string,
    fileInfo: any,
    data: DeviceLocationUpdateRow[],
  ): DeviceLocationUpdateSession {
    const session: DeviceLocationUpdateSession = {
      id: sessionId,
      fileInfo:
        typeof fileInfo === 'object' && 'originalname' in fileInfo
          ? {
              name: fileInfo.originalname,
              size: fileInfo.size,
              type: fileInfo.mimetype,
            }
          : fileInfo,
      stats: {
        sessionId,
        totalRecords: data.length,
        processedRecords: 0,
        updatedDevices: 0,
        updatedCustomers: 0,
        skippedDevices: 0,
        errorRecords: 0,
        progressPercentage: 0,
        status: 'processing',
        startTime: new Date(),
        errors: [],
      },
    };

    this.sessions.set(sessionId, session);
    return session;
  }
}
