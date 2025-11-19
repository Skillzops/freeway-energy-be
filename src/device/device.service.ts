import {
  BadRequestException,
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
  Agent,
  Customer,
  Device,
  InstallationStatus,
  PaymentMode,
  Prisma,
  SaleItem,
  Sales,
  SalesStatus,
  TaskStatus,
  User,
} from '@prisma/client';
import { ListDevicesQueryDto } from './dto/list-devices.dto';
import { OpenPayGoService } from '../openpaygo/openpaygo.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as fs from 'fs';
import * as path from 'path';
import { AuthService } from 'src/auth/auth.service';
import { NotificationService } from 'src/notification/notification.service';

@Injectable()
export class DeviceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly openPayGo: OpenPayGoService,
    private readonly authService: AuthService,
    private readonly notificationService: NotificationService,
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

  async updateDeviceStatus(
    deviceId: string,
    updateData: UpdateDeviceStatusDto,
    userId: string,
  ) {
    await this.authService.validateUserPermissions({ userId, deviceId });

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

    // Validate current status
    if (device.installationStatus === InstallationStatus.installed) {
      throw new BadRequestException(`Device already installed`);
    }
    // Validate that installer is assigned to this device
    await this.authService.validateInstallerDeviceAssignment(
      deviceId,
      installerAgentId,
    );

    const agentInstaller = await this.prisma.agentInstallerAssignment.findFirst(
      {
        where: {
          installerId: installerAgentId,
        },
        select: {
          agent: {
            select: {
              id: true,
              assignedInstallers: true,
              assignedAsInstaller: true,
              user: {
                select: {
                  firstname: true,
                  lastname: true,
                  phone: true,
                  email: true,
                },
              },
            },
          },
        },
      },
    );

    const agent = agentInstaller?.agent;

    if (!agent) {
      throw new NotFoundException(`Installer Agent not found`);
    }

    // Update device with location and mark as installed
    const updatedDevice = await this.prisma.device.update({
      where: { id: deviceId },
      data: {
        installationStatus: InstallationStatus.installed,
        installationLocation: locationData.location,
        installationLongitude: locationData.longitude,
        installationLatitude: locationData.latitude,
        gpsVerified: true,
      },
      include: {
        saleItems: {
          include: {
            sale: {
              include: {
                customer: true,
                saleItems: {
                  include: {
                    devices: true,
                  },
                },
              },
            },
            product: true,
          },
        },
      },
    });

    console.log({ updatedDevice });

    await this.deviceQueue.add(
      'process-device-token-send',
      {
        device: updatedDevice,
        agent,
      },
      {
        attempts: 2,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 10,
        removeOnFail: 50,
      },
    );

    return updatedDevice;
  }

  async processDeviceTokenSend(
    device: Device & {
      saleItems: (SaleItem & {
        paymentMode: PaymentMode;
        sale: Sales & { customer: Customer };
      })[];
    },
    agent?: Agent & { user: User },
  ) {
    const tokensToSend = [];

    if (device.isTokenable) {
      const saleItem = device.saleItems[0];
      const sale = saleItem.sale;

      const tokenData = await this.generateAndSendTokensForDevice(
        device,
        sale,
        saleItem.paymentMode,
      );
      if (tokenData) tokensToSend.push(tokenData);
    }

    if (tokensToSend.length > 0) {
      await this.notificationService.sendTokenToRecipient(
        // {
        //   firstname: device.saleItems[0].sale.customer.firstname,
        //   lastname: device.saleItems[0].sale.customer.lastname,
        //   phone: device.saleItems[0].sale.customer.phone,
        //   email: device.saleItems[0].sale.customer.email,
        // },
        {
          firstname: agent.user.firstname,
          lastname: agent.user.lastname,
          phone: agent.user.phone,
          email: agent.user.email,
        },
        tokensToSend,
      );
    }
  }

  async handleFailedDeviceTokenGeneration(
    serialNumber: string,
    saleId: string,
  ) {
    const device = await this.prisma.device.findFirst({
      where: {
        serialNumber,
        saleItems: {
          some: {
            saleId,
          },
        },
      },
      include: {
        saleItems: {
          include: {
            sale: {
              include: {
                creatorDetails: true,
              },
            },
          },
        },
      },
    });

    if (!device) {
      throw new BadRequestException('Device not found');
    }
    const tokensToSend = [];

    if (device.isTokenable) {
      for (const saleItem of device.saleItems) {
        const sale = saleItem.sale;

        const tokenData = await this.generateAndSendTokensForDevice(
          device,
          sale,
          saleItem.paymentMode,
        );
        if (tokenData) tokensToSend.push(tokenData);
      }

      if (tokensToSend.length > 0) {
        await this.notificationService.sendTokenToRecipient(
          {
            email: device.saleItems[0].sale.creatorDetails.email,
            phone: device.saleItems[0].sale.creatorDetails.phone,
            firstname: device.saleItems[0].sale.creatorDetails.firstname,
            lastname: device.saleItems[0].sale.creatorDetails.lastname,
          },
          tokensToSend,
        );
      }
    }
  }

  async findZeroTokenDevices() {
    const latestTokens = await this.prisma.tokens.groupBy({
      by: ['deviceId'],
      _max: {
        createdAt: true,
      },
    });

    // Step 2: Fetch tokens that match the latest timestamp
    const lastTokenRecords = await this.prisma.tokens.findMany({
      where: {
        OR: latestTokens.map((t) => ({
          deviceId: t.deviceId,
          createdAt: t._max.createdAt,
        })),
      },
      include: {
        device: true,
      },
    });

    // Step 3: Filter only those with duration = 0
    const zeroDurationDeviceIds = lastTokenRecords
      .filter((t) => t.duration === 0)
      .map((t) => t.deviceId);

    if (zeroDurationDeviceIds.length === 0) return [];

    // Step 4: Fetch the actual devices with relationships
    const devices = await this.prisma.device.findMany({
      where: {
        id: { in: zeroDurationDeviceIds },
        NOT: {
          saleItems: {
            some: {
              sale: null,
            },
          },
        },
      },
      include: {
        saleItems: {
          include: {
            sale: {
              include: {
                creatorDetails: true,
              },
            },
          },
        },
        _count: true,
      },
    });

    // return devices;
    console.log({ val: devices.length });
    const filePath = path.join(process.cwd(), 'zero-token-devices.json');

    fs.writeFileSync(filePath, JSON.stringify(devices, null, 2), 'utf8');

    return devices;
  }

  async findSalesWithWrongTotals() {
    const sales = await this.prisma.sales.findMany({
      where: {
        totalPrice: 0,
      },
    });

    return sales;
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

    const task = await this.prisma.installerTask.findFirst({
      where: {
        saleId: sale.id,
      },
    });

    if (!task) {
      const { id } = await this.prisma.agent.findUnique({
        where: { id: sale.creatorId },
        select: { id: true },
      });

      await this.prisma.installerTask.create({
        data: {
          status: TaskStatus.PENDING,
          sale: { connect: { id: sale.id } },
          customer: { connect: { id: sale.customerId } },
          requestingAgent: { connect: { id } },
        },
      });

      await this.prisma.device.updateMany({
        where: {
          id: { in: deviceIds },
          installationStatus: InstallationStatus.not_installed,
        },
        data: {
          installationStatus: InstallationStatus.ready_for_installation,
        },
      });
    } else {
      if (task.status === TaskStatus.COMPLETED) {
        await this.prisma.device.updateMany({
          where: {
            id: { in: deviceIds },
            // installationStatus: { not: InstallationStatus.not_installed },
          },
          data: {
            installationStatus: InstallationStatus.installed,
            gpsVerified: true,
          },
        });
      }
    }

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

        fetchFormat === 'used'
          ? {
              isUsed: true,
            }
          : fetchFormat === 'unused'
            ? {
                isUsed: false,
              }
            : {},
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

  private async generateAndSendTokensForDevice(
    device: any,
    sale: any,
    paymentMode: PaymentMode,
  ): Promise<any> {
    try {
      let tokenDuration: number;

      if (paymentMode === PaymentMode.ONE_OFF) {
        tokenDuration = -1;
      } else {
        const installmentInfo = this.calculateInstallmentProgress(sale, 0);

        tokenDuration =
          installmentInfo.monthsCovered == -1
            ? installmentInfo.monthsCovered
            : installmentInfo.monthsCovered * 30;
      }

      const tokenResult = await this.openPayGo.generateToken(
        device,
        tokenDuration,
        Number(device.count),
      );

      await this.prisma.device.update({
        where: { id: device.id },
        data: {
          count: String(tokenResult.newCount),
        },
      });

      await this.prisma.tokens.create({
        data: {
          deviceId: device.id,
          token: String(tokenResult.finalToken),
          duration: tokenDuration,
          creatorId: sale.creatorId,
          tokenReleased: true,
        },
      });

      return {
        deviceSerialNumber: device.serialNumber,
        deviceKey: device.key,
        deviceToken: String(tokenResult.finalToken),
      };
    } catch (error) {
      console.error(
        `Failed to generate token for device ${device.serialNumber}:`,
        error,
      );
      return null;
    }
  }

  calculateInstallmentProgress(sale: any, paymentAmount: number) {
    // const currentTotalPaid = sale.totalPaid - sale.totalMiscellaneousPrice;
    const currentTotalPaid = sale.totalPaid;
    // const newTotalPaid = currentTotalPaid + paymentAmount;
    const newTotalPaid = currentTotalPaid;
    const totalPrice = sale.totalPrice;
    const monthlyPayment = sale.totalMonthlyPayment;
    const currentRemainingDuration = sale.remainingInstallments || 0;
    const originalDuration = sale.totalInstallmentDuration || 0;

    if (sale.totalMonthlyPayment === 0 && paymentAmount >= totalPrice) {
      return {
        newStatus: SalesStatus.COMPLETED,
        newRemainingDuration: 0,
        monthsCovered: -1,
      };
    }

    if (
      sale.installmentStartingPrice > 0 &&
      sale.totalPaid === sale.installmentStartingPrice &&
      sale.totalPaid > 0
      // &&
      // currentRemainingDuration === originalDuration
    ) {
      return {
        newStatus: SalesStatus.IN_INSTALLMENT,
        newRemainingDuration: currentRemainingDuration - 1,
        monthsCovered: 1,
      };
    }

    if (newTotalPaid >= totalPrice) {
      return {
        newStatus: SalesStatus.COMPLETED,
        newRemainingDuration: 0,
        monthsCovered: -1, // Forever token
      };
    }

    if (monthlyPayment <= 0) {
      return {
        newStatus:
          newTotalPaid >= totalPrice
            ? SalesStatus.COMPLETED
            : SalesStatus.UNPAID,
        newRemainingDuration: currentRemainingDuration,
        monthsCovered: 0,
      };
    }

    const totalMonthsCoveredByAllPayments = Math.floor(
      newTotalPaid / monthlyPayment,
    );
    const previousMonthsCovered = Math.floor(currentTotalPaid / monthlyPayment);

    const monthsCoveredByThisPayment =
      totalMonthsCoveredByAllPayments - previousMonthsCovered;

    let newRemainingDuration = Math.max(
      0,
      originalDuration - totalMonthsCoveredByAllPayments,
    );

    const remainingBalance = totalPrice - newTotalPaid;
    if (remainingBalance <= monthlyPayment && remainingBalance > 0) {
      newRemainingDuration = Math.min(newRemainingDuration, 1);
    }

    const newStatus =
      newRemainingDuration === 0
        ? SalesStatus.COMPLETED
        : SalesStatus.IN_INSTALLMENT;

    return {
      newStatus,
      newRemainingDuration,
      monthsCovered: monthsCoveredByThisPayment,
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
