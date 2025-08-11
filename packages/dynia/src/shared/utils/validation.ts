import { z } from 'zod';

/**
 * Common validation schemas and utilities
 */

/**
 * Validate node name format
 */
export const NodeNameSchema = z.string()
  .min(1, 'Node name cannot be empty')
  .max(63, 'Node name cannot exceed 63 characters')
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, 
    'Node name must start and end with alphanumeric characters and contain only lowercase letters, numbers, and hyphens'
  );

/**
 * Validate domain name format
 */
export const DomainSchema = z.string()
  .min(1, 'Domain cannot be empty')
  .regex(/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/, 
    'Invalid domain format'
  );

/**
 * Validate health path format
 */
export const HealthPathSchema = z.string()
  .min(1, 'Health path cannot be empty')
  .regex(/^\/.*$/, 'Health path must start with /')
  .max(255, 'Health path cannot exceed 255 characters');

/**
 * Validate file path format
 */
export const FilePathSchema = z.string()
  .min(1, 'File path cannot be empty')
  .refine(path => !path.includes('..'), 'File path cannot contain ".."')
  .refine(path => path.length <= 4096, 'File path too long');

/**
 * Common validation functions
 */
export class ValidationUtils {
  /**
   * Validate that a node name is available (not already in use)
   */
  static validateNodeNameAvailable(nodeName: string, existingNames: string[]): void {
    if (existingNames.includes(nodeName)) {
      throw new Error(`Node name "${nodeName}" is already in use`);
    }
  }

  /**
   * Validate required CLI arguments are present
   */
  static validateRequiredArgs<T extends Record<string, unknown>>(
    args: T,
    requiredFields: (keyof T)[]
  ): void {
    const missing = requiredFields.filter(field => 
      args[field] === undefined || args[field] === null || args[field] === ''
    );
    
    if (missing.length > 0) {
      throw new Error(`Missing required arguments: ${missing.join(', ')}`);
    }
  }

  /**
   * Validate port number
   */
  static validatePort(port: number): void {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid port number: ${port}. Must be between 1 and 65535`);
    }
  }

  /**
   * Validate IP address format
   */
  static validateIP(ip: string): boolean {
    const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
    return ipv4Regex.test(ip) || ipv6Regex.test(ip);
  }
}