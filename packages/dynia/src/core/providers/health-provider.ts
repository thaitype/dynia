import type { ILogger } from '@thaitype/core-utils';

import { Helpers } from '../../shared/utils/helpers.js';
import type { HealthCheckResult, IHealthProvider } from './interfaces.js';

/**
 * Health check implementation using Node.js built-in HTTP client
 */
export class HealthProvider implements IHealthProvider {
  constructor(private readonly logger: ILogger) {}

  /**
   * Check HTTP endpoint health
   */
  async checkHttp(
    url: string,
    options: {
      timeout?: number;
      expectedStatus?: number[];
    } = {}
  ): Promise<HealthCheckResult> {
    const { timeout = 10000, expectedStatus = [200, 201, 202, 204, 300, 301, 302, 303, 304] } = options;

    const startTime = Date.now();

    try {
      this.logger.debug(`Health check: ${url}`);

      const response = await this.fetchWithTimeout(url, timeout);
      const responseTime = Date.now() - startTime;

      const healthy = expectedStatus.includes(response.status);

      if (healthy) {
        this.logger.debug(`Health check passed: ${url} (${response.status}, ${responseTime}ms)`);
      } else {
        this.logger.debug(`Health check failed: ${url} (${response.status}, ${responseTime}ms)`);
      }

      return {
        healthy,
        statusCode: response.status,
        responseTime,
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.logger.debug(`Health check error: ${url} (${responseTime}ms) - ${errorMessage}`);

      return {
        healthy: false,
        responseTime,
        error: errorMessage,
      };
    }
  }

  /**
   * Check health with retries and exponential backoff
   */
  async checkHealthWithRetries(
    url: string,
    options: {
      maxAttempts?: number;
      retryDelay?: number;
      timeout?: number;
    } = {}
  ): Promise<HealthCheckResult> {
    const { maxAttempts = 3, retryDelay = 2000, timeout = 10000 } = options;

    return await Helpers.retry(() => this.checkHealthUntilHealthy(url, timeout), {
      maxAttempts,
      baseDelay: retryDelay,
      description: `health check for ${url}`,
    });
  }

  /**
   * Keep checking until healthy or throw error
   */
  private async checkHealthUntilHealthy(url: string, timeout: number): Promise<HealthCheckResult> {
    const result = await this.checkHttp(url, { timeout });

    if (!result.healthy) {
      throw new Error(`Health check failed: ${result.error || `HTTP ${result.statusCode}`}`);
    }

    return result;
  }

  /**
   * HTTP fetch with timeout using AbortController
   */
  private async fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        method: 'GET',
        headers: {
          'User-Agent': 'Dynia-HealthCheck/1.0',
        },
      });

      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Factory function to create health provider
 */
export function createHealthProvider(logger: ILogger): IHealthProvider {
  return new HealthProvider(logger);
}
