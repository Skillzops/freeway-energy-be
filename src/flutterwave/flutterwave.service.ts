import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class FlutterwaveService {
  private readonly baseUrl: string;
  private readonly secretKey: string;
  private readonly publicKey: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl =
      this.config.get<string>('FLW_BASE_URL') ||
      'https://api.flutterwave.com/v3';
    this.secretKey = this.config.get<string>('FLW_SECRET_KEY');
    this.publicKey = this.config.get<string>('FLW_PUBLIC_KEY');
  }

  private getHeaders() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.secretKey}`,
    };
  }

  async generatePaymentLink(paymentData: {
    tx_ref: string;
    amount: number;
    currency: string;
    customer: {
      email: string;
      name: string;
      phonenumber: string;
    };
    payment_options: string;
    customizations: {
      title: string;
      description: string;
      logo: string;
    };
    meta: any;
  }) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/payments`,
        {
          ...paymentData,
          redirect_url: this.config.get<string>('FLW_REDIRECT_URL'),
        },
        { headers: this.getHeaders() },
      );

      return response.data;
    } catch (error) {
      console.error(
        'Flutterwave payment link generation failed:',
        error.response?.data || error.message,
      );
      throw new Error('Failed to generate Flutterwave payment link');
    }
  }

  async verifyTransaction(transactionId: number) {
    try {
      // const response = await axios.get(
      //   `${this.baseUrl}/transactions/${transactionId}/verify`,
      //   { headers: this.getHeaders() },
      // );

      const id =
        typeof transactionId === 'string'
          ? parseInt(transactionId, 10)
          : transactionId;

      const response = await axios.get(
        `${this.baseUrl}/transactions/${id}/verify`,
        { headers: this.getHeaders() },
      );

      return response.data;
    } catch (error) {
      console.error(
        'Flutterwave transaction verification failed:',
        error.response?.data || error.message,
      );
      throw new Error('Failed to verify Flutterwave transaction');
    }
  }

  async verifyTransactionByReference(reference: string) {
    try {
      const response = await axios.get(
        `${this.baseUrl}/transactions/verify_by_reference?tx_ref=${reference}`,
        { headers: this.getHeaders() },
      );

      return response.data;
    } catch (error) {
      console.error(
        'Flutterwave transaction verification by reference failed:',
        error.response?.data || error.message,
      );
      throw new Error('Failed to verify Flutterwave transaction by reference');
    }
  }

  async refundPayment(transactionId: number, amount: number) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/transactions/${transactionId}/refund`,
        { amount },
        { headers: this.getHeaders() },
      );

      return response.data;
    } catch (error) {
      console.error(
        'Flutterwave refund failed:',
        error.response?.data || error.message,
      );
      throw new Error('Failed to process Flutterwave refund');
    }
  }

  async generateStaticAccount(
    saleId: string,
    email: string,
    bvn: string,
    transactionRef: string,
  ) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/virtual-account-numbers`,
        {
          email,
          bvn,
          tx_ref: transactionRef,
          narration: `Virtual account for sale ${saleId}`,
          is_permanent: false,
        },
        { headers: this.getHeaders() },
      );

      return response.data;
    } catch (error) {
      console.error(
        'Flutterwave virtual account creation failed:',
        error.response?.data || error.message,
      );
      throw new Error('Failed to create Flutterwave virtual account');
    }
  }

  async handleWebhook(payload: any, signature: string) {
    // Verify webhook signature
    const secretHash = this.config.get<string>('FLW_SECRET_HASH');

    if (!signature || signature !== secretHash) {
      throw new Error('Invalid webhook signature');
    }

    return payload;
  }
}
