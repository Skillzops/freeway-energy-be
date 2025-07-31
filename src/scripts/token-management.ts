#!/usr/bin/env node

/**
 * API Auth Token Management CLI
 *
 * Usage:
 * npm run token:generate "Client Name" [days]
 * npm run token:list
 */

import { PrismaClient } from '@prisma/client';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

class ApiAuthTokenCLI {
  private generateSecureToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  async generateToken(
    clientName: string,
    expirationDays: number = 365,
  ): Promise<void> {
    try {
      if (!clientName || clientName.trim() === '') {
        console.error('❌ Client name is required');
        process.exit(1);
      }

      if (expirationDays < 1 || expirationDays > 3650) {
        console.error('❌ Expiration days must be between 1 and 3650');
        process.exit(1);
      }

      const token = this.generateSecureToken();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + expirationDays);

      const tokenRecord = await prisma.apiAuthToken.create({
        data: {
          token,
          clientName: clientName.trim(),
          expiresAt,
          isActive: true,
        },
      });

      console.log('✅ Token generated successfully!');
      console.log('');
      console.log('📋 Token Details:');
      console.log(`   Client Name: ${tokenRecord.clientName}`);
      console.log(`   Token: ${token}`);
      console.log(`   Created: ${tokenRecord.createdAt.toISOString()}`);
      console.log(`   Expires: ${tokenRecord.expiresAt.toISOString()}`);
      console.log('');
      console.log('🔐 API Usage:');
      console.log(`   Authorization: Bearer ${token}`);
      console.log('');
      console.log(
        '⚠️  Important: Store this token securely. It cannot be retrieved again.',
      );
    } catch (error) {
      console.error('❌ Error generating token:', error.message);
      process.exit(1);
    }
  }

  async listTokens(): Promise<void> {
    try {
      const tokens = await prisma.apiAuthToken.findMany({
        where: { isActive: true },
        orderBy: { createdAt: 'desc' },
      });

      if (tokens.length === 0) {
        console.log('📭 No active tokens found.');
        return;
      }

      console.log(`📊 Found ${tokens.length} active token(s):\n`);

      tokens.forEach((token, index) => {
        const isExpired = token.expiresAt < new Date();
        const daysUntilExpiry = Math.ceil(
          (token.expiresAt.getTime() - new Date().getTime()) /
            (1000 * 60 * 60 * 24),
        );

        console.log(`${index + 1}. ${token.clientName}`);
        console.log(`   Token: ${token.token.substring(0, 16)}...`);
        console.log(`   Created: ${token.createdAt.toLocaleDateString()}`);
        console.log(`   Status: ${isExpired ? '🔴 EXPIRED' : '🟢 ACTIVE'}`);
        console.log(
          `   Expires: ${token.expiresAt.toLocaleDateString()} (${daysUntilExpiry} days)`,
        );
        console.log(
          `   Last Used: ${token.lastUsedAt ? token.lastUsedAt.toLocaleDateString() : 'Never'}`,
        );
        console.log('');
      });
    } catch (error) {
      console.error('❌ Error listing tokens:', error.message);
      process.exit(1);
    }
  }
}

async function main() {
  const cli = new ApiAuthTokenCLI();
  const command = process.argv[2];
  const args = process.argv.slice(3);

  try {
    switch (command) {
      case 'generate':
        const clientName = args[0];
        const expirationDays = args[1] ? parseInt(args[1]) : 365;
        await cli.generateToken(clientName, expirationDays);
        break;

      case 'list':
        await cli.listTokens();
        break;

      default:
        console.error('❌ Unknown command:', command);
        console.log('');
        process.exit(1);
    }
  } catch (error) {
    console.error('❌ Unexpected error:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Handle uncaught errors
process.on('uncaughtException', async (error) => {
  console.error('💥 Uncaught Exception:', error.message);
  await prisma.$disconnect();
  process.exit(1);
});

process.on('unhandledRejection', async (reason) => {
  console.error('💥 Unhandled Rejection:', reason);
  await prisma.$disconnect();
  process.exit(1);
});

if (require.main === module) {
  main();
}

export { ApiAuthTokenCLI };
