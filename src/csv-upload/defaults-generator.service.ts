import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { faker } from '@faker-js/faker';
import { hashPassword } from '../utils/helpers.util';
import { generateRandomPassword } from '../utils/generate-pwd';
import {
  CategoryTypes,
  UserStatus,
  AddressType,
  SubjectEnum,
  ActionEnum,
} from '@prisma/client';

@Injectable()
export class DefaultsGeneratorService {
  private readonly logger = new Logger(DefaultsGeneratorService.name);

  constructor(private readonly prisma: PrismaService) {}

  async generateDefaults(sessionUserId: string): Promise<{
    categories: { product: any; inventory: any };
    defaultUser: any;
    defaultRole: any;
    defaultPassword: string;
  }> {
    this.logger.log('Generating default entities for sales CSV migration');

    const defaultPassword = generateRandomPassword(12);

    const defaults = {
      categories: await this.ensureDefaultCategories(),
      defaultUser: await this.ensureDefaultUser(defaultPassword, sessionUserId),
      defaultRole: await this.ensureDefaultRole(),
      defaultAgentRole: await this.ensureDefaultRole('agent'),
      defaultPassword: await hashPassword(defaultPassword),
    };

    this.logger.log(
      'Default entities generated successfully for sales migration',
    );
    return defaults;
  }

  private async ensureDefaultCategories(): Promise<{
    product: any;
    inventory: any;
  }> {
    let productCategory = await this.prisma.category.findFirst({
      where: {
        type: CategoryTypes.PRODUCT,
        name: 'Product Category 1',
      },
    });

    if (!productCategory) {
      productCategory = await this.prisma.category.create({
        data: {
          name: 'Product Category 1',
          type: CategoryTypes.PRODUCT,
        },
      });
      this.logger.log('Created default product category: Solar Products');
    }

    let inventoryCategory = await this.prisma.category.findFirst({
      where: {
        type: CategoryTypes.INVENTORY,
        name: 'Inventory Category 1',
      },
    });

    if (!inventoryCategory) {
      inventoryCategory = await this.prisma.category.create({
        data: {
          name: 'Inventory Category 1',
          type: CategoryTypes.INVENTORY,
        },
      });
      this.logger.log('Created default inventory category: Solar Equipment');
    }

    return {
      product: productCategory,
      inventory: inventoryCategory,
    };
  }

  private async ensureDefaultUser(
    plainPassword: string,
    sessionUserId: string,
  ): Promise<any> {
    let defaultUser = await this.prisma.user.findFirst({
      where: {
        OR: [{ id: sessionUserId }, { email: 'csv.migration@gmail.com' }],
      },
    });

    if (!defaultUser) {
      const defaultRole = await this.ensureDefaultRole();

      defaultUser = await this.prisma.user.create({
        data: {
          email: 'csv.migration@gmail.com',
          password: await hashPassword(plainPassword),
          firstname: 'CSV',
          lastname: 'Migration',
          username: 'csv_migration_agent',
          roleId: defaultRole.id,
          phone: this.generateNigerianPhone(),
          addressType: AddressType.WORK,
          status: UserStatus.active,
        },
      });

      this.logger.log('Created default CSV migration user');
    }

    return defaultUser;
  }

  private async ensureDefaultRole(type?: 'agent' | 'admin'): Promise<any> {
    let defaultRole = await this.prisma.role.findFirst({
      where: { role: type === 'agent' ? 'AssignedAgent' : 'CSV Migration' },
    });

    if (!defaultRole) {
      const requiredPermissions =
        type === 'agent'
          ? [{ action: ActionEnum.manage, subject: SubjectEnum.Assignments }]
          : [{ action: ActionEnum.manage, subject: SubjectEnum.all }];

      const permissions =
        await this.createMigrationPermissions(requiredPermissions);

      defaultRole = await this.prisma.role.create({
        data: {
          role: type === 'agent' ? 'AssignedAgent' : 'CSV Migration',
          active: true,
          permissionIds: permissions.map((p) => p.id),
        },
      });

      this.logger.log('Created default CSV migration role');
    }

    return defaultRole;
  }

  private async createMigrationPermissions(
    requiredPermissions: any = [
      { action: ActionEnum.manage, subject: SubjectEnum.all },
    ],
  ): Promise<any[]> {
    const permissions = [];

    for (const perm of requiredPermissions) {
      let permission = await this.prisma.permission.findFirst({
        where: {
          action: perm.action as any,
          subject: perm.subject as any,
        },
      });

      if (!permission) {
        permission = await this.prisma.permission.create({
          data: {
            action: perm.action as any,
            subject: perm.subject as any,
            roleIds: [],
          },
        });
      }

      permissions.push(permission);
    }

    return permissions;
  }

  generateNigerianPhone(): string {
    const prefixes = [
      '803',
      '806',
      '813',
      '816',
      '810',
      '814',
      '903',
      '906',
      '915',
      '905',
      '701',
      '708',
      '802',
      '808',
      '812',
      '818',
    ];
    const prefix = faker.helpers.arrayElement(prefixes);
    const number = faker.string.numeric(7);
    return `234${prefix}${number}`;
  }

  estimateProductPrice(productName: string): number {
    const product = productName.toLowerCase();

    // Solar panels by wattage
    if (product.includes('solar')) {
      if (product.includes('50w')) return 75000;
      if (product.includes('100w')) return 120000;
      if (product.includes('150w')) return 180000;
      if (product.includes('200w')) return 240000;
      if (product.includes('300w')) return 350000;
      if (product.includes('400w')) return 450000;
      return 150000; // Default solar panel price
    }

    // Batteries by capacity
    if (product.includes('battery')) {
      if (product.includes('100ah')) return 180000;
      if (product.includes('150ah')) return 250000;
      if (product.includes('200ah')) return 320000;
      if (product.includes('220ah')) return 350000;
      return 200000; // Default battery price
    }

    // Inverters by capacity
    if (product.includes('inverter')) {
      if (product.includes('1kva') || product.includes('1000w')) return 120000;
      if (product.includes('2kva') || product.includes('2000w')) return 200000;
      if (product.includes('3kva') || product.includes('3000w')) return 280000;
      if (product.includes('5kva') || product.includes('5000w')) return 450000;
      return 180000; // Default inverter price
    }

    // Charge controllers
    if (product.includes('controller') || product.includes('mppt')) {
      if (product.includes('60a')) return 45000;
      if (product.includes('80a')) return 65000;
      if (product.includes('100a')) return 85000;
      return 50000; // Default controller price
    }

    // Complete systems
    if (
      product.includes('system') ||
      product.includes('package') ||
      product.includes('kit')
    ) {
      return 500000; // Default system price
    }

    return 100000; // Default price for unknown products
  }

  generateSKU(productName: string): string {
    const prefix = this.getSKUPrefix(productName);
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.random().toString(36).substring(2, 5).toUpperCase();
    return `${prefix}-${timestamp}-${random}`;
  }

  private getSKUPrefix(productName: string): string {
    const product = productName.toLowerCase();

    if (product.includes('solar') || product.includes('panel')) return 'SOL';
    if (product.includes('battery')) return 'BAT';
    if (product.includes('inverter')) return 'INV';
    if (product.includes('controller') || product.includes('mppt'))
      return 'CTR';
    if (product.includes('system') || product.includes('kit')) return 'SYS';
    if (product.includes('cable') || product.includes('wire')) return 'CBL';
    if (product.includes('mount') || product.includes('bracket')) return 'MNT';

    return 'GEN'; // General
  }
}
