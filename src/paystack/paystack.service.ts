import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
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

  private getHeaders() {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.secretKey}`,
    };
  }

  async initializeTransaction(payload: {
    email: string;
    amount: number;
    reference: string;
    callback_url?: string;
    metadata?: Record<string, any>;
  }) {
    const response = await axios.post(
      `${this.baseUrl}/transaction/initialize`,
      payload,
      { headers: this.getHeaders() },
    );
    return response.data;
  }

  async verifyTransaction(reference: string) {
    const response = await axios.get(
      `${this.baseUrl}/transaction/verify/${reference}`,
      { headers: this.getHeaders() },
    );
    return response.data;
  }

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    const secret =
      this.config.get<string>('PAYSTACK_WEBHOOK_SECRET') || this.secretKey;
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
}
