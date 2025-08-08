import * as argon from 'argon2';

export async function hashPassword(passwordString: string) {
  return await argon.hash(passwordString);
}

export const getLastNDaysDate = (days: number): Date => {
  const now = new Date();
  const nDaysAgo = new Date(now);
  nDaysAgo.setDate(now.getDate() - days);

  return nDaysAgo;
};

export const formatPhoneNumber = (phoneNumber: string): string => {
  let cleaned = phoneNumber.replace(/\D/g, '');

  if (cleaned.startsWith('0')) {
    cleaned = '234' + cleaned.substring(1);
  } else if (!cleaned.startsWith('234')) {
    cleaned = '234' + cleaned;
  }

  return cleaned;
};
