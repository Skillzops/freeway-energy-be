import { SaleItemDto } from './dto/create-sales.dto';

export interface ProcessedSaleItem extends SaleItemDto {
  totalPrice: number;
  duration?: number;
  miscTotal?: number;
  installmentTotalPrice?: number;
  monthlyPayment: number;
  totalPayableAmount?: number;
  batchAllocation?: BatchAllocation[];
}

export interface BatchAllocation {
  batchId: string;
  quantity: number;
  price: number;
}
