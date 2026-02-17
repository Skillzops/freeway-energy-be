import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DefaultsGeneratorService } from './defaults-generator.service';
import { SalesRowDto } from './dto/csv-upload.dto';
import {
  SalesStatus,
  PaymentMode,
  CategoryTypes,
  IDType,
  AddressType,
  UserStatus,
  PaymentStatus,
  PaymentMethod,
  InventoryClass,
  AgentCategory,
} from '@prisma/client';
import { PricingLookupService } from './pricing-lookup.service';
import { cleanPhoneNumber, parseCoordinate } from 'src/utils/helpers.util';

@Injectable()
export class DataMappingService {
  private readonly logger = new Logger(DataMappingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly defaultsGenerator: DefaultsGeneratorService,
    private readonly pricingLookupService: PricingLookupService,
  ) {}

  async transformSalesRowToEntities(row: SalesRowDto, generatedDefaults: any) {
    const extractedData = this.extractAndValidateData(row);

    return {
      installerData: this.transformInstallerData(
        extractedData.installerName,
        generatedDefaults,
      ),
      agentData: this.transformAgentData(extractedData, generatedDefaults),
      customerData: this.transformCustomerData(extractedData),
      productData: this.transformProductData(extractedData),
      inventoryData: this.transformInventoryData(extractedData),
      deviceData: this.transformDeviceData(extractedData),
      contractData: this.shouldCreateContract(extractedData)
        ? this.transformContractData(extractedData)
        : null,
      saleData: this.transformSaleData(extractedData),
      paymentData: this.hasInitialPayment(extractedData)
        ? this.transformPaymentData(extractedData)
        : null,
    };
  }

  private extractAndValidateData(row: SalesRowDto) {
    // Extract and clean all data from the CSV row
    const extractedData = {
      // Agent information
      salesAgent: this.cleanString(row.salesAgent),

      // Customer basic info
      firstName: this.cleanString(row.firstName) || 'Unknown',
      lastName: this.cleanString(row.lastName) || 'Customer',
      phoneNumber: cleanPhoneNumber(row.phoneNumber),
      alternatePhoneNumber: cleanPhoneNumber(row.alternatePhoneNumber),

      // Address and location
      installationAddress: this.cleanString(row.installationAddress),
      lga: this.cleanString(row.lga),
      state: this.cleanString(row.state),
      latitude: this.cleanCoordinate(row.latitude),
      longitude: this.cleanCoordinate(row.longitude),

      // Personal details
      gender: this.normalizeGender(row.gender),

      // ID information
      idType: this.normalizeIdType(row.idType),
      idNumber: this.cleanString(row.idNumber),

      // File uploads (URLs or file references)
      passportPhotoUrl: this.cleanString(row.passportPhotoUrl),
      idImageUrl: this.cleanString(row.idImageUrl),
      signedContractUrl: this.cleanString(row.signedContractUrl),
      contractFormImageUrl: this.cleanString(row.contractFormImageUrl),

      // Customer category
      customerCategory: this.normalizeCustomerCategory(row.customerCategory),

      // Guarantor information
      guarantorName: this.cleanString(row.guarantorName),
      guarantorNumber: cleanPhoneNumber(row.guarantorNumber),

      // Product and payment
      productType: this.cleanString(row.productType) || 'Unknown Product',
      initialDeposit: this.parseAmount(row.initialDeposit),
      paymentPeriod: this.parseNumber(row.paymentPeriod),
      paymentType: this.normalizePaymentType(row.paymentType),
      paymentOption: this.cleanString(row.paymentOption),
      totalPayment: this.parseAmount(row.totalPayment),
      paymentPlan: this.extractMonthsFromPaymentPlan(row.paymentPlan),

      // Device and installation
      serialNumber: this.cleanString(row.serialNumber),
      installerName: this.cleanString(row.installerName),

      // Date
      dateOfRegistration: this.parseDate(row.dateOfRegistration) || new Date(),

      timestamp: this.parseDate(row.timestamp) || new Date(),
      middleName: this.cleanString(row.middleName),
      uploadAllImages: this.cleanString(row.uploadAllImages),
      tokenSent: this.cleanString(row.tokenSent),
      // Use timestamp as creation date for all entities
      creationDate: this.parseDate(row.timestamp) || new Date(),
    };

    // Validate required fields
    this.validateRequiredFields(extractedData);

    return extractedData;
  }

  private transformAgentData(extractedData: any, generatedDefaults: any) {
    if (!extractedData.salesAgent) {
      return null;
    }

    const agentNames = this.parseFullName(extractedData.salesAgent);
    const username = this.generateUsername(
      agentNames.firstname,
      agentNames.mn || Date.now().toString(),
    );

    return {
      userData: {
        firstname: agentNames.firstname,
        lastname: agentNames.lastname,
        username: username,
        email:
          `${agentNames.firstname}.${agentNames.mn || Date.now()}@gmail.com`.toLowerCase(),
        password: generatedDefaults.defaultPassword,
        // phone: this.defaultsGenerator.generateNigerianPhone(),
        // location: 'Field Agent',
        // addressType: AddressType.WORK,
        // status: UserStatus.active,
      },
      username,
      firstname: agentNames.firstname,
      lastname: agentNames.lastname,
      fullname: extractedData.salesAgent,
    };
  }

  private transformInstallerData(
    installerName: string,
    generatedDefaults: any,
  ) {
    if (!installerName) return null;

    const agentNames = this.parseFullName(installerName);

    const installerUsername = `${agentNames.firstname || agentNames.lastname || agentNames.mn || Date.now().toString().slice(-4)}.installer`;
    const installerEmail = `${installerUsername}@gmail.com`.toLowerCase();

    console.log({
      installerUsername,
      installerEmail,
      agentNames,
      installerName,
    });
    return {
      userData: {
        firstname: agentNames.firstname,
        lastname: agentNames.lastname,
        username: installerUsername,
        email: installerEmail,
        password: generatedDefaults.defaultPassword,
      },
      agentData: {
        category: AgentCategory.INSTALLER,
        fullname: installerName,
      },
    };
  }

  private transformCustomerData(extractedData: any) {
    // const email = this.generateCustomerEmail(
    //   extractedData.firstName,
    //   extractedData.lastName,
    //   extractedData.phoneNumber,
    // );
    const email = null;

    return {
      firstname: extractedData.firstName,
      lastname: extractedData.lastName,
      // middleName: extractedData.middleName
      //   ? extractedData.middleName
      //   : undefined,
      phone: extractedData.phoneNumber,
      alternatePhone: extractedData.alternatePhoneNumber || null,
      gender: extractedData.gender || null,
      email: email,
      passportPhotoUrl: extractedData.passportPhotoUrl || null,

      addressType: AddressType.HOME,
      installationAddress: extractedData.installationAddress || null,
      lga: extractedData.lga || null,
      state: extractedData.state || null,
      location: extractedData.installationAddress || null,
      longitude: parseCoordinate(extractedData.longitude) || null,
      latitude: parseCoordinate(extractedData.latitude) || null,

      idType: extractedData.idType || null,
      idNumber: extractedData.idNumber || null,
      idImageUrl: extractedData.idImageUrl || null,

      contractFormImageUrl: extractedData.contractFormImageUrl || null,

      status: UserStatus.active,
      type: extractedData.customerCategory,

      createdAt: extractedData.creationDate,
      updatedAt: extractedData.creationDate,
    };
  }

  private transformProductData(extractedData: any) {
    const paymentModes = this.determinePaymentModes(
      extractedData.paymentOption,
    );

    return {
      name: extractedData.productType,
      // description: `Migrated product: ${extractedData.productType}`,
      // currency: 'NGN',
      paymentModes: paymentModes.join(','),
    };
  }

  private transformInventoryData(extractedData: any) {
    // const estimatedPrice = this.defaultsGenerator.estimateProductPrice(
    //   extractedData.productType,
    // );
    const estimatedPrice = 0.0;

    return {
      name: extractedData.productType,
      manufacturerName: 'Unknown',
      sku: this.defaultsGenerator.generateSKU(extractedData.productType),
      status: 'IN_STOCK',
      class: InventoryClass.REGULAR,
      price: estimatedPrice,
      costOfItem: estimatedPrice,
    };
  }

  private transformDeviceData(extractedData: any) {
    if (!extractedData.serialNumber) {
      return null;
    }

    return {
      serialNumber: extractedData.serialNumber,
      key: this.generateDeviceKey(),
      isUsed: true, // Will be marked as used when sold

      // Timestamps
      createdAt: extractedData.creationDate,
      updatedAt: extractedData.creationDate,
    };
  }

  private transformContractData(extractedData: any) {
    return {
      initialAmountPaid: extractedData.initialDeposit || 0,

      // Guarantor information
      guarantorFullName: extractedData.guarantorName || null,
      guarantorPhoneNumber: extractedData.guarantorNumber || null,
      guarantorHomeAddress: null,
      guarantorEmail: null,
      guarantorIdType: null,
      guarantorIdNumber: null,
      guarantorIdIssuingCountry: null,
      guarantorIdIssueDate: null,
      guarantorIdExpirationDate: null,
      guarantorNationality: null,
      guarantorDateOfBirth: null,

      // Customer ID information
      idType: null,
      idNumber: null,
      issuingCountry: 'Nigeria',
      issueDate: null,
      expirationDate: null,
      fullNameAsOnID: `${extractedData.firstName} ${extractedData.lastName}`,
      addressAsOnID: extractedData.installationAddress || null,

      signedContractUrl: extractedData.signedContractUrl || null,
      signedAt: extractedData.dateOfRegistration,

      // Default next of kin info
      nextOfKinFullName: null,
      nextOfKinRelationship: null,
      nextOfKinPhoneNumber: null,
      nextOfKinHomeAddress: null,
      nextOfKinEmail: null,
      nextOfKinDateOfBirth: null,
      nextOfKinNationality: null,

      createdAt: extractedData.creationDate,
      updatedAt: extractedData.creationDate,
    };
  }

  private transformSaleData(extractedData: any) {
    // // const estimatedPrice = this.estimateProductPrice(extractedData.productType);
    // const estimatedPrice = extractedData.totalPayment || 144000;
    const paymentMode = this.getPaymentMode(extractedData.paymentOption);
    const paymentMethod = this.getPaymentMethod(extractedData.paymentOption);
    // const totalPaid = extractedData.initialDeposit || 0;
    // const paymentPeriod = extractedData.paymentPeriod || 24;

    // const totalInstallmentDuration =
    //   paymentMode === PaymentMode.INSTALLMENT ? paymentPeriod : 0;

    // const totalMonthlyPayment =
    //   paymentMode === PaymentMode.INSTALLMENT && paymentPeriod > 0
    //     ? Math.ceil(estimatedPrice / paymentPeriod)
    //     : 0;

    // const totalMiscellaneousPrice = Math.max(
    //   totalPaid - totalMonthlyPayment,
    //   0,
    // );

    // const miscellaneousPrices =
    //   totalMiscellaneousPrice > 0 ? { misc1: totalMiscellaneousPrice } : null;

    const pricingPlan = this.pricingLookupService.getPricingPlan(
      extractedData.state || 'taraba',
      extractedData.productSku || 'A4T77',
      extractedData.paymentPlan || 12,
    );

    let status: SalesStatus = SalesStatus.COMPLETED;
    if (pricingPlan) {
      status =
        pricingPlan.initialPayment == pricingPlan.totalCumulativePayment
          ? SalesStatus.COMPLETED
          : SalesStatus.IN_INSTALLMENT;
    } else {
      status = SalesStatus.IN_INSTALLMENT;
    }

    if (pricingPlan) {
      const initialPayment = pricingPlan.initialPayment;
      const monthlyPayment = pricingPlan.monthlyPayment;
      const totalCumulativePayment = pricingPlan.totalCumulativePayment;
      const durationMonths = pricingPlan.duration;

      return {
        category: CategoryTypes.PRODUCT,
        status,

        totalPrice: totalCumulativePayment,
        totalPaid: initialPayment,
        installmentStartingPrice: initialPayment,
        totalMonthlyPayment: monthlyPayment,

        totalMiscellaneousPrice: 2000,
        miscellaneousPrices: { misc1: 2000 },

        totalInstallmentDuration: durationMonths,
        remainingInstallments: durationMonths - 1,

        paymentMode,
        paymentMethod,
        installerName: extractedData.installerName || null,

        transactionDate:
          extractedData.creationDate || extractedData.dateOfRegistration,
        createdAt: extractedData.creationDate,
        updatedAt: extractedData.creationDate,
      };
    } else {
      this.logger.warn(
        `No pricing found for: ${extractedData.state}, ${extractedData.productSku}, ${extractedData.paymentPlan}`,
      );

      // Use defaults
      return {
        category: CategoryTypes.PRODUCT,
        status,
        totalPrice: extractedData.totalPayment || 117000,
        totalPaid: extractedData.initialDeposit || 0,
        installmentStartingPrice: extractedData.initialDeposit || 0,
        totalMonthlyPayment: 0,
        totalMiscellaneousPrice: 2000,
        miscellaneousPrices: { misc1: 2000 },
        totalInstallmentDuration: extractedData.paymentPlan || 0,
        remainingInstallments: Math.max(
          (extractedData.paymentPlan || 0) - 1,
          0,
        ),
        paymentMode,
        paymentMethod,
        installerName: extractedData.installerName || null,
        transactionDate: extractedData.creationDate,
        createdAt: extractedData.creationDate,
        updatedAt: extractedData.creationDate,
      };
    }
  }

  private transformPaymentData(extractedData: any) {
    if (!extractedData.initialDeposit || extractedData.initialDeposit <= 0) {
      return null;
    }

    return {
      amount: extractedData.initialDeposit,
      paymentStatus: PaymentStatus.COMPLETED,
      paymentDate:
        extractedData.creationDate || extractedData.dateOfRegistration,
      paymentMethod: PaymentMethod.ONLINE,
      notes: 'Initial deposit',
    };
  }

  // Helper methods

  private cleanString(value: any): string | null {
    if (!value || typeof value !== 'string') return null;
    const cleaned = value.trim();
    return cleaned === '' || cleaned.toLowerCase() === 'nil' ? null : cleaned;
  }

  // private cleanPhoneNumber(phone: any): string {
  //   // if (!phone) return this.defaultsGenerator.generateNigerianPhone();
  //   if (!phone) return 'nil';

  //   const cleaned = phone.toString().replace(/\D/g, '');

  //   // return cleaned;

  //   // Handle Nigerian phone numbers
  //   // if (cleaned.startsWith('234')) {
  //   //   return cleaned;
  //   // } else if (cleaned.startsWith('0') && cleaned.length === 11) {
  //   //   return '234' + cleaned.substring(1);
  //   // } else if (cleaned.length === 10) {
  //   //   return '234' + cleaned;
  //   // } else if (cleaned.length >= 10) {
  //   //   return '234' + cleaned.slice(-10);
  //   // }

  //   // return this.defaultsGenerator.generateNigerianPhone();
  // }

  private cleanPhoneNumber(phone: any): string {
    if (!phone) return '';

    const cleaned = phone.toString().replace(/\D/g, '');

    if (cleaned.startsWith('234')) {
      return cleaned;
    }

    if (cleaned.startsWith('0') && cleaned.length === 11) {
      return '234' + cleaned.substring(1);
    }

    if (cleaned.length === 10) {
      return '234' + cleaned;
    }

    if (cleaned.length > 11 && cleaned.endsWith('0')) {
      return '234' + cleaned.slice(-10);
    }

    // fallback: invalid or unexpected
    return '';
  }

  private cleanCoordinate(coord: any): string | null {
    if (!coord) return null;
    const num = parseFloat(coord.toString());
    return isNaN(num) ? null : num.toString();
  }

  private normalizeGender(gender: any): string | null {
    if (!gender) return null;
    const g = gender.toString().toLowerCase().trim();
    if (g.startsWith('m') || g === 'male') return 'Male';
    if (g.startsWith('f') || g === 'female') return 'Female';
    return null;
  }

  private normalizeIdType(idType: any): IDType {
    if (!idType) return null;

    const type = idType.toString().toLowerCase().trim();
    if (type.includes('nin') || type.includes('national')) return IDType.Nin;
    if (type.includes('passport')) return IDType.Passport;
    if (type.includes('driver') || type.includes('license'))
      return IDType.Driver_License;
    if (type.includes('voter')) return IDType.Voter_ID;
    if (type.includes('social') || type.includes('security'))
      return IDType.Social_Security_Number;

    return idType as IDType;
  }

  private normalizeCustomerCategory(category: any): string {
    if (!category) return 'purchase';
    const cat = category.toString().toLowerCase().trim();

    if (cat === 'lead') return 'lead';
    if (cat === 'purchase') return 'lead';
    else return 'residential';
  }

  private normalizePaymentType(option: any): string {
    if (!option) return 'one_off';
    const opt = option.toString().toLowerCase().trim();
    if (opt.includes('install') || opt.includes('monthly'))
      return 'installment';
    return 'one_off';
  }

  private parseAmount(amount: any): number {
    if (!amount) return 0;

    // Remove currency symbols and clean
    const cleaned = amount.toString().replace(/[₦$,\s]/g, '');
    const parsed = parseFloat(cleaned);

    return isNaN(parsed) ? 0 : parsed;
  }

  private parseNumber(value: any): number | null {
    if (!value) return null;

    if (typeof value === 'number') {
      return isNaN(value) ? null : value;
    }

    if (typeof value !== 'string') {
      try {
        value = value.toString();
      } catch {
        return null;
      }
    }

    const cleaned = value
      .toString()
      .replace(/[₦$£€¥,\s]/g, '') // Remove common currency symbols and commas
      .replace(/[^\d.-]/g, '') // Keep only digits, dots, and minus signs
      .trim();

    if (cleaned === '' || cleaned === '-' || cleaned === '.') {
      return null;
    }

    // Parse the cleaned value
    const parsed = parseFloat(cleaned);

    return isNaN(parsed) ? null : parsed;
  }

  //best format YYYY-MM-DDTHH:mm:ssZ
  private parseDate(dateString: any): Date | null {
    if (!dateString) return null;

    try {
      // Handle various date formats
      const date = new Date(dateString);
      if (!isNaN(date.getTime())) {
        return date;
      }

      // Try DD/MM/YYYY format
      if (typeof dateString === 'string' && dateString.includes('/')) {
        const parts = dateString.split('/');
        if (parts.length === 3) {
          const day = parseInt(parts[0]);
          const month = parseInt(parts[1]) - 1; // Month is 0-indexed
          const year = parseInt(parts[2]);

          if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
            return new Date(year, month, day);
          }
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  parseFullName(fullName: string): {
    firstname: string;
    lastname: string;
    mn?: string;
  } {
    if (!fullName || fullName.trim() === '') {
      return { firstname: 'User', lastname: 'Agent' };
    }

    const names = fullName
      .trim()
      .split(' ')
      .filter((name) => name.length > 0);

    if (names.length === 0) {
      return { firstname: 'User', lastname: 'Agent' };
    } else if (names.length === 1) {
      return { firstname: names[0], lastname: 'Agent' };
    } else {
      return {
        firstname: `${names[0]}`,
        lastname: `${names.slice(1).join(' ')}`,
        mn: names.slice(1).join(''),
      };
    }
  }

  generateUsername(firstname: string, lastname: string): string {
    const base = `${firstname.trim().toLowerCase()}.${lastname.trim().toLowerCase()}`;
    const timestamp = Date.now().toString().slice(-4);
    return `${base}.${timestamp}`.replace(/[^a-z0-9.]/g, '');
  }

  private generateCustomerEmail(
    firstname: string,
    lastname: string,
    phone: string,
  ): string {
    const baseEmail = `${firstname.toLowerCase()}.${lastname.toLowerCase()}`;
    const phoneHash = phone.slice(-4);
    return `${baseEmail}.${phoneHash}@gmail.com`;
  }

  private determinePaymentModes(paymentOption: string): string[] {
    const option = paymentOption?.toLowerCase() || '';
    if (option.includes('install') || option.includes('monthly')) {
      return ['ONE_OFF', 'INSTALLMENT'];
    }
    return ['ONE_OFF'];
  }

  private extractMonthsFromPaymentPlan(paymentPlan: any): number | null {
    if (!paymentPlan) return null;

    // Convert to string if it's a number
    const planStr = paymentPlan.toString().trim().toLowerCase();

    // Try to extract number from string
    // Handles: "12 months", "12months", "12", "12 month", etc.
    const match = planStr.match(/(\d+)/);

    if (match && match[1]) {
      const months = parseInt(match[1], 10);

      // Validate it's a reasonable number (1-120 months = 1-10 years)
      if (months > 0 && months <= 120) {
        return months;
      }
    }

    this.logger.warn(
      `Could not extract months from payment plan: ${paymentPlan}`,
    );
    return null;
  }

  private getPaymentMode(paymentOption: string): PaymentMode {
    const option = paymentOption?.toLowerCase() || '';
    if (option.includes('install') || option.includes('monthly')) {
      return PaymentMode.INSTALLMENT;
    }
    return PaymentMode.ONE_OFF;
  }
  private getPaymentMethod(paymentOption: string): PaymentMethod {
    const option = paymentOption?.toLowerCase() || '';

    if (option.includes('online') || option.includes('card')) {
      return PaymentMethod.ONLINE;
    } else if (option.includes('cash')) {
      return PaymentMethod.CASH;
    } else if (option.includes('ussd')) {
      return PaymentMethod.USSD;
    } else if (option.includes('transfer') || option.includes('bank')) {
      return PaymentMethod.BANK_TRANSFER;
    } else if (option.includes('pos')) {
      return PaymentMethod.POS;
    } else if (option.includes('wallet')) {
      return PaymentMethod.WALLET;
    }

    return PaymentMethod.ONLINE;
  }

  private calculateMonthlyPayment(
    totalPrice: number,
    initialDeposit: number,
  ): number {
    const remaining = totalPrice - initialDeposit;
    const months = 12; // Default 12-month installment
    return Math.ceil(remaining / months);
  }

  private generateDeviceKey(): string {
    return (
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15)
    );
  }

  private shouldCreateContract(extractedData: any): boolean {
    // Create contract if we have guarantor info
    return !!extractedData.guarantorName;
  }

  private hasInitialPayment(extractedData: any): boolean {
    return !!(extractedData.initialDeposit && extractedData.initialDeposit > 0);
  }

  private validateRequiredFields(extractedData: any): void {
    const requiredFields = [
      { field: 'firstName', message: 'First name is required' },
      { field: 'lastName', message: 'Last name is required' },
      { field: 'phoneNumber', message: 'Phone number is required' },
      { field: 'productType', message: 'Product type is required' },
    ];

    const errors: string[] = [];

    for (const { field, message } of requiredFields) {
      if (!extractedData[field] || extractedData[field].trim() === '') {
        errors.push(message);
      }
    }

    if (errors.length > 0) {
      throw new Error(`Validation failed: ${errors.join(', ')}`);
    }
  }
}
