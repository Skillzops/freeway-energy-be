// src/beebeejump/dto/get-activation.dto.ts
export type DayOption =
  | '7Days'
  | '30Days'
  | '60Days'
  | '90Days'
  | '180Days'
  | '270Days'
  | '360Days'
  | 'UnLockCode'
  | 'LockCode'
  | 'ForeverCode';

export class GetActivationRequestDto {
  sn: string;          // e.g. "01-61-00000001"
  day: DayOption;      // e.g. "30Days"
}

export interface BeebeejumpApiRequest {
  sn: string;
  day: DayOption;
  apiKey: string;
  apiSecret: string;
}

export interface BeebeejumpApiData {
  sn: string;
  days: DayOption;
  encrypt: string;       // Base64 AES-CBC ciphertext
  yearOfUse: string;     // "1" | "2" | ...
  conversionCode: 'N' | 'Y';
}

export interface BeebeejumpApiResponse {
  returnCode: number;       // 0 = success
  returnMessage?: string;   // sometimes misspelled as retrunMessage
  retrunMessage?: string;
  data?: BeebeejumpApiData | null;
}
