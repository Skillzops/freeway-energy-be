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

export const calculateDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number => {
  const R = 6371; // Earth's radius in kilometers
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in kilometers
};

export const toRadians = (degrees: number): number => {
  return degrees * (Math.PI / 180);
};


export function cleanPhoneNumber(phone: any): string {
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

  return '';
}
