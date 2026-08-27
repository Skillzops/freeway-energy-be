import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import * as crypto from 'crypto';

@Injectable()
export class PaystackService {
  private readonly baseUrl: string;
  private readonly secretKey: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl =
      this.config.get<string>('PAYSTACK_BASE_URL') || 'https://api.paystack.co';
    this.secretKey = this.config.get<string>('PAYSTACK_SECRET_KEY') || '';
  }

  isConfigured(): boolean {
    return Boolean(this.secretKey?.trim());
  }

  private getHeaders() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.secretKey}`,
    };
  }

  private assertConfigured() {
    if (!this.secretKey?.trim()) {
      throw new BadRequestException(
        'Paystack is not configured. Set PAYSTACK_SECRET_KEY on the server.',
      );
    }
  }

  private unwrapPaystackResponse<T>(body: { status?: boolean; message?: string; data?: T }): T {
    if (!body?.status || body.data == null) {
      throw new BadRequestException(
        body?.message || 'Paystack request failed without details.',
      );
    }
    return body.data;
  }

  private handlePaystackAxiosError(error: unknown, context: string): never {
    if (error instanceof BadRequestException) throw error;
    if (axios.isAxiosError(error)) {
      const ax = error as AxiosError<{ message?: string }>;
      const message =
        ax.response?.data?.message ||
        ax.message ||
        `Paystack ${context} failed`;
      throw new BadRequestException(message);
    }
    throw new InternalServerErrorException(`Paystack ${context} failed`);
  }

  async initializeTransaction(payload: {
    email: string;
    amount: number;
    reference: string;
    callback_url?: string;
    metadata?: Record<string, any>;
  }) {
    this.assertConfigured();
    try {
      const response = await axios.post(
        `${this.baseUrl}/transaction/initialize`,
        payload,
        { headers: this.getHeaders() },
      );
      return response.data;
    } catch (error) {
      this.handlePaystackAxiosError(error, 'transaction initialize');
    }
  }

  async verifyTransaction(reference: string) {
    this.assertConfigured();
    try {
      const response = await axios.get(
        `${this.baseUrl}/transaction/verify/${reference}`,
        { headers: this.getHeaders() },
      );
      return response.data;
    } catch (error) {
      this.handlePaystackAxiosError(error, 'transaction verify');
    }
  }

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    const secret = this.secretKey;
    if (!secret || !signature) {
      return false;
    }

    const hash = crypto
      .createHmac('sha512', secret)
      .update(rawBody)
      .digest('hex');

    try {
      return crypto.timingSafeEqual(
        Buffer.from(hash, 'hex'),
        Buffer.from(signature, 'hex'),
      );
    } catch {
      return false;
    }
  }

  async createOrFetchCustomer(params: {
    email: string;
    firstName: string;
    lastName: string;
    phone?: string;
  }) {
    this.assertConfigured();
    try {
      const response = await axios.post(
        `${this.baseUrl}/customer`,
        {
          email: params.email.trim(),
          first_name: params.firstName.trim(),
          last_name: params.lastName.trim(),
          ...(params.phone?.trim() ? { phone: params.phone.trim() } : {}),
        },
        { headers: this.getHeaders() },
      );
      return this.unwrapPaystackResponse<{
        customer_code: string;
        id: number;
        email: string;
      }>(response.data);
    } catch (error) {
      this.handlePaystackAxiosError(error, 'customer create');
    }
  }

  async validateCustomerBvn(params: {
    customerCode: string;
    bvn: string;
    firstName: string;
    lastName: string;
  }) {
    this.assertConfigured();
    try {
      const response = await axios.post(
        `${this.baseUrl}/customer/${encodeURIComponent(params.customerCode)}/identification`,
        {
          country: 'NG',
          type: 'bvn',
          value: params.bvn.trim(),
          first_name: params.firstName.trim(),
          last_name: params.lastName.trim(),
        },
        { headers: this.getHeaders() },
      );
      return this.unwrapPaystackResponse(response.data);
    } catch (error) {
      this.handlePaystackAxiosError(error, 'BVN validation');
    }
  }

  async assignDedicatedVirtualAccount(params: {
    customerCode: string;
    firstName: string;
    lastName: string;
    phone?: string;
    preferredBank?: string;
  }) {
    this.assertConfigured();
    const preferredBank =
      params.preferredBank?.trim() ||
      this.config.get<string>('PAYSTACK_DVA_PREFERRED_BANK') ||
      'wema-bank';

    try {
      const response = await axios.post(
        `${this.baseUrl}/dedicated_account`,
        {
          customer: params.customerCode,
          preferred_bank: preferredBank,
          first_name: params.firstName.trim(),
          last_name: params.lastName.trim(),
          ...(params.phone?.trim() ? { phone: params.phone.trim() } : {}),
        },
        { headers: this.getHeaders() },
      );

      const data = this.unwrapPaystackResponse<{
        account_number: string;
        account_name?: string;
        bank?: { name?: string };
        id?: number;
        customer?: { customer_code?: string };
      }>(response.data);

      if (!data.account_number?.trim()) {
        throw new BadRequestException(
          'Paystack did not return a dedicated account number.',
        );
      }

      return data;
    } catch (error) {
      this.handlePaystackAxiosError(error, 'dedicated account assign');
    }
  }

  async createPermanentVirtualAccount(params: {
    email: string;
    bvn: string;
    firstName: string;
    lastName: string;
    phone?: string;
    preferredBank?: string;
  }) {
    const customer = await this.createOrFetchCustomer({
      email: params.email,
      firstName: params.firstName,
      lastName: params.lastName,
      phone: params.phone,
    });

    await this.validateCustomerBvn({
      customerCode: customer.customer_code,
      bvn: params.bvn,
      firstName: params.firstName,
      lastName: params.lastName,
    });

    const dedicated = await this.assignDedicatedVirtualAccount({
      customerCode: customer.customer_code,
      firstName: params.firstName,
      lastName: params.lastName,
      phone: params.phone,
      preferredBank: params.preferredBank,
    });

    return {
      customer,
      dedicated,
    };
  }
}
