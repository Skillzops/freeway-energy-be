import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DataMappingService } from './data-mapping.service';
import { DefaultsGeneratorService } from './defaults-generator.service';
import { FileParserService } from './file-parser.service';
import { v4 as uuidv4 } from 'uuid';
import {
  ProcessCsvDto,
  ValidationResultDto,
  CsvUploadResponseDto,
  CsvUploadStatsDto,
  SalesRowDto,
} from './dto/csv-upload.dto';
import { PaymentMode } from '@prisma/client';
import { CloudinaryService } from 'src/cloudinary/cloudinary.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

interface ProcessingSession {
  id: string;
  fileInfo: {
    name: string;
    size: number;
    type: string;
  };
  data: SalesRowDto[];
  stats: CsvUploadStatsDto;
  // batches: Array<{
  //   batchIndex: number;
  //   data: SalesRowDto[];
  //   status: 'pending' | 'processing' | 'completed' | 'failed';
  // }>;
  generatedDefaults: any;
  columnMapping: Map<string, string>;
  failedRecords: Array<{
    row: SalesRowDto;
    error: string;
    rowIndex: number;
  }>;
  createdEntities: {
    customers: string[];
    products: string[];
    sales: string[];
    contracts: string[];
    agents: string[];
  };
}

@Injectable()
export class CsvUploadService {
  private readonly logger = new Logger(CsvUploadService.name);
  private readonly sessions = new Map<string, ProcessingSession>();

  private readonly COLUMN_MAPPINGS = new Map([
    // Agent/Sales Person
    ['sales agent', 'salesAgent'],
    ['sales_agent', 'salesAgent'],
    ['agent', 'salesAgent'],

    // Customer Basic Info
    ['first name', 'firstName'],
    ['firstname', 'firstName'],
    ['first_name', 'firstName'],
    ['surname name', 'lastName'],
    ['surname', 'lastName'],
    ['last name', 'lastName'],
    ['lastname', 'lastName'],
    ['last_name', 'lastName'],

    // Contact Info
    ['phone number', 'phoneNumber'],
    ['phone_number', 'phoneNumber'],
    ['phone', 'phoneNumber'],
    ['mobile', 'phoneNumber'],
    ['alternate phone number', 'alternatePhoneNumber'],
    ['alternate_phone_number', 'alternatePhoneNumber'],
    ['alternate phone', 'alternatePhoneNumber'],
    ['alternate_phone', 'alternatePhoneNumber'],

    // Address & Location
    ['installation address', 'installationAddress'],
    ['installation_address', 'installationAddress'],
    ['address', 'installationAddress'],
    ['lga', 'lga'],
    ['state', 'state'],
    ['latitude', 'latitude'],
    ['lat', 'latitude'],
    ['longitude', 'longitude'],
    ['longtitude', 'longitude'], // Handle misspelling
    ['lng', 'longitude'],
    ['long', 'longitude'],

    // Personal Details
    ['gender', 'gender'],
    ['sex', 'gender'],

    // ID Information
    ['type of i.d', 'idType'],
    ['type of i d', 'idType'],
    ['type_of_id', 'idType'],
    ['id type', 'idType'],
    ['id_type', 'idType'],
    ['id card number', 'idNumber'],
    ['id_card_number', 'idNumber'],
    ['id number', 'idNumber'],
    ['id_number', 'idNumber'],

    // File Uploads (URLs/References)
    ['upload passport', 'passportPhotoUrl'],
    ['upload_passport', 'passportPhotoUrl'],
    ['passport', 'passportPhotoUrl'],
    ['upload id card', 'idImageUrl'],
    ['upload_id_card', 'idImageUrl'],
    ['id card', 'idImageUrl'],
    ['upload signed copy of contract form', 'contractFormImageUrl'],
    ['upload_signed_copy_of_contract_form', 'contractFormImageUrl'],
    ['signed contract', 'contractFormImageUrl'],
    ['contract form', 'contractFormImageUrl'],

    // Customer Category
    ['customer category', 'customerCategory'],
    ['customer_category', 'customerCategory'],
    ['category', 'customerCategory'],

    // Guarantor Info
    ["guarantor's name", 'guarantorName'],
    ['guarantor s name', 'guarantorName'],
    ['guarantors name', 'guarantorName'],
    ['guarantor_name', 'guarantorName'],
    ['guarantor name', 'guarantorName'],
    ["guarantor's number", 'guarantorNumber'],
    ['guarantor s number', 'guarantorNumber'],
    ['guarantors number', 'guarantorNumber'],
    ['guarantor_number', 'guarantorNumber'],
    ['guarantor number', 'guarantorNumber'],

    // Product & Payment
    ['product type', 'productType'],
    ['product_type', 'productType'],
    ['product', 'productType'],
    ['payment option', 'paymentOption'],
    ['payment_option', 'paymentOption'],
    ['payment mode', 'paymentOption'],
    ['initial deposit', 'initialDeposit'],
    ['initial_deposit', 'initialDeposit'],
    ['deposit', 'initialDeposit'],

    ['period of payment', 'paymentPeriod'],
    ['payment period', 'paymentPeriod'],
    ['period_of_payment', 'paymentPeriod'],

    ['payment type', 'paymentType'],
    ['payment_type', 'paymentType'],

    ['total payment', 'totalPayment'],
    ['total_payment', 'totalPayment'],
    ['total amount', 'totalPayment'],

    // Device Info
    ['serial number', 'serialNumber'],
    ['serial_number', 'serialNumber'],
    ['serial', 'serialNumber'],

    // Installation & Date
    ['installer name', 'installerName'],
    ['installer_name', 'installerName'],
    ['installer', 'installerName'],
    ['date of registration', 'dateOfRegistration'],
    ['date_of_registration', 'dateOfRegistration'],
    ['registration date', 'dateOfRegistration'],
    ['date', 'dateOfRegistration'],
  ]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dataMappingService: DataMappingService,
    private readonly defaultsGenerator: DefaultsGeneratorService,
    private readonly fileParser: FileParserService,
    private readonly cloudinary: CloudinaryService,
    @InjectQueue('csv-processing') private readonly csvQueue: Queue,
  ) {
    // Start cleanup interval for old sessions
    // setInterval(() => this.cleanupOldSessions(), 60 * 60 * 1000); // Every hour
  }

  async validateSalesFile(
    file: Express.Multer.File,
  ): Promise<ValidationResultDto> {
    try {
      this.logger.log(`Validating sales file: ${file.originalname}`);

      // Parse file to extract data and headers
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
          sampleData: [],
          detectedColumns: headers,
        };
      }

      // Perform column mapping and validation
      const columnMapping = this.mapColumns(headers);
      const validation = this.validateSalesColumns(columnMapping, headers);

      // Get sample data (first 3 rows)
      //   const sampleData = data
      //     .slice(0, 3)
      //     .map((row) => this.transformRowWithMapping(row, columnMapping));

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
        // sampleData,
        detectedColumns: headers,
        // requiredColumns: this.getRequiredColumns(),
        // optionalColumns: this.getOptionalColumns(),
      };
    } catch (error) {
      this.logger.error('Error validating sales file', error);
      throw new BadRequestException(
        `Failed to validate file: ${error.message}`,
      );
    }
  }

  async processSalesFile(
    file: Express.Multer.File,
    processCsvDto: ProcessCsvDto,
    sessionUserId: string,
  ): Promise<CsvUploadResponseDto> {
    const sessionId = uuidv4();
    this.logger.log(`Starting sales file processing session: ${sessionId}`);

    try {
      // Parse file
      const { data, headers } = await this.fileParser.parseSalesFile(file);

      if (!data || data.length === 0) {
        throw new BadRequestException('File contains no readable sales data');
      }

      // Validate if not skipped
      if (!processCsvDto.skipValidation) {
        const validation = await this.validateSalesFile(file);
        if (!validation.isValid) {
          throw new BadRequestException(
            `File validation failed: ${validation.errors.join(', ')}`,
          );
        }
      }

      // Generate defaults and setup mapping
      const generatedDefaults =
        await this.defaultsGenerator.generateDefaults(sessionUserId);
      const columnMapping = this.mapColumns(headers);

      // Transform data using column mapping
      const transformedData = data.map((row) =>
        this.transformRowWithMapping(row, columnMapping),
      );

      // Create processing session
      const session = await this.createProcessingSession(
        sessionId,
        file,
        transformedData,
        generatedDefaults,
        columnMapping,
        // processCsvDto.batchSize || 50,
      );

      await this.queueRowProcessingJobs(
        sessionId,
        transformedData,
        generatedDefaults,
      );

      return {
        sessionId,
        success: true,
        message: `Sales file processing started. ${session.stats.totalRecords} records queued for processing.`,
        stats: session.stats,
      };
    } catch (error) {
      this.logger.error(
        `Error processing sales file in session ${sessionId}`,
        error,
      );
      throw new BadRequestException(`Failed to process file: ${error.message}`);
    }
  }

  private async queueRowProcessingJobs(
    sessionId: string,
    data: SalesRowDto[],
    generatedDefaults: any,
  ): Promise<void> {
    const jobs = data.map((rowData, index) => ({
      name: 'process-sales-row',
      data: {
        sessionId,
        rowData,
        rowIndex: index,
        generatedDefaults,
      },
      opts: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    }));

    await this.csvQueue.addBulk(jobs);
    this.logger.log(`Queued ${jobs.length} jobs for session ${sessionId}`);
  }

  async updateSessionProgress(
    sessionId: string,
    update: {
      processed: boolean;
      success: boolean;
      result?: any;
      error?: string;
      rowData?: any;
      rowIndex?: number;
    },
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.logger.warn(`Session ${sessionId} not found for progress update`);
      return;
    }

    if (update.processed) {
      session.stats.processedRecords++;

      if (update.success && update.result) {
        // Update success stats based on result
        if (update.result.customerCreated)
          session.stats.breakdown.customers.created++;
        if (update.result.customerUpdated)
          session.stats.breakdown.customers.updated++;
        if (update.result.productCreated)
          session.stats.breakdown.products.created++;
        if (update.result.saleCreated) session.stats.breakdown.sales.created++;
        if (update.result.contractCreated)
          session.stats.breakdown.contracts.created++;
        if (update.result.agentCreated)
          session.stats.breakdown.agents.created++;
        if (update.result.deviceCreated)
          session.stats.breakdown.devices.created++;
      } else if (!update.success) {
        session.stats.errorRecords++;
        session.failedRecords.push({
          row: update.rowData,
          error: update.error || 'Unknown error',
          rowIndex: update.rowIndex || 0,
        });

        session.stats.errors.push({
          row: (update.rowIndex || 0) + 1,
          field: 'general',
          message: update.error || 'Unknown error',
          data: update.rowData,
        });
      }

      // Update progress percentage
      session.stats.progressPercentage = Math.round(
        (session.stats.processedRecords / session.stats.totalRecords) * 100,
      );

      // Update status
      if (session.stats.processedRecords >= session.stats.totalRecords) {
        session.stats.status = 'completed';
        session.stats.endTime = new Date();
        this.logger.log(
          `Session ${sessionId} completed. Processed: ${session.stats.processedRecords}/${session.stats.totalRecords}`,
        );
      } else {
        session.stats.status = 'processing';
      }
    }
  }

  async getUploadStats(sessionId: string): Promise<CsvUploadStatsDto> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new BadRequestException('Session not found');
    }

    return session.stats;
  }

  private mapColumns(headers: string[]): Map<string, string> {
    const mapping = new Map<string, string>();

    for (const header of headers) {
      const normalizedHeader = header.toLowerCase().trim();
      const mappedField = this.COLUMN_MAPPINGS.get(normalizedHeader);

      if (mappedField) {
        mapping.set(header, mappedField);
      } else {
        // Try partial matching for unmapped columns
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

  private validateSalesColumns(
    columnMapping: Map<string, string>,
    headers: string[],
  ): { errors: string[]; warnings: string[] } {
    const errors: string[] = [];
    const warnings: string[] = [];
    const requiredFields = this.getRequiredColumns();
    const mappedFields = new Set(columnMapping.values());

    // Check for required columns
    for (const required of requiredFields) {
      if (!mappedFields.has(required)) {
        errors.push(`Required column missing: ${required}`);
      }
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

  private getRequiredColumns(): string[] {
    return [
      'firstName',
      'lastName',
      'phoneNumber',
      'installationAddress',
      'productType',
      'paymentOption',
      'serialNumber',
      'dateOfRegistration',
    ];
  }

  private transformRowWithMapping(
    row: any,
    columnMapping: Map<string, string>,
  ): SalesRowDto {
    const transformed: any = {};

    for (const [originalColumn, mappedField] of columnMapping.entries()) {
      if (row[originalColumn] !== undefined && row[originalColumn] !== null) {
        transformed[mappedField] = this.cleanValue(row[originalColumn]);
      }
    }

    return transformed as SalesRowDto;
  }

  private cleanValue(value: any): any {
    if (typeof value === 'string') {
      return value.trim();
    }
    return value;
  }

  private async createProcessingSession(
    sessionId: string,
    fileInfo: any,
    data: SalesRowDto[],
    generatedDefaults: any,
    columnMapping: Map<string, string>,
  ): Promise<ProcessingSession> {
    const session: ProcessingSession = {
      id: sessionId,
      fileInfo:
        typeof fileInfo === 'object' && 'originalname' in fileInfo
          ? {
              name: fileInfo.originalname,
              size: fileInfo.size,
              type: fileInfo.mimetype,
            }
          : fileInfo,
      data,
      // batches: [],
      generatedDefaults,
      columnMapping,
      failedRecords: [],
      createdEntities: {
        customers: [],
        products: [],
        sales: [],
        contracts: [],
        agents: [],
      },
      stats: {
        sessionId,
        totalRecords: data.length,
        processedRecords: 0,
        errorRecords: 0,
        skippedRecords: 0,
        progressPercentage: 0,
        status: 'pending',
        breakdown: {
          customers: { created: 0, updated: 0, errors: 0 },
          products: { created: 0, updated: 0, errors: 0 },
          sales: { created: 0, updated: 0, errors: 0 },
          contracts: { created: 0, updated: 0, errors: 0 },
          agents: { created: 0, updated: 0, errors: 0 },
          devices: { created: 0, updated: 0, errors: 0 },
        },
        errors: [],
        startTime: new Date(),
      },
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  async processSalesRow(
    row: SalesRowDto,
    generatedDefaults: any,
    rowIndex: number,
  ): Promise<void> {
    // Transform the row data to database entities
    const transformedData =
      await this.dataMappingService.transformSalesRowToEntities(
        row,
        generatedDefaults,
      );

    // Process each entity in proper order (dependencies first)

    // 1. Create or find agent
    // let agent = null;
    // if (transformedData.agentData) {
    //   agent = await this.createOrFindAgent(
    //     transformedData.agentData,
    //     generatedDefaults,
    //   );
    // }

    // 2. Create or find customer
    const customer = await this.createOrFindCustomer(
      transformedData.customerData,
      generatedDefaults,
      // agent?.id,
    );

    // 3. Create or find product
    const product = await this.createOrFindProduct(
      transformedData.productData,
      generatedDefaults,
    );

    // 4. Create inventory and device if needed
    const { inventory, device } = await this.createInventoryAndDevice(
      transformedData.inventoryData,
      transformedData.deviceData,
      generatedDefaults,
    );

    // 5. Create contract if needed
    let contract = null;
    if (transformedData.contractData) {
      contract = await this.createContract(transformedData.contractData);
    }

    // 6. Create sale with all relationships
    const sale = await this.createSale(
      transformedData.saleData,
      customer.id,
      product.id,
      inventory?.id,
      device?.id,
      contract?.id,
      generatedDefaults,
      transformedData.agentData.fullname,
    );

    // 7. Create initial payment if there's a deposit
    if (transformedData.paymentData) {
      await this.createPayment(
        transformedData.paymentData,
        sale.id,
        generatedDefaults,
      );
    }

    this.logger.debug(`Successfully processed sales row ${rowIndex + 1}`);
  }

  private async createOrFindAgent(
    agentData: any,
    generatedDefaults: any,
  ): Promise<any> {
    try {
      // First, try to find existing user by name or create one
      let user = await this.prisma.user.findFirst({
        where: {
          OR: [
            { username: agentData.username },
            {
              AND: [
                { firstname: agentData.firstname },
                { lastname: agentData.lastname },
              ],
            },
          ],
        },
        include: { agentDetails: true },
      });

      if (!user) {
        // Create user first
        user = await this.prisma.user.create({
          data: {
            ...agentData.userData,
            roleId: generatedDefaults.defaultRole.id,
          },
          include: { agentDetails: true },
        });
      }

      // Check if user has agent details, create if not
      if (!user.agentDetails) {
        const lastAgent = await this.prisma.agent.findFirst({
          orderBy: { agentId: 'desc' },
        });

        const nextAgentId = (lastAgent?.agentId || 0) + 1;

        const agent = await this.prisma.agent.create({
          data: {
            agentId: nextAgentId,
            userId: user.id,
          },
        });

        return { ...agent, user };
      }

      return user.agentDetails;
    } catch (error) {
      this.logger.error('Error creating/finding agent', error);
      throw error;
    }
  }

  private async createOrFindCustomer(
    customerData: any,
    generatedDefaults: any,
    agentId?: string,
  ): Promise<any> {
    try {
      // Try to find existing customer by phone or email
      let customer = await this.prisma.customer.findFirst({
        where: {
          OR: [{ phone: customerData.phone }, { email: customerData.email }],
          AND: [
            { firstname: customerData.firstname },
            { lastname: customerData.lastname },
          ],
        },
      });

      if (!customer) {
        const processedCustomerData = { ...customerData };

        // Upload images to Cloudinary if URLs are provided
        if (customerData.passportPhotoUrl) {
          const cloudinaryUrl = await this.cloudinary.uploadUrlToCloudinary(
            customerData.passportPhotoUrl,
            `${customerData.firstname}_${customerData.lastname}_passport`,
          );
          processedCustomerData.passportPhotoUrl = cloudinaryUrl;
        }

        if (customerData.idImageUrl) {
          const cloudinaryUrl = await this.cloudinary.uploadUrlToCloudinary(
            customerData.idImageUrl,
            `${customerData.firstname}_${customerData.lastname}_id`,
          );
          processedCustomerData.idImageUrl = cloudinaryUrl;
        }

        if (customerData.contractFormImageUrl) {
          const cloudinaryUrl = await this.cloudinary.uploadUrlToCloudinary(
            customerData.contractFormImageUrl,
            `${customerData.firstname}_${customerData.lastname}_contract`,
          );
          processedCustomerData.contractFormImageUrl = cloudinaryUrl;
        }

        customer = await this.prisma.customer.create({
          data: {
            ...processedCustomerData,
            creatorId: generatedDefaults.defaultUser.id || agentId,
            agentId: agentId,
          },
        });

        this.logger.debug(
          `Created new customer: ${customer.firstname} ${customer.lastname}`,
        );
      } else {
        // Update customer with any new information

        const updateData: any = {
          installationAddress:
            customer.installationAddress || customerData.installationAddress,
          lga: customer.lga || customerData.lga,
          state: customer.state || customerData.state,
          latitude: customer.latitude || customerData.latitude,
          longitude: customer.longitude || customerData.longitude,
          gender: customer.gender || customerData.gender,
          idType: customer.idType || customerData.idType,
          idNumber: customer.idNumber || customerData.idNumber,
          passportPhotoUrl:
            customer.passportPhotoUrl || customerData.passportPhotoUrl,
          idImageUrl: customer.idImageUrl || customerData.idImageUrl,
        };

        if (!customer.passportPhotoUrl && customerData.passportPhotoUrl) {
          const cloudinaryUrl = await this.cloudinary.uploadUrlToCloudinary(
            customerData.passportPhotoUrl,
            `${customer.firstname}_${customer.lastname}_passport`,
          );
          if (cloudinaryUrl) updateData.passportPhotoUrl = cloudinaryUrl;
        }

        if (!customer.idImageUrl && customerData.idImageUrl) {
          const cloudinaryUrl = await this.cloudinary.uploadUrlToCloudinary(
            customerData.idImageUrl,
            `${customer.firstname}_${customer.lastname}_id`,
          );
          if (cloudinaryUrl) updateData.idImageUrl = cloudinaryUrl;
        }

        if (
          !customer.contractFormImageUrl &&
          customerData.contractFormImageUrl
        ) {
          const cloudinaryUrl = await this.cloudinary.uploadUrlToCloudinary(
            customerData.contractFormImageUrl,
            `${customer.firstname}_${customer.lastname}_contract`,
          );
          if (cloudinaryUrl) updateData.contractFormImageUrl = cloudinaryUrl;
        }

        customer = await this.prisma.customer.update({
          where: { id: customer.id },
          data: updateData,
        });

        this.logger.debug(
          `Updated existing customer: ${customer.firstname} ${customer.lastname}`,
        );
      }

      return customer;
    } catch (error) {
      this.logger.error('Error creating/finding customer', error);
      throw error;
    }
  }

  private async createOrFindProduct(
    productData: any,
    generatedDefaults: any,
  ): Promise<any> {
    try {
      let product = await this.prisma.product.findFirst({
        where: {
          name: {
            equals: productData.name,
            mode: 'insensitive',
          },
        },
      });

      if (!product) {
        product = await this.prisma.product.create({
          data: {
            ...productData,
            categoryId: generatedDefaults.categories.product.id,
            creatorId: generatedDefaults.defaultUser.id,
          },
        });

        this.logger.debug(`Created new product: ${product.name}`);
      }

      return product;
    } catch (error) {
      this.logger.error('Error creating/finding product', error);
      throw error;
    }
  }

  private async createInventoryAndDevice(
    inventoryData: any,
    deviceData: any,
    generatedDefaults: any,
  ): Promise<{ inventory: any; device: any }> {
    try {
      let inventory = null;
      let device = null;

      // Create inventory if data provided
      if (inventoryData) {
        inventory = await this.prisma.inventory.findFirst({
          where: {
            name: {
              equals: inventoryData.name,
              mode: 'insensitive',
            },
          },
        });

        const { price, costOfItem, ...rest } = inventoryData;

        if (!inventory) {
          inventory = await this.prisma.inventory.create({
            data: {
              ...rest,
              inventoryCategoryId: generatedDefaults.categories.inventory.id,
            },
          });
        }

        // Create inventory batch
        await this.prisma.inventoryBatch.create({
          data: {
            inventoryId: inventory.id,
            price: price,
            costOfItem: costOfItem || 0,
            batchNumber: Date.now() - 100,
            numberOfStock: 1,
            remainingQuantity: 0, // Will be reduced when sold
            creatorId: generatedDefaults.defaultUser.id,
          },
        });
      }

      // Create device if serial number provided
      if (deviceData && deviceData.serialNumber) {
        device = await this.prisma.device.findUnique({
          where: { serialNumber: deviceData.serialNumber },
        });

        if (!device) {
          device = await this.prisma.device.create({
            data: {
              ...deviceData,
              creatorId: generatedDefaults.defaultUser.id as string,
            },
          });

          this.logger.debug(`Created new device: ${device.serialNumber}`);
        }
      }

      return { inventory, device };
    } catch (error) {
      this.logger.error('Error creating inventory/device', error);
      throw error;
    }
  }

  private async createContract(contractData: any): Promise<any> {
    try {
      const contract = await this.prisma.contract.create({
        data: contractData,
      });

      this.logger.debug(`Created contract: ${contract.id}`);

      return contract;
    } catch (error) {
      this.logger.error('Error creating contract', error);
      throw error;
    }
  }

  private async createSale(
    saleData: any,
    customerId: string,
    productId: string,
    inventoryId?: string,
    deviceId?: string,
    contractId?: string,
    generatedDefaults?: any,
    agentName?: string,
  ): Promise<any> {
    try {
      const { paymentMode, miscellaneousPrices, ...rest } = saleData;
      // Create sale
      const sale = await this.prisma.sales.create({
        data: {
          ...rest,
          agentName,
          customerId,
          contractId,
          creatorId: generatedDefaults.defaultUser.id,
        },
      });

      // Create sale item
      const saleItem = await this.prisma.saleItem.create({
        data: {
          saleId: sale.id,
          productId,
          quantity: 1,
          totalPrice: saleData.totalPrice,
          monthlyPayment: saleData.totalMonthlyPayment || 0,
          installmentDuration: saleData.totalInstallmentDuration || 0,
          installmentStartingPrice: saleData.totalPaid || 0,
          miscellaneousPrices,
          paymentMode: paymentMode || PaymentMode.ONE_OFF,
          deviceIDs: deviceId ? [deviceId] : [],
        },
      });

      // Connect device to sale item if exists
      if (deviceId) {
        await this.prisma.device.update({
          where: { id: deviceId },
          data: {
            isUsed: true,
            saleItemIDs: { push: saleItem.id },
          },
        });
      }

      // Create product-inventory relationship if needed
      if (inventoryId) {
        const existingRelation = await this.prisma.productInventory.findFirst({
          where: {
            productId,
            inventoryId,
          },
        });

        if (!existingRelation) {
          await this.prisma.productInventory.create({
            data: {
              productId,
              inventoryId,
              quantity: 1,
            },
          });
        }
      }

      this.logger.debug(`Created sale: ${sale.id}`);

      return sale;
    } catch (error) {
      this.logger.error('Error creating sale', error);
      throw error;
    }
  }

  private async createPayment(
    paymentData: any,
    saleId: string,
    generatedDefaults: any,
  ): Promise<any> {
    try {
      const payment = await this.prisma.payment.create({
        data: {
          ...paymentData,
          transactionRef: `sale-${saleId}-${Date.now()}`,
          saleId,
          recordedById: generatedDefaults.defaultUser.id,
        },
      });

      // Update sale's total paid amount
      //   await this.prisma.sales.update({
      //     where: { id: saleId },
      //     data: {
      //       totalPaid: {
      //         increment: paymentData.amount,
      //       },
      //     },
      //   });

      this.logger.debug(`Created payment: ${payment.id} for sale: ${saleId}`);
      return payment;
    } catch (error) {
      this.logger.error('Error creating payment', error);
      throw error;
    }
  }

  private async rollbackCreatedEntities(
    session: ProcessingSession,
  ): Promise<boolean> {
    try {
      // Rollback in reverse order of creation

      // Delete sales (this will cascade to sale items)
      if (session.createdEntities.sales.length > 0) {
        await this.prisma.sales.deleteMany({
          where: {
            id: { in: session.createdEntities.sales },
          },
        });
      }

      // Delete contracts
      if (session.createdEntities.contracts.length > 0) {
        await this.prisma.contract.deleteMany({
          where: {
            id: { in: session.createdEntities.contracts },
          },
        });
      }

      // Delete products
      if (session.createdEntities.products.length > 0) {
        await this.prisma.product.deleteMany({
          where: {
            id: { in: session.createdEntities.products },
          },
        });
      }

      // Delete customers
      if (session.createdEntities.customers.length > 0) {
        await this.prisma.customer.deleteMany({
          where: {
            id: { in: session.createdEntities.customers },
          },
        });
      }

      // Delete agents
      if (session.createdEntities.agents.length > 0) {
        await this.prisma.agent.deleteMany({
          where: {
            userId: { in: session.createdEntities.agents },
          },
        });

        await this.prisma.user.deleteMany({
          where: {
            id: { in: session.createdEntities.agents },
          },
        });
      }

      this.logger.log(`Rollback completed for session ${session.id}`);
      return true;
    } catch (error) {
      this.logger.error(
        `Error during rollback for session ${session.id}`,
        error,
      );
      return false;
    }
  }

  private cleanupOldSessions(): void {
    const fourHoursAgo = new Date(Date.now() - 4 * 60 * 60 * 1000);

    for (const [sessionId, session] of this.sessions.entries()) {
      if (
        session.stats.startTime < fourHoursAgo &&
        (session.stats.status === 'completed' ||
          session.stats.status === 'failed' ||
          session.stats.status === 'cancelled')
      ) {
        this.sessions.delete(sessionId);
        this.logger.log(`Cleaned up old session: ${sessionId}`);
      }
    }
  }
}
