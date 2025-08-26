import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreateDeviceDto } from './dto/create-device.dto';
import { PrismaService } from '../prisma/prisma.service';
import {
  UpdateDeviceDto,
  UpdateDeviceLocationDto,
  UpdateDeviceStatusDto,
} from './dto/update-device.dto';
import { createReadStream, readFileSync } from 'fs';
import * as csvParser from 'csv-parser';
import { parse } from 'papaparse';
import { MESSAGES } from '../constants';
import {
  ActionEnum,
  InstallationStatus,
  Prisma,
  SubjectEnum,
  TaskStatus,
} from '@prisma/client';
import { ListDevicesQueryDto } from './dto/list-devices.dto';
import { OpenPayGoService } from '../openpaygo/openpaygo.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

@Injectable()
export class DeviceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly openPayGo: OpenPayGoService,
    @InjectQueue('device-processing') private readonly deviceQueue: Queue,
  ) {}

  async uploadBatchDevices(filePath: string) {
    const rows = await this.parseCsv(filePath);

    const filteredRows = rows.filter(
      (row) => row['Serial_Number'] && row['Key'],
    );

    await this.mapDevicesToModel(filteredRows);
    return { message: MESSAGES.CREATED };
  }

  async createDevice(createDeviceDto: CreateDeviceDto, userId: string) {
    const device = await this.fetchDevice({
      serialNumber: createDeviceDto.serialNumber,
    });

    if (device) throw new BadRequestException(MESSAGES.DEVICE_EXISTS);

    return await this.prisma.device.create({
      data: { ...createDeviceDto, creatorId: userId },
    });
  }

  private validateStatusTransition(
    currentStatus: InstallationStatus,
    newStatus: InstallationStatus,
  ) {
    const allowedTransitions = {
      [InstallationStatus.not_installed]: [
        InstallationStatus.ready_for_installation,
      ],
      [InstallationStatus.ready_for_installation]: [
        InstallationStatus.installed,
      ],
      [InstallationStatus.installed]: [],
    };

    if (!allowedTransitions[currentStatus].includes(newStatus)) {
      throw new BadRequestException(
        `Invalid status transition from ${currentStatus} to ${newStatus}`,
      );
    }
  }

  private async validateInstallerAssignment(
    deviceId: string,
    installerAgentId: string,
  ) {
    const installerTask = await this.prisma.installerTask.findFirst({
      where: {
        installerAgentId,
        sale: {
          saleItems: {
            some: {
              devices: {
                some: {
                  id: deviceId,
                },
              },
            },
          },
        },
        status: {
          in: [TaskStatus.PENDING, TaskStatus.PENDING, TaskStatus.IN_PROGRESS],
        },
      },
    });

    if (!installerTask) {
      throw new ForbiddenException(
        'Device not assigned to this installer or task not active',
      );
    }

    return installerTask;
  }

  async validateUpdatePermissions(
    userId: string,
    deviceId?: string,
    extraPermissions: { action: ActionEnum; subject: SubjectEnum }[] = [],
    allowAgents = true,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: {
          include: {
            permissions: true,
          },
        },
        agentDetails: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const userRole = user.role.role;

    // allow admin and super-admin users to access resource
    if (userRole == 'admin' || userRole == 'super-admin') {
      return true;
    }

    const hasManagePermission = user.role.permissions.some(
      (permission) =>
        permission.action === ActionEnum.manage &&
        permission.subject === SubjectEnum.all,
    );

    if (hasManagePermission) {
      return;
    }

    const hasExtraPermission = extraPermissions.some((extra) =>
      user.role.permissions.some(
        (permission) =>
          permission.action === extra.action &&
          permission.subject === extra.subject,
      ),
    );

    if (hasExtraPermission) {
      return;
    }

    if (allowAgents) {
      if (user.agentDetails) {
        if (!deviceId) return true;
        await this.validateInstallerAssignment(deviceId, user.agentDetails.id);
      } else {
        throw new ForbiddenException(
          'Insufficient permissions to update device status',
        );
      }
    }
  }

  async updateDeviceStatus(
    deviceId: string,
    updateData: UpdateDeviceStatusDto,
    userId: string,
  ) {
    await this.validateUpdatePermissions(userId, deviceId);

    const device = await this.validateDeviceExistsAndReturn({ id: deviceId });

    this.validateStatusTransition(
      device.installationStatus,
      updateData.installationStatus,
    );

    return this.prisma.device.update({
      where: { id: deviceId },
      data: {
        installationStatus: updateData.installationStatus,
      },
      include: {
        saleItems: {
          include: {
            sale: {
              include: {
                customer: true,
              },
            },
          },
        },
      },
    });
  }

  async updateDeviceLocation(
    deviceId: string,
    locationData: UpdateDeviceLocationDto,
    installerAgentId: string,
  ) {
    const device = await this.validateDeviceExistsAndReturn({ id: deviceId });

    // Validate that installer is assigned to this device
    await this.validateInstallerAssignment(deviceId, installerAgentId);

    // Validate current status
    if (
      device.installationStatus !== InstallationStatus.ready_for_installation
    ) {
      throw new BadRequestException(
        'Device must be in ready_for_installation status to update location',
      );
    }

    return this.prisma.device.update({
      where: { id: deviceId },
      data: {
        installationStatus: InstallationStatus.installed,
        installationLocation: locationData.location,
        installationLongitude: locationData.latitude,
        installationLatitude: locationData.longitude,
      },
    });
  }

  async markDevicesReadyForInstallation(saleId: string) {
    const sale = await this.prisma.sales.findUnique({
      where: { id: saleId },
      include: {
        saleItems: {
          include: {
            devices: true,
          },
        },
      },
    });

    if (!sale) {
      throw new NotFoundException('Sale not found');
    }

    // Get all devices from this sale
    const deviceIds = sale.saleItems.flatMap((item) =>
      item.devices.map((device) => device.id),
    );

    if (deviceIds.length === 0) {
      return { message: 'No devices found for this sale' };
    }

    await this.prisma.device.updateMany({
      where: {
        id: { in: deviceIds },
        installationStatus: InstallationStatus.not_installed,
      },
      data: {
        installationStatus: InstallationStatus.ready_for_installation,
      },
    });

    return {
      message: `${deviceIds.length} devices marked as ready for installation`,
      deviceIds,
    };
  }

  async getDevicesForInstaller(installerAgentId: string) {
    return this.prisma.device.findMany({
      where: {
        saleItems: {
          some: {
            sale: {
              installerTasks: {
                some: {
                  installerAgentId,
                },
              },
            },
          },
        },
      },
      include: {
        saleItems: {
          include: {
            sale: {
              include: {
                customer: {
                  select: {
                    firstname: true,
                    lastname: true,
                    phone: true,
                    installationAddress: true,
                  },
                },
                installerTasks: {
                  where: {
                    installerAgentId,
                  },
                  select: {
                    id: true,
                    status: true,
                    scheduledDate: true,
                  },
                },
              },
            },
            product: {
              select: {
                name: true,
              },
            },
          },
        },
      },
    });
  }

  async createBatchDeviceTokens(filePath: string, userId: string) {
    const rows = await this.parseCsv(filePath);
    console.log({ filePath, rows });

    const filteredRows = rows.filter(
      (row) => row['Serial_Number'] && row['Key'],
    );

    const data = filteredRows.map((row) => ({
      serialNumber: row['Serial_Number'],
      deviceName: row['Device_Name'],
      key: row['Key'],
      count: row['Count'],
      timeDivider: row['Time_Divider'],
      firmwareVersion: row['Firmware_Version'],
      hardwareModel: row['Hardware_Model'],
      startingCode: row['Starting_Code'],
      restrictedDigitMode: row['Restricted_Digit_Mode'] == '1',
      isTokenable: this.parseTokenableValue(row),
    }));

    const deviceTokens = [];
    const processedDevices = [];

    for (const deviceData of data) {
      try {
        const device = await this.prisma.device.upsert({
          where: { serialNumber: deviceData.serialNumber },
          update: {
            key: deviceData.key,
            timeDivider: deviceData.timeDivider,
            firmwareVersion: deviceData.firmwareVersion,
            hardwareModel: deviceData.hardwareModel,
            startingCode: deviceData.startingCode,
            restrictedDigitMode: deviceData.restrictedDigitMode,
            isTokenable: deviceData.isTokenable,
            updatedAt: new Date(),
          },
          create: {
            serialNumber: deviceData.serialNumber,
            key: deviceData.key,
            count: deviceData.count,
            timeDivider: deviceData.timeDivider,
            firmwareVersion: deviceData.firmwareVersion,
            hardwareModel: deviceData.hardwareModel,
            startingCode: deviceData.startingCode,
            restrictedDigitMode: deviceData.restrictedDigitMode,
            isTokenable: deviceData.isTokenable,
          },
        });

        const duration = 30;

        const token = await this.openPayGo.generateToken(
          deviceData,
          duration,
          Number(device.count),
        );

        await this.prisma.device.update({
          where: { id: device.id },
          data: { count: String(token.newCount) },
        });

        // Store token in database
        await this.prisma.tokens.create({
          data: {
            deviceId: device.id,
            token: String(token.finalToken),
            duration,
            creatorId: userId,
          },
        });

        deviceTokens.push({
          deviceId: device.id,
          deviceSerialNumber: device.serialNumber,
          deviceKey: device.key,
          deviceToken: token.finalToken,
          duration,
        });

        processedDevices.push(device);
      } catch (error) {
        console.error(
          `Error processing device ${deviceData.serialNumber}:`,
          error,
        );
      }
    }

    return {
      message: MESSAGES.CREATED,
      devicesProcessed: processedDevices.length,
      deviceTokens,
    };
  }

  async queueBatchTokenGeneration(filePath: string, uploadedBy?: string) {
    const jobId = `batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const job = await this.deviceQueue.add(
      'batch-token-generation',
      {
        filePath,
        uploadedBy,
        jobId,
      },
      {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 10,
        removeOnFail: 50,
      },
    );

    return {
      jobId: job.id!.toString(),
      message: 'Batch token generation started',
      status: 'queued',
    };
  }

  async createBatchDeviceTokensWithProgress(
    filePath: string,
    userId: string,
    progressCallback?: (progress: number) => Promise<void>,
  ) {
    try {
      // Read and parse the CSV file
      const fileContent: any = readFileSync(filePath, 'utf8');
      console.log(`[SERVICE] File size: ${fileContent.length} characters`);

      const parseResult: any = parse(fileContent, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: false, // Keep all as strings initially
      });

      console.log(`[SERVICE] Parse result:`, {
        data_length: parseResult.data.length,
        errors: parseResult.errors,
        meta: parseResult.meta,
      });

      // Log first few rows to see structure
      console.log(`[SERVICE] First 3 rows:`, parseResult.data.slice(0, 3));
      console.log(`[SERVICE] Headers found:`, parseResult.meta.fields);

      const data = parseResult.data as any[];

      // Filter out completely empty rows
      const validRows = data.filter((row) => {
        // Check if row has any non-empty values
        return Object.values(row).some(
          (value) =>
            value !== null &&
            value !== undefined &&
            String(value).trim() !== '',
        );
      });

      console.log(
        `[SERVICE] Total rows: ${data.length}, Valid rows: ${validRows.length}`,
      );

      if (progressCallback) {
        await progressCallback(15);
      }

      const generatedTokens: Array<{
        deviceSerialNumber: string;
        deviceKey?: string;
        deviceToken: string;
        deviceId?: string;
        tokenId?: string;
        tokenDuration?: number;
        row: number;
      }> = [];

      const errors: Array<{
        row: number;
        error: string;
        deviceSerialNumber?: string;
      }> = [];

      let processedCount = 0;
      let skippedCount = 0;

      // Process each valid row
      for (let i = 0; i < validRows.length; i++) {
        const row = validRows[i];
        const rowNumber = i + 2; // +2 because CSV rows start at 1 and we have headers

        try {
          // Log row structure for debugging (first 5 rows only)
          if (i < 5) {
            console.log(`[SERVICE] Processing row ${rowNumber}:`, row);
            console.log(`[SERVICE] Available keys:`, Object.keys(row));
          }

          // Extract required fields - try multiple possible column names INCLUDING SPACES
          const serialNumber = this.extractFieldFromRow(row, [
            'Serial Number', // Your CSV format
            'serialNumber',
            'serial_number',
            'SerialNumber',
            'serialnumber',
            'SERIAL_NUMBER',
            'Serial_Number',
            'device_serial',
            'deviceSerial',
          ]);

          const tokenDurationRaw =
            this.extractFieldFromRow(row, [
              'Token Duration', // If your CSV has this
              'tokenDuration',
              'token_duration',
              'TokenDuration',
              'duration',
              'Duration',
              'token_days',
              'tokenDays',
            ]) || '30';

          const tokenDuration = parseInt(String(tokenDurationRaw)) || 30;

          if (!serialNumber || String(serialNumber).trim() === '') {
            errors.push({
              row: rowNumber,
              error: 'Missing or empty serial number',
            });
            skippedCount++;
            continue;
          }

          // Clean the serial number
          const cleanSerialNumber = String(serialNumber).trim();

          // Find the device in database
          const device = await this.prisma.device.findFirst({
            where: {
              serialNumber: cleanSerialNumber,
              isTokenable: true,
            },
          });

          if (!device) {
            errors.push({
              row: rowNumber,
              error: 'Device not found or not tokenable',
              deviceSerialNumber: cleanSerialNumber,
            });
            skippedCount++;
            continue;
          }

          // Generate token
          const tokenResult = await this.openPayGo.generateToken(
            device,
            tokenDuration,
            Number(device.count),
          );

          // Update device count
          await this.prisma.device.update({
            where: { id: device.id },
            data: { count: String(tokenResult.newCount) },
          });

          // Save token to database
          const savedToken = await this.prisma.tokens.create({
            data: {
              deviceId: device.id,
              token: String(tokenResult.finalToken),
              duration: tokenDuration,
              creatorId: userId,
            },
          });

          // Add to results
          generatedTokens.push({
            deviceSerialNumber: device.serialNumber,
            deviceKey: device.key,
            deviceToken: String(tokenResult.finalToken),
            deviceId: device.id,
            tokenId: savedToken.id,
            tokenDuration: tokenDuration,
            row: rowNumber,
          });

          processedCount++;

          // Log progress every 100 rows
          if (processedCount % 100 === 0) {
            console.log(
              `[SERVICE] Processed ${processedCount} devices so far...`,
            );
          }

          // Update progress
          if (progressCallback) {
            const progress = 15 + (i / validRows.length) * 70; // 15% to 85%
            await progressCallback(Math.min(progress, 85));
          }
        } catch (error) {
          console.error(`[SERVICE] Error processing row ${rowNumber}:`, error);
          errors.push({
            row: rowNumber,
            error: error.message || 'Unknown error',
            deviceSerialNumber:
              this.extractFieldFromRow(row, [
                'Serial Number',
                'serialNumber',
                'serial_number',
              ]) || 'Unknown',
          });
          skippedCount++;
        }
      }

      if (progressCallback) {
        await progressCallback(90);
      }

      console.log(`[SERVICE] Batch processing complete:`, {
        totalRowsInFile: data.length,
        validRows: validRows.length,
        tokensGenerated: processedCount,
        errors: errors.length,
        skipped: skippedCount,
      });

      return {
        devicesProcessed: processedCount,
        totalRows: data.length,
        validRows: validRows.length,
        tokens: generatedTokens,
        errors: errors,
      };
    } catch (error) {
      console.error('[SERVICE] Error in batch token generation:', error);
      throw new Error(`Batch token generation failed: ${error.message}`);
    }
  }

  private extractFieldFromRow(row: any, possibleKeys: string[]): string | null {
    for (const key of possibleKeys) {
      if (
        row[key] !== undefined &&
        row[key] !== null &&
        String(row[key]).trim() !== ''
      ) {
        return String(row[key]).trim();
      }
    }
    return null;
  }

  async generateSingleDeviceToken(
    deviceId: string,
    tokenDuration: number,
    userId: string,
  ) {
    const device = await this.prisma.device.findUnique({
      where: { id: deviceId },
    });

    if (!device) {
      throw new NotFoundException(`Device with ID ${deviceId} not found`);
    }

    // if (!device.isTokenable) {
    //   throw new BadRequestException('This device is not tokenable');
    // }

    try {
      const token = await this.openPayGo.generateToken(
        {
          key: device.key,
          timeDivider: device.timeDivider,
          restrictedDigitMode: device.restrictedDigitMode,
          startingCode: device.startingCode,
        } as any,
        tokenDuration,
        Number(device.count),
      );

      await this.prisma.device.update({
        where: { id: deviceId },
        data: { count: String(token.newCount) },
      });

      const savedToken = await this.prisma.tokens.create({
        data: {
          deviceId: device.id,
          token: String(token.finalToken),
          duration: tokenDuration,
          creatorId: userId,
        },
      });

      return {
        message: 'Token generated successfully',
        deviceId: device.id,
        deviceSerialNumber: device.serialNumber,
        tokenId: savedToken.id,
        deviceToken: token.finalToken,
        tokenDuration:
          tokenDuration === -1 ? 'Forever' : `${tokenDuration} days`,
      };
    } catch (error) {
      throw new BadRequestException(
        `Failed to generate token: ${error.message}`,
      );
    }
  }

  async deleteDeviceToken(deviceId: string, tokenId: string) {
    const token = await this.prisma.tokens.findUnique({
      where: { id: tokenId, deviceId },
    });

    if (!token) {
      throw new NotFoundException(`Token not found for device`);
    }

    return await this.prisma.tokens.delete({
      where: { id: tokenId, deviceId },
    });
  }

  async devicesFilter(
    query: ListDevicesQueryDto,
  ): Promise<Prisma.DeviceWhereInput> {
    const {
      search,
      serialNumber,
      startingCode,
      key,
      hardwareModel,
      isTokenable,
      createdAt,
      updatedAt,
      fetchFormat,
      agentId,
      isExact,
      installationStatus,
    } = query;

    // console.log({ isExact });

    const filterConditions: Prisma.DeviceWhereInput = {
      AND: [
        search
          ? isExact
            ? { serialNumber: { equals: search } }
            : {
                OR: [
                  { serialNumber: { contains: search, mode: 'insensitive' } },
                  { startingCode: { contains: search, mode: 'insensitive' } },
                  { key: { contains: search, mode: 'insensitive' } },
                  { hardwareModel: { contains: search, mode: 'insensitive' } },
                ],
              }
          : {},
        serialNumber
          ? isExact
            ? { serialNumber: { equals: serialNumber } }
            : { serialNumber: { contains: serialNumber, mode: 'insensitive' } }
          : {},
        startingCode
          ? { startingCode: { contains: startingCode, mode: 'insensitive' } }
          : {},
        key ? { key: { contains: key, mode: 'insensitive' } } : {},
        installationStatus ? { installationStatus } : {},
        agentId
          ? {
              saleItems: {
                some: {
                  sale: {
                    creatorId: agentId,
                  },
                },
              },
            }
          : {},

        // fetchFormat === 'used'
        //   ? { isUsed: true }
        //   : fetchFormat === 'unused'
        //     ? { isUsed: false }
        //     : {},

        hardwareModel
          ? { hardwareModel: { contains: hardwareModel, mode: 'insensitive' } }
          : {},
        isTokenable
          ? {
              isTokenable,
            }
          : {},
        createdAt ? { createdAt: { gte: new Date(createdAt) } } : {},
        updatedAt ? { updatedAt: { gte: new Date(updatedAt) } } : {},
      ],
    };

    return filterConditions;
  }

  async fetchDevices(query: ListDevicesQueryDto, agent?: string) {
    const { page = 1, limit = 100, sortField, sortOrder } = query;

    const filterConditions = await this.devicesFilter({
      ...query,
      ...(agent ? { agentId: agent } : {}),
    });

    const pageNumber = parseInt(String(page), 10);
    const limitNumber = parseInt(String(limit), 10);

    const skip = (pageNumber - 1) * limitNumber;
    const take = limitNumber;

    const orderBy = {
      [sortField || 'createdAt']: sortOrder || 'asc',
    };

    const totalCount = await this.prisma.device.count({
      where: filterConditions,
    });

    const result = await this.prisma.device.findMany({
      skip,
      take,
      where: filterConditions,
      include: {
        _count: {
          select: {
            tokens: true,
          },
        },
      },
      orderBy,
    });

    return {
      devices: result,
      total: totalCount,
      page,
      limit,
      totalPages: limitNumber === 0 ? 0 : Math.ceil(totalCount / limitNumber),
    };
  }

  async fetchDevice(fieldAndValue: Prisma.DeviceWhereUniqueInput) {
    return await this.prisma.device.findUnique({
      where: { ...fieldAndValue },
      include: {
        tokens: {
          include: {
            creator: {
              select: {
                id: true,
                firstname: true,
                lastname: true,
                role: {
                  select: { role: true },
                },
              },
            },
          },
        },
      },
    });
  }

  async updateDevice(id: string, updateDeviceDto: UpdateDeviceDto) {
    await this.validateDeviceExistsAndReturn({ id });

    return await this.prisma.device.update({
      where: { id },
      data: updateDeviceDto,
    });
  }

  async deleteDevice(id: string) {
    await this.validateDeviceExistsAndReturn({ id });
    await this.prisma.device.delete({
      where: { id },
    });

    return { message: MESSAGES.DELETED };
  }

  async updateDeviceTokenableStatus(id: string, isTokenable: boolean) {
    await this.validateDeviceExistsAndReturn({ id });

    const updatedDevice = await this.prisma.device.update({
      where: { id },
      data: {
        isTokenable,
        updatedAt: new Date(),
      },
    });

    return {
      message: `Device tokenable status updated to ${isTokenable}`,
      device: {
        id: updatedDevice.id,
        serialNumber: updatedDevice.serialNumber,
        isTokenable: updatedDevice.isTokenable,
        updatedAt: updatedDevice.updatedAt,
      },
    };
  }

  async validateDeviceExistsAndReturn(
    fieldAndValue: Prisma.DeviceWhereUniqueInput,
  ) {
    const device = await this.fetchDevice(fieldAndValue);

    if (!device) throw new BadRequestException(MESSAGES.DEVICE_NOT_FOUND);

    return device;
  }

  private async parseCsv(filePath: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const results = [];
      createReadStream(filePath)
        .pipe(csvParser())
        .on('data', (data) => {
          const normalizedData = Object.keys(data).reduce((acc, key) => {
            const normalizedKey = key.trim().replace(/\s+/g, '_'); // Replace spaces with underscores
            acc[normalizedKey] = data[key];
            return acc;
          }, {});
          results.push(normalizedData);
        })
        .on('end', () => resolve(results))
        .on('error', (err) => reject(err));
    });
  }

  private async mapDevicesToModel(rows: Record<string, string>[]) {
    const data = rows.map((row) => ({
      serialNumber: row['Serial_Number'],
      deviceName: row['Device_Name'],
      key: row['Key'],
      count: row['Count'],
      timeDivider: row['Time_Divider'],
      firmwareVersion: row['Firmware_Version'],
      hardwareModel: row['Hardware_Model'],
      startingCode: row['Starting_Code'],
      restrictedDigitMode: row['Restricted_Digit_Mode'] == '1',
      // Handle isTokenable field - check multiple possible column names
      isTokenable: this.parseTokenableValue(row),
    }));

    for (const device of data) {
      await this.prisma.device.upsert({
        where: { serialNumber: device.serialNumber },
        update: {
          // Update all fields including isTokenable
          key: device.key,
          timeDivider: device.timeDivider,
          firmwareVersion: device.firmwareVersion,
          hardwareModel: device.hardwareModel,
          startingCode: device.startingCode,
          restrictedDigitMode: device.restrictedDigitMode,
          isTokenable: device.isTokenable,
          updatedAt: new Date(),
        },
        create: { ...device },
      });
    }
  }

  private parseTokenableValue(row: Record<string, string>): boolean {
    const possibleKeys = [
      'Tokenable',
      'tokenable',
      'isTokenable',
      'is_tokenable',
      'Is_Tokenable',
      'TOKENABLE',
      'Token_Enabled',
      'token_enabled',
      'TokenEnabled',
    ];

    for (const key of possibleKeys) {
      if (row[key] !== undefined && row[key] !== null) {
        const value = String(row[key]).trim().toLowerCase();
        return (
          value === '1' || value === 'true' || value === 'yes' || value === 'y'
        );
      }
    }

    return false;
  }
}
