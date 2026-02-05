import { Injectable } from '@nestjs/common';
import { Device, Prisma } from '@prisma/client';
import { Decoder, Encoder, TokenTypes } from 'openpaygo';

const encoder = new Encoder();
const decoder = new Decoder();

@Injectable()
export class OpenPayGoService {
  async generateToken(
    data: Prisma.DeviceCreateInput,
    days: number,
    deviceCount: number,
  ) {
    const token = encoder.generateToken({
      secretKeyHex: data.key,
      count: deviceCount,
      value: days !== -1 ? (days as number) : undefined,
      valueDivider: Number(data.timeDivider),
      restrictDigitSet: data.restrictedDigitMode,
      tokenType: days === -1 ? TokenTypes.DISABLE_PAYG : TokenTypes.ADD_TIME,
      startingCode: Number(data.startingCode),
    });

    return token;
  }

  async decodeToken(
    device: Device,
    token: string,
  ) {
    return decoder.decodeToken({
      token: token,
      count: 8,
      usedCounts: [],
      secretKeyHex: device.key,
      valueDivider: Number(device.timeDivider),
      restrictedDigitSet: device.restrictedDigitMode,
      startingCode: Number(device.startingCode),
    });

  }

  async resetDeviceCount(
    device: Device,
  ) {
    const resetToken = encoder.generateToken({
      secretKeyHex: device.key,
      count: 0,  // This makes it a reset token
      tokenType: TokenTypes.COUNTER_SYNC,
      startingCode: Number(device.startingCode),
      restrictDigitSet: device.restrictedDigitMode || false,
      valueDivider: Number(device.timeDivider || 1),
      // NO value parameter for counter sync!
    });

    return resetToken;
  }

  async generateUniversalCounterSyncToken(device: any): Promise<{
    resetToken: string;
    syncTokens: Array<{
      targetCount: number;
      token: string;
      range: string;
    }>;
    instructions: string[];
  }> {
    const syncTokens = [];

    // Generate counter sync tokens at different counts
    // The device will accept a counter sync token with count 0 to ~100 above its current count
    const targetCounts = [0, 10, 30, 50, 75, 100];

    for (const targetCount of targetCounts) {
      try {
        const result = encoder.generateToken({
          secretKeyHex: device.key,
          count: targetCount,
          value: 999, // Special value for counter sync
          tokenType: TokenTypes.COUNTER_SYNC,
          startingCode: Number(device.startingCode),
          restrictDigitSet: device.restrictedDigitMode || false,
          valueDivider: Number(device.timeDivider || 1),
        });

        const minDeviceCount = Math.max(0, targetCount - 30);
        const maxDeviceCount = targetCount + 100;

        syncTokens.push({
          targetCount: targetCount,
          token: result.finalToken,
          range: `Works if device count is between ${minDeviceCount}-${maxDeviceCount}`,
        });
      } catch (error) {
      console.log({error})
      }
    }

    // The count=0 token is special - it's a "reset token" that works at any count
    const resetToken = syncTokens.find((t) => t.targetCount === 0);

    return {
      resetToken: resetToken?.token || '',
      syncTokens,
      instructions: [
        '🔧 COUNTER SYNC RECOVERY PROCESS:',
        '',
        '1. BEST OPTION - Try the RESET TOKEN first (count=0):',
        `   Token: ${resetToken?.token}`,
        '   This should work regardless of current device count!',
        '',
        "2. If reset token doesn't work, try these sync tokens in order:",
        ...syncTokens
          .slice(1)
          .map((t) => `   - Token: ${t.token} (${t.range})`),
        '',
        '3. Once a sync token works, the device will be at that count.',
        '4. Update your database with that count number.',
        '',
        '⚠️  IMPORTANT: Counter sync tokens should only be used by technicians!',
        '   Never give these to customers!',
      ],
    };
  }
}
