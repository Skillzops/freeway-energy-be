import { Injectable, Logger } from '@nestjs/common';

interface PricingPlan {
  duration: number; // 6, 12, 18, 24 months
  initialPayment: number; // First month payment
  monthlyPayment: number; // Subsequent monthly payment
  totalCumulativePayment: number; // Total sum
}

interface ProductPricing {
  sku: string;
  productName: string;
  cashAndCarry: number; // One-time payment price
  installmentPlans: {
    [key: number]: PricingPlan; // Key: duration (6, 12, 18, 24)
  };
}

interface StatePricing {
  [state: string]: ProductPricing[];
}

@Injectable()
export class PricingLookupService {
  private readonly logger = new Logger(PricingLookupService.name);

  // Pricing data by state and product
  private readonly pricingData: StatePricing = {
    taraba: [
      {
        sku: 'A4T77',
        productName: 'A4T77 - 21W (Plus radio and Torch)',
        cashAndCarry: 117000,
        installmentPlans: {
          6: {
            duration: 6,
            initialPayment: 8000,
            monthlyPayment: 24500,
            totalCumulativePayment: 130500,
          },
          12: {
            duration: 12,
            initialPayment: 8000,
            monthlyPayment: 12000,
            totalCumulativePayment: 140000,
          },
          18: {
            duration: 18,
            initialPayment: 8000,
            monthlyPayment: 8500,
            totalCumulativePayment: 152500,
          },
          24: {
            duration: 24,
            initialPayment: 8000,
            monthlyPayment: 7000,
            totalCumulativePayment: 169000,
          },
        },
      },
    ],

    adamawa: [
      {
        sku: 'A4T77',
        productName: 'A4T77 - 21W (Plus radio and Torch)',
        cashAndCarry: 117000,
        installmentPlans: {
          6: {
            duration: 6,
            initialPayment: 8000,
            monthlyPayment: 24500,
            totalCumulativePayment: 130500,
          },
          12: {
            duration: 12,
            initialPayment: 8000,
            monthlyPayment: 12000,
            totalCumulativePayment: 140000,
          },
          18: {
            duration: 18,
            initialPayment: 8000,
            monthlyPayment: 8000,
            totalCumulativePayment: 144000,
          },
          24: {
            duration: 24,
            initialPayment: 8000,
            monthlyPayment: 6000,
            totalCumulativePayment: 146000,
          },
        },
      },
    ],
  };

  /**
   * Get pricing for a specific product, state, and duration
   * @param state Customer's state (e.g., 'taraba', 'adamawa')
   * @param sku Product SKU (e.g., 'A4T77')
   * @param durationMonths Payment plan duration (6, 12, 18, 24)
   * @returns Pricing plan or null if not found
   */
  getPricingPlan(
    state: string,
    sku: string,
    durationMonths: number,
  ): PricingPlan | null {
    try {
      const normalizedState = state.toLowerCase().trim();
      const normalizedSku = sku.toUpperCase().trim();

      // Get state pricing
      const statePricing = this.pricingData[normalizedState];
      if (!statePricing) {
        this.logger.warn(`No pricing found for state: ${state}`);
        return null;
      }

      // Get product pricing
      const productPricing = statePricing.find((p) => p.sku === normalizedSku);
      if (!productPricing) {
        this.logger.warn(`No pricing found for SKU: ${sku} in state: ${state}`);
        return null;
      }

      // Get plan for duration
      const plan = productPricing.installmentPlans[durationMonths];
      if (!plan) {
        this.logger.warn(
          `No ${durationMonths}-month plan for SKU: ${sku} in state: ${state}`,
        );
        return null;
      }

      return plan;
    } catch (error) {
      this.logger.error('Error getting pricing plan', error);
      return null;
    }
  }

  /**
   * Get cash and carry price
   */
  getCashAndCarryPrice(state: string, sku: string): number | null {
    try {
      const normalizedState = state.toLowerCase().trim();
      const normalizedSku = sku.toUpperCase().trim();

      const statePricing = this.pricingData[normalizedState];
      if (!statePricing) return null;

      const productPricing = statePricing.find((p) => p.sku === normalizedSku);
      return productPricing?.cashAndCarry || null;
    } catch (error) {
      this.logger.error('Error getting cash and carry price', error);
      return null;
    }
  }

  /**
   * Calculate monthly payments breakdown
   */
  calculatePaymentBreakdown(
    state: string,
    sku: string,
    durationMonths: number,
  ): {
    initialPayment: number;
    monthlyPayment: number;
    totalPayment: number;
    remainingMonths: number;
  } | null {
    const plan = this.getPricingPlan(state, sku, durationMonths);
    if (!plan) return null;

    return {
      initialPayment: plan.initialPayment,
      monthlyPayment: plan.monthlyPayment,
      totalPayment: plan.totalCumulativePayment,
      remainingMonths: durationMonths - 1, // After initial payment
    };
  }

  /**
   * Validate if pricing exists for combination
   */
  hasPricing(state: string, sku: string, durationMonths: number): boolean {
    return this.getPricingPlan(state, sku, durationMonths) !== null;
  }

  /**
   * Get all available durations for a product/state
   */
  getAvailableDurations(state: string, sku: string): number[] {
    try {
      const plan = this.getPricingPlan(state, sku, 6); // Get any plan to access installmentPlans
      if (!plan) return [];

      const normalizedState = state.toLowerCase().trim();
      const normalizedSku = sku.toUpperCase().trim();
      const statePricing = this.pricingData[normalizedState];
      const productPricing = statePricing.find((p) => p.sku === normalizedSku);

      return Object.keys(productPricing?.installmentPlans || {}).map((k) =>
        parseInt(k),
      );
    } catch (error) {
      this.logger.error('Error getting available durations', error);
      return [];
    }
  }
}
