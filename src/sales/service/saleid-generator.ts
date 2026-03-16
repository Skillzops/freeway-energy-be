import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SalesIdGeneratorService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Timestamp + DB check
   * Checks database but much faster since timestamp collisions are extremely rare
   * Format: SAL-YYMMDD-XXXXXX
   * Example: SAL-250111-9K7M2L
   */
  async generateFormattedSaleId(): Promise<string> {
    let uniqueId: string;
    let attempts = 0;
    const maxAttempts = 5; // Usually succeeds on first try

    do {
      const now = new Date();
      const datePrefix = this.getDatePrefix(now);
      const timestamp = now.getTime();
      const timestampSuffix = this.convertToBase36(timestamp)
        .toUpperCase()
        .slice(-4);
      const randomSuffix = this.generateRandomSuffix(3);
      uniqueId = `${datePrefix}-${timestampSuffix}-${randomSuffix}`;

      const existing = await this.prisma.sales.findUnique({
        where: { formattedSaleId: uniqueId },
      });

      if (!existing) {
        break;
      }

      attempts++;
    } while (attempts < maxAttempts);

    if (attempts >= maxAttempts) {
      throw new Error(
        'Failed to generate unique sales ID after maximum attempts',
      );
    }

    return uniqueId;
  }

  /**
   * Generate formatted ID with a specific date (useful for migrations)
   * @param date Date to use for the ID prefix
   * @returns Formatted sales ID
   */
  private async generateFormattedSaleIdForDate(date: Date): Promise<string> {
    let uniqueId: string;
    let attempts = 0;
    const maxAttempts = 5;

    do {
      const datePrefix = this.getDatePrefix(date);
      const timestamp = date.getTime();
      const timestampSuffix = this.convertToBase36(timestamp)
        .toUpperCase()
        .slice(-4);
      const randomSuffix = this.generateRandomSuffix(3);
      uniqueId = `${datePrefix}-${timestampSuffix}-${randomSuffix}`;

      const existing = await this.prisma.sales.findUnique({
        where: { formattedSaleId: uniqueId },
      });

      if (!existing) {
        break;
      }

      attempts++;
    } while (attempts < maxAttempts);

    if (attempts >= maxAttempts) {
      throw new Error(
        `Failed to generate unique sales ID for date ${date} after ${maxAttempts} attempts`,
      );
    }

    return uniqueId;
  }

  /**
   * Extract date prefix from a date object
   * Format: SAL-YYMMDD
   * @param date Date object
   * @returns Date prefix string
   */
  private getDatePrefix(date: Date): string {
    const year = String(date.getFullYear()).slice(-2);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `SAL-${year}${month}${day}`;
  }

  /**
   * Convert number to base36 (0-9, A-Z)
   * @param num Number to convert
   * @returns Base36 string
   */
  private convertToBase36(num: number): string {
    return num.toString(36);
  }

  /**
   * Generate a random suffix using alphanumeric characters
   * @param length Length of the suffix
   * @returns Random alphanumeric string
   */
  private generateRandomSuffix(length: number): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Populate existing sales with formatted sales IDs
   * This is useful for one-time migration of existing sales records
   * @returns Summary of populated records
   */
  async populateExistingSalesIds(): Promise<{
    totalSales: number;
    populated: number;
    skipped: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let populated = 0;
    let skipped = 0;

    // Fetch all sales without formattedSaleId
    const salesWithoutId = await this.prisma.sales.findMany({
      where: { NOT: { formattedSaleId: {} } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, createdAt: true, formattedSaleId: true },
    });

    console.log({ salesWithoutId: salesWithoutId.length });

    const totalSales = salesWithoutId.length;

    for (const sale of salesWithoutId) {
      if (sale.formattedSaleId) {
        skipped++;
        continue;
      }

      console.log(`count: ${populated}, skipped: ${skipped}`)

      try {
        const formattedSaleId = await this.generateFormattedSaleIdForDate(
          sale.createdAt,
        );

        // Update the sale with the generated ID
        await this.prisma.sales.update({
          where: { id: sale.id },
          data: { formattedSaleId },
        });

        populated++;
      } catch (error) {
        errors.push(
          `Error processing sale ${sale.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
        skipped++;
      }
    }

    return {
      totalSales,
      populated,
      skipped,
      errors,
    };
  }
}
