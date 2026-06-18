import { DayOption } from './dto/get-activation.dto';

const DURATION_TO_DAY: Record<number, DayOption> = {
  7: '7Days',
  30: '30Days',
  60: '60Days',
  90: '90Days',
  180: '180Days',
  270: '270Days',
  360: '360Days',
};

export function mapDurationToDayOption(duration: number): DayOption {
  if (duration === -1 || duration === 1) {
    return 'ForeverCode';
  }
  return DURATION_TO_DAY[duration] ?? '30Days';
}

export function durationFromDayOption(day: DayOption): number {
  if (day === 'ForeverCode') {
    return 1;
  }
  if (day === 'UnLockCode' || day === 'LockCode') {
    return 0;
  }
  const match = day.match(/^(\d+)Days$/);
  return match ? Number(match[1]) : 30;
}
