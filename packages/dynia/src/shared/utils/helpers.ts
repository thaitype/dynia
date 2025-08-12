import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { merge } from 'lodash-es';

/**
 * Common utility functions
 */
export class Helpers {
  /**
   * Generate SHA256 hash of a string
   */
  static sha256(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Generate hash of a file
   */
  static async hashFile(filePath: string): Promise<string> {
    const content = await readFile(filePath, 'utf-8');
    return this.sha256(content);
  }

  /**
   * Sleep for specified milliseconds
   */
  static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Retry an operation with exponential backoff
   */
  static async retry<T>(
    operation: () => Promise<T>,
    options: {
      maxAttempts?: number;
      baseDelay?: number;
      maxDelay?: number;
      description?: string;
    } = {}
  ): Promise<T> {
    const { maxAttempts = 3, baseDelay = 1000, maxDelay = 30000, description = 'operation' } = options;

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (attempt === maxAttempts) {
          break; // Don't wait after the last attempt
        }

        const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
        console.log(`${description} failed (attempt ${attempt}/${maxAttempts}), retrying in ${delay}ms...`);
        await this.sleep(delay);
      }
    }

    throw new Error(`${description} failed after ${maxAttempts} attempts. Last error: ${lastError?.message}`);
  }

  /**
   * Wait for a condition to be true with polling
   */
  static async waitFor(
    condition: () => Promise<boolean>,
    options: {
      timeout?: number;
      interval?: number;
      description?: string;
    } = {}
  ): Promise<void> {
    const {
      timeout = 120000, // 2 minutes
      interval = 2000, // 2 seconds
      description = 'condition',
    } = options;

    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      if (await condition()) {
        return;
      }
      await this.sleep(interval);
    }

    throw new Error(`Timeout waiting for ${description} after ${timeout}ms`);
  }

  /**
   * Format timestamp for display
   */
  static formatTimestamp(isoString: string): string {
    return new Date(isoString).toLocaleString();
  }

  /**
   * Generate a timestamp for storage
   */
  static generateTimestamp(): string {
    return new Date().toISOString();
  }

  /**
   * Sanitize filename for safe filesystem storage
   */
  static sanitizeFilename(filename: string): string {
    return filename
      .replace(/[^a-zA-Z0-9.-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
  }

  /**
   * Parse key-value pairs from strings (e.g., "key=value,key2=value2")
   */
  static parseKeyValuePairs(input: string): Record<string, string> {
    if (!input.trim()) return {};

    const pairs: Record<string, string> = {};
    const items = input.split(',');

    for (const item of items) {
      const [key, ...valueParts] = item.split('=');
      if (key && valueParts.length > 0) {
        pairs[key.trim()] = valueParts.join('=').trim();
      }
    }

    return pairs;
  }

  /**
   * Deep merge two objects using lodash
   */
  static deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
    return merge({}, target, source);
  }

  /**
   * Truncate string to specified length with ellipsis
   */
  static truncate(str: string, maxLength: number): string {
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength - 3) + '...';
  }
}
