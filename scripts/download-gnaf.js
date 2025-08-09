#!/usr/bin/env node

/**
 * G-NAF Dataset Download Script
 * Downloads the latest G-NAF dataset from data.gov.au
 */

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const winston = require('winston');
const crypto = require('crypto');
const { createWriteStream, createReadStream } = require('fs');
const { pipeline } = require('stream/promises');

// Configure logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console()
  ]
});

class GNAFDownloader {
  constructor() {
    this.datasetPath = process.env.GNAF_DATASET_PATH || path.join(__dirname, '../data');
    
    // G-NAF dataset URLs (these may need to be updated)
    // Note: Actual URLs should be obtained from data.gov.au
    this.urls = {
      // Full dataset URL - this needs to be updated with actual URL
      full: process.env.GNAF_DATASET_URL || 'https://data.gov.au/data/dataset/geocoded-national-address-file-g-naf',
      
      // API endpoint to check for latest version
      api: 'https://data.gov.au/api/3/action/package_show?id=geocoded-national-address-file-g-naf'
    };
    
    this.downloadInfo = {
      filename: null,
      size: 0,
      checksum: null,
      downloadedSize: 0,
      startTime: null
    };
  }

  async ensureDataDirectory() {
    try {
      await fs.mkdir(this.datasetPath, { recursive: true });
      logger.info(`Data directory ensured: ${this.datasetPath}`);
    } catch (error) {
      logger.error(`Failed to create data directory: ${error.message}`);
      throw error;
    }
  }

  async getLatestDatasetInfo() {
    try {
      logger.info('Checking for latest G-NAF dataset information...');
      
      const response = await axios.get(this.urls.api, {
        timeout: 30000,
        headers: {
          'User-Agent': 'gnaf-address-service/0.1.0'
        }
      });

      if (!response.data.success) {
        throw new Error('Failed to retrieve dataset information');
      }

      const dataset = response.data.result;
      const resources = dataset.resources || [];
      
      // Find the main CSV/ZIP resource (usually the largest file)
      const mainResource = resources
        .filter(r => r.format && (r.format.toLowerCase() === 'zip' || r.format.toLowerCase() === 'csv'))
        .sort((a, b) => (b.size || 0) - (a.size || 0))[0];

      if (!mainResource) {
        throw new Error('No suitable dataset resource found');
      }

      return {
        url: mainResource.url,
        filename: mainResource.name || 'gnaf-dataset.zip',
        size: mainResource.size || 0,
        lastModified: mainResource.last_modified || dataset.metadata_modified,
        description: mainResource.description || 'G-NAF Dataset',
        format: mainResource.format
      };

    } catch (error) {
      logger.warn(`Failed to fetch dataset info via API: ${error.message}`);
      
      // Fallback to manual configuration
      return {
        url: this.urls.full,
        filename: 'gnaf-dataset.zip',
        size: 0,
        lastModified: new Date().toISOString(),
        description: 'G-NAF Dataset (manual configuration)',
        format: 'zip'
      };
    }
  }

  async checkExistingFile(filename) {
    const filepath = path.join(this.datasetPath, filename);
    
    try {
      const stats = await fs.stat(filepath);
      const checksum = await this.calculateFileChecksum(filepath);
      
      return {
        exists: true,
        size: stats.size,
        modified: stats.mtime,
        checksum
      };
    } catch (error) {
      return {
        exists: false,
        size: 0,
        modified: null,
        checksum: null
      };
    }
  }

  async calculateFileChecksum(filepath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = createReadStream(filepath);
      
      stream.on('data', data => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  async downloadDataset(datasetInfo) {
    const filepath = path.join(this.datasetPath, datasetInfo.filename);
    const tempFilepath = `${filepath}.tmp`;

    this.downloadInfo = {
      filename: datasetInfo.filename,
      size: datasetInfo.size,
      checksum: null,
      downloadedSize: 0,
      startTime: Date.now()
    };

    logger.info(`Starting download: ${datasetInfo.url}`);
    logger.info(`Target file: ${filepath}`);
    logger.info(`Expected size: ${this.formatBytes(datasetInfo.size)}`);

    try {
      const response = await axios({
        method: 'GET',
        url: datasetInfo.url,
        responseType: 'stream',
        timeout: 300000, // 5 minutes timeout
        headers: {
          'User-Agent': 'gnaf-address-service/0.1.0'
        }
      });

      const totalSize = parseInt(response.headers['content-length'] || datasetInfo.size);
      this.downloadInfo.size = totalSize;

      const writeStream = createWriteStream(tempFilepath);
      const hash = crypto.createHash('sha256');

      // Progress tracking
      let lastProgress = 0;
      const progressInterval = setInterval(() => {
        this.logProgress();
      }, 5000); // Log progress every 5 seconds

      response.data.on('data', (chunk) => {
        this.downloadInfo.downloadedSize += chunk.length;
        hash.update(chunk);
      });

      await pipeline(response.data, writeStream);
      clearInterval(progressInterval);

      this.downloadInfo.checksum = hash.digest('hex');

      // Verify download
      const stats = await fs.stat(tempFilepath);
      if (totalSize > 0 && stats.size !== totalSize) {
        throw new Error(`Download incomplete. Expected: ${totalSize}, Got: ${stats.size}`);
      }

      // Move temp file to final location
      await fs.rename(tempFilepath, filepath);

      const duration = Date.now() - this.downloadInfo.startTime;
      const speed = this.downloadInfo.downloadedSize / (duration / 1000);

      logger.info(`Download completed successfully!`);
      logger.info(`File: ${filepath}`);
      logger.info(`Size: ${this.formatBytes(stats.size)}`);
      logger.info(`Duration: ${this.formatDuration(duration)}`);
      logger.info(`Average speed: ${this.formatBytes(speed)}/s`);
      logger.info(`Checksum: ${this.downloadInfo.checksum}`);

      return {
        filepath,
        size: stats.size,
        checksum: this.downloadInfo.checksum,
        duration
      };

    } catch (error) {
      // Clean up temp file on error
      try {
        await fs.unlink(tempFilepath);
      } catch (unlinkError) {
        // Ignore cleanup errors
      }

      throw error;
    }
  }

  logProgress() {
    const { downloadedSize, size, startTime } = this.downloadInfo;
    
    if (size <= 0) {
      logger.info(`Downloaded: ${this.formatBytes(downloadedSize)}`);
      return;
    }

    const progress = (downloadedSize / size) * 100;
    const elapsed = Date.now() - startTime;
    const speed = downloadedSize / (elapsed / 1000);
    const eta = speed > 0 ? ((size - downloadedSize) / speed) * 1000 : 0;

    logger.info(
      `Progress: ${progress.toFixed(1)}% ` +
      `(${this.formatBytes(downloadedSize)}/${this.formatBytes(size)}) ` +
      `Speed: ${this.formatBytes(speed)}/s ` +
      `ETA: ${this.formatDuration(eta)}`
    );
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  async saveDownloadMetadata(datasetInfo, downloadResult) {
    const metadata = {
      dataset: {
        url: datasetInfo.url,
        description: datasetInfo.description,
        format: datasetInfo.format,
        lastModified: datasetInfo.lastModified
      },
      download: {
        filename: downloadResult.filepath,
        size: downloadResult.size,
        checksum: downloadResult.checksum,
        downloadedAt: new Date().toISOString(),
        duration: downloadResult.duration
      }
    };

    const metadataPath = path.join(this.datasetPath, 'download-metadata.json');
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    
    logger.info(`Metadata saved: ${metadataPath}`);
  }

  async download() {
    await this.ensureDataDirectory();

    const datasetInfo = await this.getLatestDatasetInfo();
    logger.info(`Found dataset: ${datasetInfo.description}`);
    
    // Check if file already exists
    const existing = await this.checkExistingFile(datasetInfo.filename);
    
    if (existing.exists) {
      logger.info(`File already exists: ${datasetInfo.filename}`);
      logger.info(`Size: ${this.formatBytes(existing.size)}`);
      logger.info(`Modified: ${existing.modified}`);
      logger.info(`Checksum: ${existing.checksum}`);
      
      // Check if we should re-download (file age, etc.)
      const shouldRedownload = process.argv.includes('--force') || 
                              process.argv.includes('--update');
      
      if (!shouldRedownload) {
        logger.info('Use --force to re-download or --update to check for newer version');
        return;
      }
    }

    const downloadResult = await this.downloadDataset(datasetInfo);
    await this.saveDownloadMetadata(datasetInfo, downloadResult);
  }
}

async function main() {
  const downloader = new GNAFDownloader();
  
  try {
    await downloader.download();
    logger.info('G-NAF dataset download completed successfully');
  } catch (error) {
    logger.error(`Download failed: ${error.message}`);
    
    if (error.code === 'ECONNABORTED') {
      logger.error('Download timed out. The G-NAF dataset is very large (~13GB)');
      logger.error('Consider checking your internet connection or trying again later');
    } else if (error.code === 'ENOSPC') {
      logger.error('Insufficient disk space for download');
    } else if (error.code === 'ENOTFOUND') {
      logger.error('Unable to reach data.gov.au. Check your internet connection');
    }
    
    process.exit(1);
  }
}

// Run download if called directly
if (require.main === module) {
  main().catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = GNAFDownloader;