import { Injectable, Logger } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryResponse } from './cloudinary-response';
import ft from 'node-fetch';
// const streamifier = require('streamifier');
import * as streamifier from 'streamifier';
// import streamifier from 'streamifier'

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);

  async uploadFile(file: Express.Multer.File): Promise<CloudinaryResponse> {
    return new Promise<CloudinaryResponse>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'auto',
          use_filename: true,
          public_id: `${file.fieldname}-${Date.now()}`,
        },
        (error, result) => {
          if (error) reject(error);
          resolve(result);
        },
      );

      streamifier.createReadStream(file.buffer).pipe(uploadStream);
    });
  }

  private convertGoogleDriveUrl(googleDriveUrl: string): string | null {
    if (!googleDriveUrl || !googleDriveUrl.includes('drive.google.com')) {
      return googleDriveUrl; // Return as-is if not a Google Drive URL
    }

    try {
      // Extract file ID from Google Drive URL
      const fileIdMatch = googleDriveUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
      if (!fileIdMatch) {
        this.logger.warn(
          `Could not extract file ID from Google Drive URL: ${googleDriveUrl}`,
        );
        return null;
      }

      const fileId = fileIdMatch[1];
      // Convert to direct download link
      return `https://drive.google.com/uc?export=download&id=${fileId}`;
    } catch (error) {
      this.logger.error(`Error converting Google Drive URL: ${error.message}`);
      return null;
    }
  }

  private async downloadImageFromUrl(imageUrl: string): Promise<Buffer> {
    try {
      const response = await ft(imageUrl, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      console.log({ error });
      this.logger.error(
        `Error downloading image from URL ${imageUrl}: ${error.message}`,
      );
      throw new Error(`Failed to download image: ${error.message}`);
    }
  }

  async uploadUrlToCloudinary(
    imageUrl: string,
    fileName: string,
  ): Promise<string | null> {
    if (!imageUrl || imageUrl.trim() === '') {
      return null;
    }

    try {
      // Convert Google Drive URL if needed
      // const directUrl = this.convertGoogleDriveUrl(imageUrl);
      // if (!directUrl) {
      //   return null;
      // }

      const directUrl = imageUrl

      // Download the image
      const imageBuffer = await this.downloadImageFromUrl(directUrl);

      const mockFile = {
        buffer: imageBuffer,
        originalname: fileName,
        mimetype: 'image/jpeg', // Default, will be detected by Cloudinary
      } as Express.Multer.File;

      // Upload to Cloudinary using existing method
      const uploadResult = await this.uploadFile(mockFile);

      this.logger.debug(
        `Successfully uploaded ${fileName} to Cloudinary: ${uploadResult.secure_url}`,
      );
      return uploadResult.secure_url;
    } catch (error) {
      this.logger.error(
        `Error uploading URL to Cloudinary for ${fileName}: ${error.message}`,
      );
      return null; // Return null instead of throwing to prevent entire row from failing
    }
  }
}
