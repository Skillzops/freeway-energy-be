import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as crypto from 'crypto';
import {
  BeebeejumpApiRequest,
  BeebeejumpApiResponse,
  DayOption,
  GetActivationRequestDto,
} from './dto/get-activation.dto';

@Injectable()
export class BeebeejumpService {
  constructor(private readonly http: HttpService) {}

  private apiUrl = process.env.BEEBEEJUMP_API_URL as string; // e.g. https://api.example.com/activation
  private apiKey = process.env.BEEBEEJUMP_API_KEY as string; // provided by beebeejump
  private apiSecret = process.env.BEEBEEJUMP_API_SECRET as string; // provided by beebeejump

  // AES-192-CBC: key must be 24 bytes, IV 16 bytes (utf8)

  private decryptEncryptField(b64: string): string {
    const keyStr = (process.env.BEE_AES_KEY || '').trim(); // exactly 24 ASCII chars
    const ivStr = (process.env.BEE_AES_IV || '').trim(); // exactly 16 ASCII chars
    const debug = process.env.DEBUG_BEE === '1';

    console.log(
      keyStr,
      'keyStr__keyStr',
      ivStr,
      'debug__',
      debug,
      'sss',
      process.env.DEBUG_BEE,
    );

    if (debug) {
      console.log(`[BEE][decrypt] b64Chars=${b64.length}`);
      console.log(
        `[BEE][decrypt] keyChars=${keyStr.length}, ivChars=${ivStr.length}`,
      );
    }

    // if (keyStr.length !== 24) {
    //   throw new Error(
    //     `BEE_AES_KEY must be exactly 24 ASCII chars (got ${keyStr.length}).`,
    //   );
    // }
    // if (ivStr.length !== 16) {
    //   throw new Error(
    //     `BEE_AES_IV must be exactly 16 ASCII chars (got ${ivStr.length}).`,
    //   );
    // }

    const key = Buffer.from(keyStr, 'utf8'); // 24 bytes → AES-192
    const iv = Buffer.from(ivStr, 'utf8'); // 16 bytes
    const ciphertext = Buffer.from(b64, 'base64');

    if (debug) {
      console.log(
        `[BEE][decrypt] algo=aes-192-cbc, cipherBytes=${ciphertext.length}, keyBytes=${key.length}, ivBytes=${iv.length}`,
      );
    }

    try {
      const decipher = crypto.createDecipheriv('aes-192-cbc', key, iv);
      decipher.setAutoPadding(true); // PKCS5/7
      const out = Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]);
      const plain = out.toString('utf8');

      console.log(plain, 'plain__plain');

      if (debug) {
        console.log(
          `[BEE][decrypt] success: plaintextLen=${plain.length}, startsWith=${JSON.stringify(plain.slice(0, 2))}`,
        );
      }
      return plain;
    } catch (e: any) {
      // if (debug) {
      console.error(
        `[BEE][decrypt] failure: name=${e?.name} code=${e?.code} reason=${e?.reason} msg=${e?.message}`,
      );
      // }
      throw new Error(
        `AES decrypt failed. Check key/iv. (${e?.code || e?.message || 'unknown error'})`,
      );
    }
  }

  private validateKeyIv(key: string, iv: string) {
    // AES key sizes: 16/24/32 bytes (AES-128/192/256)
    const keyLen = Buffer.byteLength(key, 'utf8');
    if (![16, 24, 32].includes(keyLen)) {
      throw new Error(
        `Invalid AES key length: ${keyLen} bytes. Must be 16, 24, or 32.`,
      );
    }

    // AES-CBC IV must be 16 bytes
    const ivLen = Buffer.byteLength(iv, 'utf8');
    if (ivLen !== 16) {
      throw new Error(`Invalid IV length: ${ivLen} bytes. Must be 16.`);
    }
  }

  decrypt(base64CipherText: string, key: string, iv: string): string {
    this.validateKeyIv(key, iv);

    try {
      const keyBuf = Buffer.from(key, 'utf8');
      const ivBuf = Buffer.from(iv, 'utf8');

      const algo =
        keyBuf.length === 16
          ? 'aes-128-cbc'
          : keyBuf.length === 24
            ? 'aes-192-cbc'
            : 'aes-256-cbc';

      const decipher = crypto.createDecipheriv(algo, keyBuf, ivBuf);
      const encryptedBuf = Buffer.from(base64CipherText, 'base64');
      const decrypted = Buffer.concat([
        decipher.update(encryptedBuf),
        decipher.final(),
      ]);

      return decrypted.toString('utf8');
    } catch (error) {
      console.log(error, 'error___error');
      throw new Error(`Invalid Sivied ${error?.message}`);
    }
  }

  async getActivationCode(input: GetActivationRequestDto): Promise<{
    sn: string;
    day: DayOption;
    activationCode: string; // decrypted value for the device
    rawEncrypt: string; // original ciphertext (Base64)
    yearOfUse: string;
    conversionCode: 'N' | 'Y';
    returnCode: number;
    returnMessage?: string;
  }> {
    const payload: BeebeejumpApiRequest = {
      sn: input.sn,
      day: input.day,
      apiKey: this.apiKey,
      apiSecret: this.apiSecret,
    };

    const { data } = await firstValueFrom(
      this.http.post<BeebeejumpApiResponse>(this.apiUrl, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15_000,
      }),
    );

    console.log(data, 'data_____', payload);

    const msg = data?.returnMessage ?? data?.retrunMessage;
    if (!data || data.returnCode !== 0 || !data.data) {
      throw new Error(
        `Beebeejump API error: code=${data?.returnCode ?? 'NA'} msg=${msg ?? 'Unknown'}`,
      );
    }

    const { encrypt, sn, days, yearOfUse, conversionCode } = data.data;

    let activationCode = '1';

    const keyStr = (process.env.BEE_AES_KEY || '').trim(); // exactly 24 ASCII chars
    const ivStr = (process.env.BEE_AES_IV || '').trim(); // exactly 16 ASCII chars

    activationCode = this.decrypt(encrypt, keyStr, ivStr);

    console.log(activationCode, 'activationCode__');

    return {
      sn,
      day: days,
      activationCode,
      rawEncrypt: encrypt,
      yearOfUse,
      conversionCode,
      returnCode: data.returnCode,
      returnMessage: msg,
    };
  }
}
