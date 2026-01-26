import { Exclude } from 'class-transformer';
import { Inventory, InventoryClass, InventoryStatus } from '@prisma/client';

export class InventoryEntity implements Partial<Inventory> {
  id: string;
  name: string;
  manufacturerName: string;
  sku: string;
  image: string;
  dateOfManufacture: string;
  batchNumber: number;
  status: InventoryStatus;
  class: InventoryClass;
  inventoryCategory: string;
  inventorySubCategory: string;
  batches: Array<any>;
  createdAt: Date;
  @Exclude()
  updatedAt: Date;
  @Exclude()
  deletedAt: Date;

  constructor(partial: Partial<InventoryEntity>) {
    Object.assign(this, partial);
  }
}
