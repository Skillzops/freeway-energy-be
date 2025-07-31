import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReferenceGeneratorService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly excludedChars = ['I', 'i', 'l', 'L', '0', 'O', 'o'];
  private readonly allowedChars = 'ABCDEFGHJKMNPQRSTUVWXYZ123456789';

  /**
   * Generate a short unique payment reference
   * Format: PAY-XXXXXX (10 characters total)
   */
  async generatePaymentReference(): Promise<string> {
    let reference: string;
    let isUnique = false;
    let attempts = 0;
    const maxAttempts = 100;

    do {
      const randomPart = this.generateRandomString(6);
      reference = `PAY-${randomPart}`;
      
      // Check if reference exists in payments table
      const existingPayment = await this.prisma.payment.findFirst({
        where: { transactionRef: reference }
      });
      
      isUnique = !existingPayment;
      attempts++;
      
      if (attempts >= maxAttempts) {
        throw new Error('Unable to generate unique payment reference');
      }
    } while (!isUnique);

    return reference;
  }

  /**
   * Generate a short unique wallet top-up reference
   * Format: TOP-XXXXXX (10 characters total)
   */
  async generateTopUpReference(): Promise<string> {
    let reference: string;
    let isUnique = false;
    let attempts = 0;
    const maxAttempts = 100;

    do {
      const randomPart = this.generateRandomString(6);
      reference = `TOP-${randomPart}`;
      
      // Check if reference exists in wallet transactions table
      const existingTransaction = await this.prisma.walletTransaction.findFirst({
        where: { reference }
      });
      
      isUnique = !existingTransaction;
      attempts++;
      
      if (attempts >= maxAttempts) {
        throw new Error('Unable to generate unique top-up reference');
      }
    } while (!isUnique);

    return reference;
  }

  /**
   * Generate a short unique sale reference for Ogaranya lookup
   * Format: SALE-XXXXXX (11 characters total)
   */
  async generateSaleReference(saleId: string): Promise<string> {
    let reference: string;
    let isUnique = false;
    let attempts = 0;
    const maxAttempts = 100;

    do {
      const randomPart = this.generateRandomString(6);
      reference = `SALE-${randomPart}`;
      
      // Check if reference exists in sales table
      const existingSale = await this.prisma.sales.findFirst({
        where: { 
          OR: [
            { id: saleId },
            // Add a new field to store the short reference if needed
          ]
        }
      });
      
      isUnique = !existingSale || existingSale.id === saleId;
      attempts++;
      
      if (attempts >= maxAttempts) {
        throw new Error('Unable to generate unique sale reference');
      }
    } while (!isUnique);

    return reference;
  }

  private generateRandomString(length: number): string {
    let result = '';
    for (let i = 0; i < length; i++) {
      const randomIndex = Math.floor(Math.random() * this.allowedChars.length);
      result += this.allowedChars[randomIndex];
    }
    return result;
  }

  /**
   * Validate if a reference format is correct
   */
  validateReferenceFormat(reference: string, type: 'payment' | 'topup' | 'sale'): boolean {
    const patterns = {
      payment: /^PAY-[ABCDEFGHJKMNPQRSTUVWXYZ123456789]{6}$/,
      topup: /^TOP-[ABCDEFGHJKMNPQRSTUVWXYZ123456789]{6}$/,
      sale: /^SALE-[ABCDEFGHJKMNPQRSTUVWXYZ123456789]{6}$/,
    };
    
    return patterns[type].test(reference);
  }
}