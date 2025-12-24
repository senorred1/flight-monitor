#!/usr/bin/env node

/**
 * Aircraft Database Sync Tool
 * 
 * Downloads the latest aircraft database CSV from OpenSky Network,
 * extracts relevant data, converts to JSON, compresses, and uploads to Cloudflare R2.
 */

import { parse } from 'csv-parse/sync';
import { gzip } from 'zlib';
import { promisify } from 'util';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';

const gzipAsync = promisify(gzip);

/**
 * Clean environment variable value by removing surrounding quotes and whitespace
 * @param {string|undefined} value - Environment variable value
 * @returns {string|undefined} - Cleaned value
 */
function cleanEnvVar(value) {
  if (!value) return value;
  
  // First trim whitespace
  let cleaned = value.trim();
  
  // Define all quote characters (straight, curly, typographic)
  const quoteChars = [
    '"', "'",                    // Straight quotes
    '\u201C', '\u201D',         // Curly double quotes (U+201C, U+201D)
    '\u2018', '\u2019',         // Curly single quotes (U+2018, U+2019)
    '\u00AB', '\u00BB', '\u2039', '\u203A' // Typographic quotes (« » ‹ ›)
  ];
  
  // Remove quotes from start
  while (cleaned.length > 0 && quoteChars.includes(cleaned[0])) {
    cleaned = cleaned.substring(1);
  }
  
  // Remove quotes from end
  while (cleaned.length > 0 && quoteChars.includes(cleaned[cleaned.length - 1])) {
    cleaned = cleaned.substring(0, cleaned.length - 1);
  }
  
  // Final trim
  cleaned = cleaned.trim();
  
  return cleaned;
}

// Configuration from environment variables (with quote/whitespace cleaning)
const R2_ACCOUNT_ID = cleanEnvVar(process.env.R2_ACCOUNT_ID);
const R2_ACCESS_KEY_ID = cleanEnvVar(process.env.R2_ACCESS_KEY_ID);
const R2_SECRET_ACCESS_KEY = cleanEnvVar(process.env.R2_SECRET_ACCESS_KEY);
const R2_BUCKET_NAME = cleanEnvVar(process.env.R2_BUCKET_NAME);
const R2_OBJECT_KEY = cleanEnvVar(process.env.R2_OBJECT_KEY) || 'aircraft-db.json.gz';

const CSV_URL = 'https://opensky-network.org/datasets/metadata/aircraftDatabase.csv';

/**
 * Display a progress bar
 * @param {number} current - Current value
 * @param {number} total - Total value
 * @param {string} label - Label to display
 * @param {number} barLength - Length of progress bar (default: 40)
 */
function showProgress(current, total, label, barLength = 40) {
  const percent = Math.min(100, Math.max(0, (current / total) * 100));
  const filled = Math.round((percent / 100) * barLength);
  const empty = barLength - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  
  // Format bytes
  const formatBytes = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };
  
  process.stdout.write(`\r${label} [${bar}] ${percent.toFixed(1)}% (${formatBytes(current)} / ${formatBytes(total)})`);
  
  if (current >= total) {
    process.stdout.write('\n');
  }
}

// Validate required environment variables
function validateConfig() {
  const missing = [];
  if (!R2_ACCOUNT_ID) missing.push('R2_ACCOUNT_ID');
  if (!R2_ACCESS_KEY_ID) missing.push('R2_ACCESS_KEY_ID');
  if (!R2_SECRET_ACCESS_KEY) missing.push('R2_SECRET_ACCESS_KEY');
  if (!R2_BUCKET_NAME) missing.push('R2_BUCKET_NAME');

  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    missing.forEach(v => console.error(`   - ${v}`));
    console.error('\nPlease set these variables before running the script.');
    process.exit(1);
  }
}

/**
 * Download CSV from OpenSky Network with progress tracking
 */
async function downloadCSV() {
  console.log('📥 Downloading aircraft database CSV from OpenSky Network...\n');
  
  try {
    const response = await fetch(CSV_URL);
    
    if (!response.ok) {
      throw new Error(`Failed to download CSV: ${response.status} ${response.statusText}`);
    }

    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
    let downloadedBytes = 0;
    const chunks = [];

    if (!response.body) {
      throw new Error('Response body is not available');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    // If we know the content length, show progress
    const showProgressBar = contentLength > 0;

    while (true) {
      const { done, value } = await reader.read();
      
      if (done) break;
      
      downloadedBytes += value.length;
      chunks.push(value);

      if (showProgressBar) {
        showProgress(downloadedBytes, contentLength, '   Downloading');
      } else {
        // If we don't know the size, just show bytes downloaded
        process.stdout.write(`\r   Downloaded: ${(downloadedBytes / 1024).toFixed(2)} KB`);
      }
    }

    if (!showProgressBar) {
      process.stdout.write('\n');
    }

    // Combine chunks and decode
    const allChunks = new Uint8Array(downloadedBytes);
    let offset = 0;
    for (const chunk of chunks) {
      allChunks.set(chunk, offset);
      offset += chunk.length;
    }
    const csvText = decoder.decode(allChunks);
    
    console.log(`✅ Downloaded CSV (${(csvText.length / 1024).toFixed(2)} KB)\n`);
    
    return csvText;
  } catch (error) {
    console.error('\n❌ Error downloading CSV:', error.message);
    throw error;
  }
}

/**
 * Parse CSV and extract relevant fields
 */
function parseCSV(csvText) {
  console.log('📊 Parsing CSV and extracting relevant fields...');
  
  try {
    const records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    console.log(`✅ Parsed ${records.length} aircraft records`);

    // Extract relevant fields and create lookup object keyed by icao24
    const aircraftDb = {};
    let processedCount = 0;

    for (const record of records) {
      // Normalize field names (CSV might have different column names)
      const icao24 = record.icao24 || record.icao || record.icao24Address;
      if (!icao24) {
        continue; // Skip records without icao24
      }

      // Extract relevant fields
      const aircraftInfo = {
        icao24: icao24.toLowerCase(), // Normalize to lowercase
        registration: record.registration || record.reg || null,
        typecode: record.typecode || record.type || record.model || null,
        owner: record.owner || record.operator || null,
        // Include other potentially useful fields if available
        manufacturerName: record.manufacturername || record.manufacturer || null,
        model: record.model || null,
        serialNumber: record.serialnumber || record.serial || null,
        operator: record.operator || record.owner || null,
        operatorCallsign: record.operatorcallsign || null,
        built: record.built || null,
      };

      // Remove null/undefined fields to reduce size
      Object.keys(aircraftInfo).forEach(key => {
        if (aircraftInfo[key] === null || aircraftInfo[key] === undefined || aircraftInfo[key] === '') {
          delete aircraftInfo[key];
        }
      });

      aircraftDb[icao24.toLowerCase()] = aircraftInfo;
      processedCount++;
    }

    console.log(`✅ Processed ${processedCount} aircraft records with valid icao24`);
    console.log(`   Database size: ${Object.keys(aircraftDb).length} entries`);

    return aircraftDb;
  } catch (error) {
    console.error('❌ Error parsing CSV:', error.message);
    throw error;
  }
}

/**
 * Convert to JSON and compress
 */
async function compressJSON(data) {
  console.log('🗜️  Converting to JSON and compressing...');
  
  try {
    const jsonString = JSON.stringify(data);
    const jsonBuffer = Buffer.from(jsonString, 'utf-8');
    
    console.log(`   Uncompressed size: ${(jsonBuffer.length / 1024 / 1024).toFixed(2)} MB`);
    
    const compressed = await gzipAsync(jsonBuffer);
    
    console.log(`✅ Compressed to ${(compressed.length / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Compression ratio: ${((1 - compressed.length / jsonBuffer.length) * 100).toFixed(1)}%`);
    
    return compressed;
  } catch (error) {
    console.error('❌ Error compressing JSON:', error.message);
    throw error;
  }
}

/**
 * Upload individual aircraft records to R2
 * @param {Object} aircraftDb - Aircraft database object keyed by icao24
 */
async function uploadIndividualFiles(aircraftDb) {
  console.log('☁️  Uploading individual aircraft files to R2...\n');
  
  try {
    // Initialize S3 client for R2
    const s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    });

    const icao24List = Object.keys(aircraftDb);
    const totalRecords = icao24List.length;
    let uploadedCount = 0;
    const startTime = Date.now();
    const batchSize = 50; // Upload 50 files at a time to avoid overwhelming the system

    console.log(`   Uploading ${totalRecords} individual aircraft records...`);
    console.log(`   Batch size: ${batchSize} files\n`);

    // Process in batches
    for (let i = 0; i < icao24List.length; i += batchSize) {
      const batch = icao24List.slice(i, i + batchSize);
      const uploadPromises = batch.map(async (icao24) => {
        const aircraftInfo = aircraftDb[icao24];
        const jsonString = JSON.stringify(aircraftInfo);
        const jsonBuffer = Buffer.from(jsonString, 'utf-8');
        const key = `aircraft/${icao24}.json`;

        try {
          const command = new PutObjectCommand({
            Bucket: R2_BUCKET_NAME,
            Key: key,
            Body: jsonBuffer,
            ContentType: 'application/json',
          });

          await s3Client.send(command);
          uploadedCount++;
          
          // Show progress every 100 files
          if (uploadedCount % 100 === 0 || uploadedCount === totalRecords) {
            const percent = ((uploadedCount / totalRecords) * 100).toFixed(1);
            process.stdout.write(`\r   Progress: ${uploadedCount}/${totalRecords} (${percent}%)`);
          }
        } catch (error) {
          console.error(`\n   ⚠️  Failed to upload ${key}: ${error.message}`);
        }
      });

      await Promise.all(uploadPromises);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n✅ Successfully uploaded ${uploadedCount} individual aircraft files`);
    console.log(`   Upload time: ${elapsed} seconds`);
    console.log(`   Average: ${(uploadedCount / parseFloat(elapsed)).toFixed(1)} files/second`);
  } catch (error) {
    console.error('\n❌ Error uploading individual files to R2:', error.message);
    if (error.name === 'CredentialsError' || error.name === 'InvalidAccessKeyId') {
      console.error('   Please check your R2 credentials (R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)');
    } else if (error.name === 'NoSuchBucket') {
      console.error(`   Bucket "${R2_BUCKET_NAME}" does not exist. Please create it in Cloudflare R2.`);
    }
    throw error;
  }
}

/**
 * Upload to Cloudflare R2 with progress tracking (legacy - for large file)
 */
async function uploadToR2(compressedData) {
  console.log('☁️  Uploading compressed database to R2 (legacy format)...\n');
  
  // Debug: Show R2 configuration
  console.log('📋 R2 Configuration:');
  console.log(`   Account ID: ${R2_ACCOUNT_ID ? R2_ACCOUNT_ID.substring(0, 8) + '...' : 'NOT SET'}`);
  console.log(`   Bucket Name: ${R2_BUCKET_NAME || 'NOT SET'}`);
  console.log(`   Object Key: ${R2_OBJECT_KEY}`);
  console.log('');
  
  try {
    // Initialize S3 client for R2
    const s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
      },
    });

    const totalSize = compressedData.length;
    let uploadedBytes = 0;
    const startTime = Date.now();
    const chunkSize = 64 * 1024; // 64KB chunks for progress tracking

    // Create a readable stream that tracks progress as data is read
    class ProgressStream extends Readable {
      constructor(buffer, chunkSize) {
        super();
        this.buffer = buffer;
        this.chunkSize = chunkSize;
        this.offset = 0;
      }

      _read() {
        if (this.offset >= this.buffer.length) {
          this.push(null); // End of stream
          return;
        }
        
        const end = Math.min(this.offset + this.chunkSize, this.buffer.length);
        const chunk = this.buffer.slice(this.offset, end);
        this.offset = end;
        
        // Update progress
        uploadedBytes = this.offset;
        showProgress(uploadedBytes, totalSize, '   Uploading');
        
        this.push(chunk);
      }
    }

    const progressStream = new ProgressStream(compressedData, chunkSize);

    // Upload to R2
    // Note: ContentEncoding is NOT set because the data is already compressed (pre-compressed .gz file)
    // ContentEncoding would tell the server to decompress, but we want to store it as-is
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: R2_OBJECT_KEY,
      Body: progressStream,
      ContentType: 'application/gzip',
      ContentLength: totalSize, // Explicitly set content length
    });

    // Start upload
    const uploadPromise = s3Client.send(command);
    
    // Wait for upload to complete
    await uploadPromise;

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const speed = (totalSize / (1024 * 1024) / parseFloat(elapsed)).toFixed(2);
    
    console.log(`✅ Successfully uploaded to R2: ${R2_BUCKET_NAME}/${R2_OBJECT_KEY}`);
    console.log(`   File size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`   Upload speed: ${speed} MB/s`);
  } catch (error) {
    console.error('\n❌ Error uploading to R2:', error.message);
    if (error.name === 'CredentialsError' || error.name === 'InvalidAccessKeyId') {
      console.error('   Please check your R2 credentials (R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)');
    } else if (error.name === 'NoSuchBucket') {
      console.error(`   Bucket "${R2_BUCKET_NAME}" does not exist. Please create it in Cloudflare R2.`);
    }
    throw error;
  }
}

/**
 * Main execution
 */
async function main() {
  console.log('🚀 Starting aircraft database sync...\n');
  
  try {
    // Validate configuration
    validateConfig();

    // Step 1: Download CSV
    const csvText = await downloadCSV();

    // Step 2: Parse and extract relevant data
    const aircraftDb = parseCSV(csvText);

    // Step 3: Upload individual files to R2 (new on-demand approach)
    await uploadIndividualFiles(aircraftDb);

    // Step 4: Also upload compressed database as fallback (optional)
    console.log('\n📦 Uploading compressed database as fallback...');
    const compressedData = await compressJSON(aircraftDb);
    await uploadToR2(compressedData);

    console.log('\n✅ Aircraft database sync completed successfully!');
    console.log(`   Individual files: ${R2_BUCKET_NAME}/aircraft/*.json`);
    console.log(`   Legacy file: ${R2_BUCKET_NAME}/${R2_OBJECT_KEY}`);
  } catch (error) {
    console.error('\n❌ Sync failed:', error.message);
    process.exit(1);
  }
}

// Run the script
main();

