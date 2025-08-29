import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { DeviceModule } from 'src/device/device.module';

@Module({
  imports: [CloudinaryModule, DeviceModule],
  controllers: [InventoryController],
  providers: [InventoryService],
})
export class InventoryModule {}
