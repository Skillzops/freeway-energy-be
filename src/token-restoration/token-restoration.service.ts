import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

export interface TokenRestoreResult {
  totalRecords: number;
  devicesCreated: number;
  devicesUpdated: number;
  tokensCreated: number;
  tokensSkipped: number;
  errors: Array<{ row: number; error: string }>;
}

interface ParsedTokenRow {
  deviceId: string;
  serialNumber: string;
  deviceKey: string;
  hardwareModel?: string;
  firmwareVersion?: string;
  installationStatus: string;
  installationAddress?: string;
  installationLongitude?: string;
  installationLatitude?: string;
  isTokenable: boolean;
  isUsed: boolean;
  startingCode?: string;
  currentCount?: string;
  timeDivider?: string;
  restrictedDigitMode: boolean;
  tokens: Array<{
    token: string;
    duration: number;
    createdAt: Date;
  }>;
}

@Injectable()
export class TokenRestorationService {
  private logger = new Logger(TokenRestorationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Parse CSV content from device-tokens/download report
   * Expected format: TSV or CSV with headers and token data
   */
  private parseTokensCsv(csvContent: string): ParsedTokenRow[] {
    const lines = csvContent.trim().split('\n');
    if (lines.length < 2) {
      throw new BadRequestException(
        'CSV must contain headers and at least one data row',
      );
    }

    // Parse header row
    const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());

    // Find column indices
    const columnMap = {
      deviceId: headers.indexOf('device id'),
      serialNumber: headers.indexOf('serial number'),
      deviceKey: headers.indexOf('device key'),
      hardwareModel: headers.indexOf('hardware model'),
      firmwareVersion: headers.indexOf('firmware version'),
      installationStatus: headers.indexOf('installation status'),
      installationAddress: headers.indexOf('installation address'),
      installationLongitude: headers.indexOf('installation coordinates'),
      installationLatitude: headers.indexOf('installation coordinates'),
      isTokenable: headers.indexOf('is tokenable'),
      isUsed: headers.indexOf('is used'),
      startingCode: headers.indexOf('starting code'),
      currentCount: headers.indexOf('current count'),
      timeDivider: headers.indexOf('time divider'),
      restrictedDigitMode: headers.indexOf('restricted digit mode'),
      allTokens: headers.indexOf('all tokens (token:duration:date)'),
    };

    // Validate required columns
    if (
      columnMap.deviceId === -1 ||
      columnMap.serialNumber === -1 ||
      columnMap.deviceKey === -1
    ) {
      throw new BadRequestException(
        'CSV must contain "Device ID", "Serial Number", and "Device Key" columns',
      );
    }

    const parsedRows: ParsedTokenRow[] = [];

    // Parse data rows (skip header)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue; // Skip empty lines

      try {
        const row = this.parseCsvLine(line);

        // Extract coordinates from format "Lon X Lat Y"
        const coordString =
          columnMap.installationLongitude !== -1
            ? row[columnMap.installationLongitude]
            : '';
        const coordMatch = coordString.match(
          /Lon\s+([-\d.]+)\s+Lat\s+([-\d.]+)/,
        );

        // Parse tokens from format "token:duration:date;token:duration:date;..."
        const tokensString =
          columnMap.allTokens !== -1 ? row[columnMap.allTokens] : '';
        const tokens = this.parseTokensString(tokensString);

        const installationAddress =
          columnMap.installationAddress !== -1
            ? row[columnMap.installationAddress].replace(/^"|"$/g, '')
            : '';

        const parsedRow: ParsedTokenRow = {
          deviceId: row[columnMap.deviceId],
          serialNumber: row[columnMap.serialNumber],
          deviceKey: row[columnMap.deviceKey],
          hardwareModel:
            columnMap.hardwareModel !== -1
              ? row[columnMap.hardwareModel] || undefined
              : undefined,
          firmwareVersion:
            columnMap.firmwareVersion !== -1
              ? row[columnMap.firmwareVersion] || undefined
              : undefined,
          installationStatus:
            columnMap.installationStatus !== -1
              ? row[columnMap.installationStatus]
              : 'not_installed',
          installationAddress: installationAddress || undefined,
          installationLongitude: coordMatch ? coordMatch[1] : undefined,
          installationLatitude: coordMatch ? coordMatch[2] : undefined,
          isTokenable:
            columnMap.isTokenable !== -1
              ? row[columnMap.isTokenable].toLowerCase() === 'true'
              : false,
          isUsed:
            columnMap.isUsed !== -1
              ? row[columnMap.isUsed].toLowerCase() === 'true'
              : false,
          startingCode:
            columnMap.startingCode !== -1
              ? row[columnMap.startingCode] || undefined
              : undefined,
          currentCount:
            columnMap.currentCount !== -1
              ? row[columnMap.currentCount] || undefined
              : undefined,
          timeDivider:
            columnMap.timeDivider !== -1
              ? row[columnMap.timeDivider] || undefined
              : undefined,
          restrictedDigitMode:
            columnMap.restrictedDigitMode !== -1
              ? row[columnMap.restrictedDigitMode].toLowerCase() === 'true'
              : false,
          tokens,
        };

        parsedRows.push(parsedRow);
      } catch (error) {
        this.logger.error(`Error parsing row ${i + 1}: ${error.message}`);
        // Continue with next row instead of failing
        continue;
      }
    }

    return parsedRows;
  }

  /**
   * Parse a CSV line, handling quoted fields
   */
  private parseCsvLine(line: string): string[] {
    const result = [];
    let current = '';
    let insideQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        if (insideQuotes && line[i + 1] === '"') {
          current += '"';
          i++; // Skip next quote
        } else {
          insideQuotes = !insideQuotes;
        }
      } else if (char === ',' && !insideQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }

    result.push(current.trim());
    return result;
  }

  /**
   * Parse tokens string format: "token:duration:date;token:duration:date;..."
   */
  private parseTokensString(
    tokensString: string,
  ): Array<{ token: string; duration: number; createdAt: Date }> {
    if (!tokensString || tokensString === '""') {
      return [];
    }

    // Remove surrounding quotes
    const cleaned = tokensString.replace(/^"|"$/g, '');

    if (!cleaned) {
      return [];
    }

    const tokenParts = cleaned.split(';');
    const tokens = [];

    for (const part of tokenParts) {
      const [token, durationStr, dateStr] = part.split(':');

      if (!token) continue;

      const duration = parseInt(durationStr || '0', 10) || 0;
      let createdAt = new Date();

      if (dateStr) {
        try {
          createdAt = new Date(dateStr);
          // Validate date is valid
          if (isNaN(createdAt.getTime())) {
            createdAt = new Date();
          }
        } catch (error) {
          console.log({ error });
          createdAt = new Date();
        }
      }

      tokens.push({
        token: token.trim(),
        duration,
        createdAt,
      });
    }

    return tokens;
  }

  /**
   * Restore tokens from CSV data
   * - Creates devices if they don't exist
   * - Updates device info if it exists
   * - Creates tokens if they don't exist (checked by device + token text)
   * - Skips duplicate tokens
   */
  async restoreTokensFromCsv(
    csvContent: string,
    userId?: string,
  ): Promise<TokenRestoreResult> {
    const result: TokenRestoreResult = {
      totalRecords: 0,
      devicesCreated: 0,
      devicesUpdated: 0,
      tokensCreated: 0,
      tokensSkipped: 0,
      errors: [],
    };

    try {
      // Parse CSV
      const parsedRows = this.parseTokensCsv(csvContent);
      result.totalRecords = parsedRows.length;

      this.logger.log(
        `Starting restore: ${parsedRows.length} records to process`,
      );

      // Process each row
      for (let i = 0; i < parsedRows.length; i++) {
        try {
          const row = parsedRows[i];

          console.log({row})

          // Step 1: Check if device exists
          let device = await this.prisma.device.findFirst({
            where: {
              serialNumber: {
                equals: row.serialNumber,
                mode: 'insensitive',
              },
            },
            include: {
              tokens: true,
            },
          });

          // Step 2: Create device if it doesn't exist
          if (!device) {
            device = await this.prisma.device.create({
              data: {
                serialNumber: row.serialNumber,
                key: row.deviceKey,
                hardwareModel: row.hardwareModel,
                firmwareVersion: row.firmwareVersion,
                installationStatus: (row.installationStatus ||
                  'not_installed') as any,
                installationLocation: row.installationAddress,
                installationLongitude: row.installationLongitude,
                installationLatitude: row.installationLatitude,
                isTokenable: row.isTokenable,
                isUsed: row.isUsed,
                startingCode: row.startingCode,
                count: row.currentCount,
                timeDivider: row.timeDivider,
                restrictedDigitMode: row.restrictedDigitMode,
                creatorId: userId,
              },
              include: {
                tokens: true,
              },
            });

            result.devicesCreated++;
            this.logger.log(`Created device: ${row.serialNumber}`);
          } else {
            // Step 3: Update device if it already exists
            device = await this.prisma.device.update({
              where: { id: device.id },
              data: {
                key: row.deviceKey || device.key,
                hardwareModel: row.hardwareModel || device.hardwareModel,
                firmwareVersion: row.firmwareVersion || device.firmwareVersion,
                installationStatus: (row.installationStatus ||
                  device.installationStatus) as any,
                installationLocation:
                  row.installationAddress || device.installationLocation,
                installationLongitude:
                  row.installationLongitude || device.installationLongitude,
                installationLatitude:
                  row.installationLatitude || device.installationLatitude,
                isTokenable:
                  row.isTokenable !== undefined
                    ? row.isTokenable
                    : device.isTokenable,
                isUsed: row.isUsed !== undefined ? row.isUsed : device.isUsed,
                startingCode: row.startingCode || device.startingCode,
                count: row.currentCount || device.count,
                timeDivider: row.timeDivider || device.timeDivider,
                restrictedDigitMode:
                  row.restrictedDigitMode !== undefined
                    ? row.restrictedDigitMode
                    : device.restrictedDigitMode,
              },
              include: {
                tokens: true,
              },
            });

            result.devicesUpdated++;
            this.logger.log(`Updated device: ${row.serialNumber}`);
          }

          // Step 4: Restore tokens
          for (const tokenData of row.tokens) {
            // Check if token already exists
            const existingToken = device.tokens.find(
              (t) => t.token === tokenData.token && t.deviceId === device.id,
            );

            if (existingToken) {
              this.logger.debug(`Token already exists: ${tokenData.token}`);
              result.tokensSkipped++;
              continue;
            }

            // Create token
            await this.prisma.tokens.create({
              data: {
                token: tokenData.token,
                duration: tokenData.duration,
                createdAt: tokenData.createdAt,
                deviceId: device.id,
                creatorId: userId,
              },
            });

            result.tokensCreated++;
          }
        } catch (error) {
          this.logger.error(`Error processing row ${i + 1}: ${error.message}`);
          result.errors.push({
            row: i + 1,
            error: error.message,
          });
        }
      }

      this.logger.log(`Restore completed: ${JSON.stringify(result)}`);
      return result;
    } catch (error) {
      this.logger.error(`CSV parsing error: ${error.message}`);
      throw new BadRequestException(`Failed to parse CSV: ${error.message}`);
    }
  }

  /**
   * Restore tokens from uploaded file buffer
   */
  async restoreTokensFromFile(
    fileBuffer: Buffer,
    userId?: string,
  ){
    // const csvContent = fileBuffer.toString('utf-8');
    // // return this.restoreTokensFromCsv(csvContent, userId);
    // const tokenCount = await this.prisma.device.count({
    //   where: {
    //     isTokenable: false,
    //     tokens: {
    //       some: {},
    //     },
    //   },
   
    // });


    // const tokenCounts = await this.prisma.device.updateMany({
    //   where: {
    //     isTokenable: false,
    //     tokens: {
    //       some: {},
    //     },
    //   },
    //   data: {
    //     isTokenable: true,
    //   }
    // });

    console.log('Token Counts: done', userId, fileBuffer);

    return "done"
  }
}
