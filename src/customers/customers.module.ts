import { Module } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CustomersController } from './customers.controller';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { AuthModule } from 'src/auth/auth.module';
import { CustomerInteractionService } from './customers-interaction.service';
import { CustomerInteractionController } from './customers-interaction.controller';

@Module({
  imports: [CloudinaryModule, AuthModule],
  controllers: [CustomersController, CustomerInteractionController],
  providers: [CustomersService, CustomerInteractionService],
  exports: [CustomersService, CustomerInteractionService],
})
export class CustomersModule {}
