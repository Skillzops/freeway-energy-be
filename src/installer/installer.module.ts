import { Module } from '@nestjs/common';
import { InstallerService } from './installer.service';
import { InstallerController } from './installer.controller';
import { DeviceModule } from '../device/device.module';
import { AgentsModule } from 'src/agents/agents.module';

@Module({
  imports: [AgentsModule, DeviceModule],
  controllers: [InstallerController],
  providers: [InstallerService],
  exports: [InstallerService],
})
export class InstallerModule {}
