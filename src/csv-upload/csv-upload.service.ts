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
import { AgentCategory, InstallationStatus, PaymentMethod, PaymentMode, PaymentStatus, TaskStatus } from '@prisma/client';
import { CloudinaryService } from 'src/cloudinary/cloudinary.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { hashPassword } from 'src/utils/helpers.util';
import { generateRandomPassword } from 'src/utils/generate-pwd';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ReferenceGeneratorService } from 'src/payment/reference-generator.service';
import { EmailService } from 'src/mailer/email.service';

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

export interface CreatedAgentInfo {
  id: string;
  agentId: number;
  email: string;
  password: string; // Plain text password for file generation
  firstname: string;
  lastname: string;
  username: string;
  salesAssigned: number;
  category?: AgentCategory;
}

@Injectable()
export class CsvUploadService {
  private readonly logger = new Logger(CsvUploadService.name);
  private readonly sessions = new Map<string, ProcessingSession>();
  private readonly newAgentsCredentials = new Map<string, CreatedAgentInfo[]>();
  private readonly referenceGenerator: ReferenceGeneratorService;

  private readonly COLUMN_MAPPINGS = new Map([
    // Agent/Sales Person
    ['sales agent', 'salesAgent'],
    ['sales_agent', 'salesAgent'],
    ['sales_agent_name', 'salesAgent'],
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
    ['type of id', 'idType'],
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
    ['initial_deposit_paid', 'initialDeposit'],
    ['deposit', 'initialDeposit'],

    ['period of payment', 'paymentPeriod'],
    ['payment period', 'paymentPeriod'],
    ['period_of_payment', 'paymentPeriod'],

    ['payment type', 'paymentType'],
    ['payment_type', 'paymentType'],
    // ['payment_option', 'paymentType'], //to be updated based on sheet format

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

    ['payment plan', 'paymentPlan'],
    ['payment_plan', 'paymentPlan'],

    ['activation date', 'timestamp'],
    ['activation_date', 'timestamp'],
    ['timestamp', 'timestamp'],
    ['middle name', 'middleName'],
    ['middlename', 'middleName'],
    ['middle_name', 'middleName'],
    ['upload all images', 'uploadAllImages'],
    ['upload_all_images', 'uploadAllImages'],
    ['token sent', 'tokenSent'],
    ['token_sent', 'tokenSent'],
    ['sales agent name', 'salesAgent'],
    ['sales_agent_name', 'salesAgent'],
  ]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dataMappingService: DataMappingService,
    private readonly defaultsGenerator: DefaultsGeneratorService,
    private readonly fileParser: FileParserService,
    private readonly cloudinary: CloudinaryService,
    private readonly emailService: EmailService,
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
      const { data, headers } = await this.fileParser.parseSalesFile(file);

      if (!data || data.length === 0) {
        throw new BadRequestException('File contains no readable sales data');
      }

      if (!processCsvDto.skipValidation) {
        const validation = await this.validateSalesFile(file);
        if (!validation.isValid) {
          throw new BadRequestException(
            `File validation failed: ${validation.errors.join(', ')}`,
          );
        }
      }

      const generatedDefaults =
        await this.defaultsGenerator.generateDefaults(sessionUserId);
      const columnMapping = this.mapColumns(headers);
      const transformedData = data.map((row) =>
        this.transformRowWithMapping(row, columnMapping),
      );

      // Initialize new agents tracking
      this.newAgentsCredentials.set(sessionId, []);

      const session = await this.createProcessingSession(
        sessionId,
        file,
        transformedData,
        generatedDefaults,
        columnMapping,
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
        isLastJob: index === data.length - 1,
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

    const stats = { ...session.stats };

    const newAgents = this.newAgentsCredentials.get(sessionId) || [];
    stats.newAgentsCount = newAgents.length;

    if (newAgents.length > 0) {
      stats.newAgentsSummary = newAgents.map((agent) => ({
        name: `${agent.firstname} ${agent.lastname}`,
        username: agent.username,
        salesCount: agent.salesAssigned,
      }));
    }

    return stats;
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
    const requiredFields = [
      'firstName',
      'lastName',
      'phoneNumber',
      'productType',
      'serialNumber',
    ];
    const mappedFields = new Set(columnMapping.values());

    // Check for required columns
    for (const required of requiredFields) {
      if (!mappedFields.has(required)) {
        errors.push(`Required column missing: ${required}`);
      }
    }

    // Specific validations for your CSV structure
    if (!mappedFields.has('timestamp')) {
      warnings.push(
        'Timestamp column not found - will use current date for all records',
      );
    }

    if (!mappedFields.has('salesAgent')) {
      warnings.push(
        'Sales Agent column not found - sales will not be assigned to specific agents',
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
    sessionId?: string,
  ): Promise<any> {
    const transformedData =
      await this.dataMappingService.transformSalesRowToEntities(
        row,
        generatedDefaults,
      );

    let agent = null;
    let isNewAgent = false;
    if (transformedData.agentData) {
      const agentResult = await this.createOrFindAgent(
        transformedData.agentData,
        generatedDefaults,
        sessionId,
        AgentCategory.SALES,
        false,
      );
      agent = agentResult.agent;
      isNewAgent = agentResult.isNewAgent;
    }

    let installer = null;
    let isNewInstaller = false;
    if (transformedData.installerData) {
      const installerResult = await this.createOrFindAgent(
        transformedData.installerData,
        generatedDefaults,
        sessionId,
        AgentCategory.INSTALLER,
        true,
      );
      installer = installerResult.agent;
      isNewInstaller = installerResult.isNewAgent;
    }

    if (agent && installer) {
      await this.createInstallerAssignment(
        agent.id,
        installer.id,
        generatedDefaults.defaultUser.id,
      );
    }

    // 2. Create or find customer
    const customer = await this.createOrFindCustomer(
      transformedData.customerData,
      generatedDefaults,
      agent?.id,
    );

    // 3. Create or find product
    const product = await this.createOrFindProduct(
      transformedData.productData,
      generatedDefaults,
      agent?.id,
    );

    // 4. Create inventory and device with smart mapping
    const { inventory, device } = await this.createInventoryAndDevice(
      transformedData.inventoryData,
      transformedData.deviceData,
      generatedDefaults,
      customer,
      product,
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
      transformedData.agentData?.fullname,
      agent?.userId,
    );

    // 7. Create initial payment if there's a deposit
    if (transformedData.paymentData) {
      await this.createPayment(
        transformedData.paymentData,
        sale.id,
        generatedDefaults,
      );
    }

    // 8. Create installer task if installer exists - NEW
    let installerTask = null;
    if (installer && agent && sale) {
      installerTask = await this.createInstallerTask({
        installerAgentId: installer.id,
        requestingAgentId: agent.id,
        saleId: sale.id,
        customerId: customer.id,
        description: `Installation task for ${product.name}`,
        installationAddress: customer.installationAddress,
        scheduledDate: transformedData.saleData?.createdAt || new Date(),
        assignedBy: generatedDefaults.defaultUser.id,
        // Mark as completed since this is historical data
        status: TaskStatus.COMPLETED,
        completedDate: transformedData.saleData?.createdAt || new Date(),
        acceptedAt: transformedData.saleData?.createdAt || new Date(),
      });
    }

    // 9. Update agent credentials tracking
    if (isNewAgent && sessionId) {
      await this.updateNewAgentCredentials(sessionId, agent.id, sale.id);
    }

    if (isNewInstaller && sessionId) {
      await this.updateNewAgentCredentials(sessionId, installer.id, sale.id);
    }

    this.logger.debug(`Successfully processed sales row ${rowIndex + 1}`);

    return {
      customerCreated: true,
      productCreated: true,
      saleCreated: true,
      contractCreated: !!contract,
      agentCreated: isNewAgent,
      installerCreated: isNewInstaller,
      deviceCreated: !!device,
      installerTaskCreated: !!installerTask,
    };
  }

  private async createInstallerAssignment(
    agentId: string,
    installerId: string,
    assignedBy: string,
  ): Promise<void> {
    try {
      const existingAssignment =
        await this.prisma.agentInstallerAssignment.findFirst({
          where: { agentId, installerId },
        });

      if (!existingAssignment) {
        await this.prisma.agentInstallerAssignment.create({
          data: {
            agentId,
            installerId,
            assignedBy,
          },
        });
      }
    } catch (error) {
      this.logger.error('Error creating installer assignment', error);
    }
  }

  private async createInstallerTask(taskData: any): Promise<any> {
    try {
      const installerTask = await this.prisma.installerTask.create({
        data: {
          ...taskData,
        },
      });

      this.logger.debug(`Created installer task: ${installerTask.id}`);
      return installerTask;
    } catch (error) {
      this.logger.error('Error creating installer task', error);
      throw error;
    }
  }

  private async updateNewAgentCredentials(
    sessionId: string,
    agentUserId: string,
    saleId: string,
  ): Promise<void> {
    console.log({ saleId });
    const agentCredentials = this.newAgentsCredentials.get(sessionId) || [];
    const credentialIndex = agentCredentials.findIndex(
      (cred) => cred.id === agentUserId,
    );

    if (credentialIndex !== -1) {
      agentCredentials[credentialIndex].salesAssigned++;
    }
  }

  private async createOrFindAgent(
    agentData: any,
    generatedDefaults: any,
    sessionId?: string,
    category: AgentCategory = AgentCategory.SALES,
    forceUniqueForInstaller: boolean = false,
  ): Promise<{ agent: any; isNewAgent: boolean }> {
    try {
      let user = null;
      let isNewAgent = false;

      // FOR INSTALLERS: Always create separate accounts (no name-based searching)
      if (category === AgentCategory.INSTALLER || forceUniqueForInstaller) {
        console.log({ agentData, forceUniqueForInstaller });
        // Only check by username/email, NOT by name
        user = await this.prisma.user.findFirst({
          where: {
            OR: [
              { username: agentData.userData.username },
              { email: agentData.userData.email },
            ],
          },
          include: { agentDetails: true },
        });
      } else {
        // FOR SALES AGENTS: Keep the original logic (can match by name)
        user = await this.prisma.user.findFirst({
          where: {
            OR: [
              { username: agentData.userData.username },
              { email: agentData.userData.email },
              {
                AND: [
                  { firstname: agentData.userData.firstname },
                  { lastname: agentData.userData.lastname },
                ],
              },
            ],
          },
          include: { agentDetails: true },
        });
      }

      if (!user) {
        // Generate unique credentials for installers
        let userData = { ...agentData.userData };

        if (category === AgentCategory.INSTALLER) {
          // const parsedName = this.dataMappingService.parseFullName(
          //   agentData.fullname,
          // );
          // const baseUsername = this.dataMappingService.generateUsername(
          //   parsedName.firstname,
          //   parsedName.lastname,
          // );

          userData = {
            ...userData,
            // username: `${baseUsername}.installer`,
            // email: `${baseUsername}.installer@gmail.com`,
          };
        }

        const plainPassword = generateRandomPassword(12);
        const hashedPassword = await hashPassword(plainPassword);

        user = await this.prisma.user.create({
          data: {
            ...userData,
            password: hashedPassword,
            roleId: generatedDefaults.defaultAgentRole.id,
          },
          include: { agentDetails: true },
        });

        isNewAgent = true;

        // Store credentials for file generation
        if (sessionId) {
          const agentCredentials =
            this.newAgentsCredentials.get(sessionId) || [];
          agentCredentials.push({
            id: user.id,
            agentId: 0, // Will be updated when agent details are created
            email: user.email,
            password: plainPassword,
            firstname: user.firstname || '',
            lastname: user.lastname || '',
            username: user.username || '',
            salesAssigned: 0,
            category: category,
          });
          this.newAgentsCredentials.set(sessionId, agentCredentials);
        }
      }

      // Check if user has agent details for this category
      if (!user.agentDetails || user.agentDetails.category !== category) {
        // Create new agent record even if user exists
        const nextAgentId = Math.floor(10000000 + Math.random() * 90000000);

        const agent = await this.prisma.agent.create({
          data: {
            agentId: nextAgentId,
            userId: user.id,
            category: category,
          },
        });

        // Update agent ID in credentials if this is a new user
        if (isNewAgent && sessionId) {
          const agentCredentials =
            this.newAgentsCredentials.get(sessionId) || [];
          const credentialIndex = agentCredentials.findIndex(
            (cred) => cred.id === user.id,
          );
          if (credentialIndex !== -1) {
            agentCredentials[credentialIndex].agentId = nextAgentId;
          }
        }

        return { agent: { ...agent, user }, isNewAgent };
      }

      return { agent: user.agentDetails, isNewAgent };
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

        // Handle image uploads to Cloudinary
        const imageFields = [
          'passportPhotoUrl',
          'idImageUrl',
          'contractFormImageUrl',
        ];

        for (const field of imageFields) {
          if (customerData[field]) {
            try {
              const cloudinaryUrl = await this.cloudinary.uploadUrlToCloudinary(
                customerData[field],
                `${customerData.firstname}_${customerData.lastname}_${field}`,
              );
              if (cloudinaryUrl) {
                processedCustomerData[field] = cloudinaryUrl;
              }
            } catch (error) {
              this.logger.warn(
                `Failed to upload ${field} for customer ${customerData.firstname} ${customerData.lastname}:`,
                error,
              );
              // Continue without the image rather than failing the entire import
              processedCustomerData[field] = null;
            }
          }
        }

        customer = await this.prisma.customer.create({
          data: {
            ...processedCustomerData,
            creatorId: generatedDefaults.defaultUser.id,
            // Use timestamp from CSV
            createdAt: customerData.createdAt || new Date(),
            updatedAt: customerData.updatedAt || new Date(),
          },
        });

        this.logger.debug(
          `Created new customer: ${customer.firstname} ${customer.lastname}`,
        );
      } else {
        // Update customer with any new information and maintain original creation date
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
          updatedAt: new Date(), // Update the updated timestamp
        };

        // Handle image updates
        const imageFields = [
          'passportPhotoUrl',
          'idImageUrl',
          'contractFormImageUrl',
        ];

        for (const field of imageFields) {
          if (!customer[field] && customerData[field]) {
            try {
              const cloudinaryUrl = await this.cloudinary.uploadUrlToCloudinary(
                customerData[field],
                `${customer.firstname}_${customer.lastname}_${field}`,
              );
              if (cloudinaryUrl) {
                updateData[field] = cloudinaryUrl;
              }
            } catch (error) {
              this.logger.warn(
                `Failed to upload ${field} for customer ${customer.firstname} ${customer.lastname}:`,
                error,
              );
            }
          }
        }

        customer = await this.prisma.customer.update({
          where: { id: customer.id },
          data: updateData,
        });

        this.logger.debug(
          `Updated existing customer: ${customer.firstname} ${customer.lastname}`,
        );
      }

      if (agentId) {
        const existingAgentCustomer = await this.prisma.agentCustomer.findFirst(
          {
            where: {
              agentId,
              customerId: customer.id,
            },
          },
        );

        if (!existingAgentCustomer) {
          await this.prisma.agentCustomer.create({
            data: {
              agentId,
              customerId: customer.id,
              assignedBy: generatedDefaults.defaultUser.id,
            },
          });
        }
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
    agentId?: string,
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

      if (agentId) {
        const existingAgentProduct = await this.prisma.agentProduct.findFirst({
          where: {
            agentId,
            productId: product.id,
          },
        });

        if (!existingAgentProduct) {
          await this.prisma.agentProduct.create({
            data: {
              agentId,
              productId: product.id,
              assignedBy: generatedDefaults.defaultUser.id,
            },
          });
        }
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
    customer: any,
    product: any,
  ): Promise<{ inventory: any; device: any }> {
    try {
      let inventory = null;
      let device = null;

      if (inventoryData) {
        inventory = await this.prisma.inventory.findFirst({
          where: {
            name: { equals: inventoryData.name, mode: 'insensitive' },
          },
        });

        const { price, costOfItem, ...rest } = inventoryData;

        if (!inventory) {
          inventory = await this.prisma.inventory.create({
            data: {
              ...rest,
              hideInventory: true,
              inventoryCategoryId: generatedDefaults.categories.inventory.id,
            },
          });
        }

        await this.prisma.inventoryBatch.create({
          data: {
            inventoryId: inventory.id,
            price: price,
            costOfItem: costOfItem || 0,
            batchNumber: Date.now() - 100,
            numberOfStock: 1,
            remainingQuantity: 0,
            creatorId: generatedDefaults.defaultUser.id,
          },
        });
      }

      // Enhanced device creation with location mapping
      if (deviceData && deviceData.serialNumber) {
        device = await this.prisma.device.findUnique({
          where: { serialNumber: deviceData.serialNumber },
        });

        if (!device) {
          device = await this.prisma.device.create({
            data: {
              ...deviceData,
              installationLocation: customer.installationAddress || null,
              installationLatitude: customer.latitude || null,
              installationLongitude: customer.longitude || null,
              creatorId: generatedDefaults.defaultUser.id as string,
            },
          });

          this.logger.debug(
            `Created new device: ${device.serialNumber} for customer: ${customer.firstname} ${customer.lastname}`,
          );
        }
      }

      return { inventory, device };
    } catch (error) {
      this.logger.error('Error creating inventory/device', error);
      throw error;
    }
  }

  async generateAgentCredentialsFile(
    sessionId: string,
  ): Promise<string | null> {
    const agentCredentials = this.newAgentsCredentials.get(sessionId);

    if (!agentCredentials || agentCredentials.length === 0) {
      return null;
    }

    try {
      const fileName = `new_agents_${sessionId}_${Date.now()}.txt`;
      const filePath = path.join(
        process.cwd(),
        'uploads',
        'agent_credentials',
        fileName,
      );

      // Ensure directory exists
      await fs.mkdir(path.dirname(filePath), { recursive: true });

      const content = [
        '='.repeat(80),
        'NEWLY CREATED AGENT CREDENTIALS',
        `Session ID: ${sessionId}`,
        `Generated on: ${new Date().toISOString()}`,
        `Total New Agents: ${agentCredentials.length}`,
        '='.repeat(80),
        '',
        ...agentCredentials.map((agent, index) =>
          [
            `${index + 1}. Agent ID: ${agent.agentId}`,
            `   Name: ${agent.firstname} ${agent.lastname}`,
            `   Username: ${agent.username}`,
            `   Email: ${agent.email}`,
            `   Password: ${agent.password}`,
            `   Sales Assigned: ${agent.salesAssigned}`,
            '-'.repeat(50),
          ].join('\n'),
        ),
        '',
        'NOTE: Please distribute these credentials securely to the respective agents.',
        'Agents can login and view their assigned sales data.',
        '='.repeat(80),
      ].join('\n');

      await fs.writeFile(filePath, content, 'utf8');

      this.logger.log(`Generated agent credentials file: ${fileName}`);
      return filePath;
    } catch (error) {
      this.logger.error('Error generating agent credentials file', error);
      throw error;
    }
  }

  async completeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    try {
      // Generate agent credentials file if new agents were created
      const credentialsFilePath =
        await this.generateAgentCredentialsFile(sessionId);

      if (credentialsFilePath) {
        // Update session stats
        session.stats.newAgentsFile = credentialsFilePath;
        session.stats.newAgentsCount =
          this.newAgentsCredentials.get(sessionId)?.length || 0;
      }

      // Clean up credentials from memory
      this.newAgentsCredentials.delete(sessionId);

      this.logger.log(`Session ${sessionId} completed successfully`);
    } catch (error) {
      this.logger.error(`Error completing session ${sessionId}`, error);
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
    agentId?: string,
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
          creatorId: agentId || generatedDefaults.defaultUser.id,

          createdAt: saleData.createdAt || new Date(),
          updatedAt: saleData.updatedAt || new Date(),
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
          createdAt: saleData.createdAt || new Date(),
          updatedAt: saleData.updatedAt || new Date(),
        },
      });

      // Connect device to sale item if exists
      if (deviceId) {
        await this.prisma.device.update({
          where: { id: deviceId },
          data: {
            isUsed: true,
            installationStatus: InstallationStatus.installed,
            saleItemIDs: { push: saleItem.id },
          },
        });
      }

      // Create agent-customer assignment if agent exists
      if (agentId && customerId) {
        const agentExists = await this.prisma.agent.findUnique({
          where: { id: agentId },
        });

        if (agentExists) {
          const existingAssignment = await this.prisma.agentCustomer.findFirst({
            where: { agentId, customerId },
          });

          if (!existingAssignment) {
            await this.prisma.agentCustomer.create({
              data: {
                agentId,
                customerId,
                assignedBy: generatedDefaults.defaultUser.id,
                assignedAt: saleData.createdAt || new Date(),
              },
            });
          }
        }
      }

      // Create product-inventory relationship if needed
      if (inventoryId) {
        const existingRelation = await this.prisma.productInventory.findFirst({
          where: { productId, inventoryId },
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

      this.logger.debug(
        `Created sale: ${sale.id} for agent: ${agentName || 'Unknown'}`,
      );
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
          // transactionRef:
          //   await this.referenceGenerator.generatePaymentReference(),
          saleId,
          recordedById: generatedDefaults.defaultUser.id,

          paymentDate: paymentData.paymentDate || new Date(),
          createdAt: paymentData.paymentDate || new Date(),
          updatedAt: paymentData.paymentDate || new Date(),
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

  async correctMissingPayments() {
    const startTime = new Date();
    let totalProcessed = 0;
    let totalSkipped = 0;
    let totalErrors = 0;
    let batchCount = 0;
    const allCorrectionResults = [];

    try {
      // Get devices with tokens
      const devicesWithMultipleTokens = await this.prisma.device.findMany({
        include: {
          tokens: {
            orderBy: { createdAt: 'asc' },
          },
        },
        where: {
          tokens: {
            some: {},
          },
        },
      });

      console.log(
        `Found ${devicesWithMultipleTokens.length} devices with tokens`,
      );

      const correctionResults = [];
      let processedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      for (let i = 0; i < devicesWithMultipleTokens.length; i++) {
        const device = devicesWithMultipleTokens[i];

        try {
          // Skip devices with only one token
          if (device.tokens.length <= 1) {
            skippedCount++;
            continue;
          }

          // Find the sale that contains this device
          const saleItem = await this.prisma.saleItem.findFirst({
            where: {
              deviceIDs: {
                has: device.id,
              },
            },
            include: {
              sale: {
                include: {
                  payment: true,
                  customer: true,
                },
              },
            },
          });

          if (!saleItem || !saleItem.sale) {
            console.log(`No sale found for device ${device.serialNumber}`);
            skippedCount++;
            continue;
          }

          const sale = saleItem.sale;
          const existingPayments = sale.payment.length;
          const totalTokens = device.tokens.length;

          // Check if payments already match token count
          if (existingPayments >= totalTokens) {
            console.log(
              `Sale ${sale.id} already has sufficient payment records`,
            );
            skippedCount++;
            continue;
          }

          console.log(
            `Processing device ${device.serialNumber} with ${totalTokens} tokens and ${existingPayments} payments`,
          );

          // Calculate missing payments (skip tokens that already have payments)
          const missingTokens = device.tokens.slice(existingPayments);
          let totalAdditionalAmount = 0;
          const newPayments = [];

          for (const token of missingTokens) {
            const paymentAmount = this.calculatePaymentAmount(
              token.duration,
              sale,
            );
            totalAdditionalAmount += paymentAmount;

            const payment = await this.prisma.payment.create({
              data: {
                transactionRef: `correction-${sale.id}-${token.id}-${Date.now()}`,
                amount: paymentAmount,
                paymentStatus: PaymentStatus.COMPLETED,
                paymentMethod: PaymentMethod.ONLINE,
                paymentDate: token.createdAt,
                saleId: sale.id,
                recordedById: sale.creatorId || null,
                notes: `Auto-corrected payment for token ${token.id} (Duration: ${token.duration} days)`,
              },
            });

            newPayments.push(payment);
          }

          // Update the sale record
          const updatedSale = await this.prisma.sales.update({
            where: { id: sale.id },
            data: {
              totalPaid: sale.totalPaid + totalAdditionalAmount,
              remainingInstallments: sale.remainingInstallments
                ? Math.max(0, sale.remainingInstallments - missingTokens.length)
                : sale.remainingInstallments,
            },
          });

          const correctionResult = {
            deviceSerialNumber: device.serialNumber,
            deviceId: device.id,
            saleId: sale.id,
            customerId: sale.customerId,
            customerName: `${sale.customer?.firstname || ''} ${sale.customer?.lastname || ''}`,
            tokensCount: totalTokens,
            existingPayments: existingPayments,
            newPaymentsCreated: newPayments.length,
            additionalAmount: totalAdditionalAmount,
            newTotalPaid: updatedSale.totalPaid,
            paymentIds: newPayments.map((p) => p.id),
            tokenDetails: missingTokens.map((token) => ({
              tokenId: token.id,
              duration: token.duration,
              amount: this.calculatePaymentAmount(token.duration, sale),
              createdAt: token.createdAt,
            })),
          };

          correctionResults.push(correctionResult);
          allCorrectionResults.push(correctionResult);
          processedCount++;

          // Send email every 1000 iterations
          if ((i + 1) % 1000 === 0) {
            batchCount++;
            await this.emailService.sendBatchProgressEmail(
              batchCount,
              correctionResults,
              processedCount,
              skippedCount,
              errorCount,
            );
            correctionResults.length = 0;
          }
        } catch (deviceError) {
          console.error(
            `Error processing device ${device.serialNumber}:`,
            deviceError,
          );
          errorCount++;

          await this.emailService.sendErrorEmail(
            deviceError,
            device.serialNumber,
            i + 1,
          );
        }
      }

      // Send final batch if there are remaining results
      if (correctionResults.length > 0) {
        batchCount++;
        await this.emailService.sendBatchProgressEmail(
          batchCount,
          correctionResults,
          processedCount,
          skippedCount,
          errorCount,
        );
      }

      totalProcessed = processedCount;
      totalSkipped = skippedCount;
      totalErrors = errorCount;

      await this.emailService.sendCompletionEmail(
        totalProcessed,
        totalSkipped,
        totalErrors,
        startTime,
        allCorrectionResults,
      );

      this.logger.log(
        `Correction completed. Processed: ${processedCount}, Skipped: ${skippedCount}, Errors: ${errorCount}`,
      );

      return {
        success: true,
        message: 'Sales payment correction completed',
        summary: {
          totalDevicesChecked: devicesWithMultipleTokens.length,
          processedCount,
          skippedCount,
          errorCount,
        },
        corrections: allCorrectionResults,
      };
    } catch (error) {
      this.logger.error('Critical error in payment correction process:', error);
      await this.emailService.sendCriticalErrorEmail(
        error,
        totalProcessed,
        totalSkipped,
        totalErrors,
      );
      throw error;
    }
  }

  /**
   * Calculate payment amount based on token duration
   */
  private calculatePaymentAmount(duration: number, sale: any): number {
    const DAILY_RATE = 6000 / 30; // ₦200 per day (₦6,000 for 30 days)

    if (duration === -1) {
      // Forever token - this is the completion payment
      // Calculate remaining balance
      const remainingBalance = sale.totalPrice - sale.totalPaid;
      return Math.max(0, remainingBalance);
    }

    // Calculate based on duration
    return Math.round(duration * DAILY_RATE);
  }

  async previewCorrections() {
    const devicesWithMultipleTokens = await this.prisma.device.findMany({
      include: {
        tokens: {
          orderBy: { createdAt: 'asc' },
        },
        saleItems: {
          include: {
            sale: {
              include: {
                payment: true,
                customer: true,
              },
            },
          },
        },
      },
      where: {
        tokens: {
          some: {},
        },
      },
      take: 50,
    });

    console.log({
      devicesWithMultipleTokens: devicesWithMultipleTokens.length,
    });

    const previews = [];

    for (const device of devicesWithMultipleTokens) {
      if (device.tokens.length <= 1) continue;

      const saleItem = device.saleItems[0];
      if (!saleItem || !saleItem.sale) continue;

      const sale = saleItem.sale;
      const existingPayments = sale.payment.length;
      const totalTokens = device.tokens.length;

      if (existingPayments >= totalTokens) continue;

      const missingPayments = device.tokens.slice(existingPayments);
      let totalAdditionalAmount = 0;

      const tokenDetails = missingPayments.map((token) => {
        const amount = this.calculatePaymentAmount(token.duration, sale);
        totalAdditionalAmount += amount;
        return {
          tokenId: token.id,
          duration: token.duration,
          createdAt: token.createdAt,
          calculatedAmount: amount,
        };
      });

      previews.push({
        deviceSerialNumber: device.serialNumber,
        saleId: sale.id,
        customerName: `${sale.customer.firstname} ${sale.customer.lastname}`,
        currentTotalPaid: sale.totalPaid,
        totalPrice: sale.totalPrice,
        tokensCount: totalTokens,
        existingPayments: existingPayments,
        missingPayments: tokenDetails,
        totalAdditionalAmount,
        newTotalPaid: sale.totalPaid + totalAdditionalAmount,
      });
    }

    return {
      success: true,
      message: 'Preview of corrections',
      totalDevicesToCorrect: previews.length,
      previews,
    };
  }
}
