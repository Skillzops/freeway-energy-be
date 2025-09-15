import { DataMappingService } from './data-mapping.service';
import { PrismaModule } from '../prisma/prisma.module';
import { Module } from '@nestjs/common';
import { CsvUploadController } from './csv-upload.controller';
import { CsvUploadService } from './csv-upload.service';
import { DefaultsGeneratorService } from './defaults-generator.service';
import { FileParserService } from './file-parser.service';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { CsvProcessingProcessor } from './csv-processing.processor';
import { BullModule } from '@nestjs/bullmq';
import { EmailModule } from 'src/mailer/email.module';

@Module({
  imports: [
    PrismaModule,
    EmailModule,
    CloudinaryModule,
    BullModule.registerQueue({
      name: 'csv-processing',
    }),
  ],
  controllers: [CsvUploadController],
  providers: [
    CsvUploadService,
    DataMappingService,
    DefaultsGeneratorService,
    FileParserService,
    CsvProcessingProcessor,
  ],
  exports: [
    CsvUploadService,
    DataMappingService,
    DefaultsGeneratorService,
    FileParserService,
  ],
})
export class CsvUploadModule {}
