import { z } from 'zod';

// Core domain types based on specification

/**
 * Node status in the cluster
 */
export const NodeStatus = z.enum(['active', 'inactive', 'provisioning', 'failed']);
export type NodeStatus = z.infer<typeof NodeStatus>;

/**
 * Deployment status
 */
export const DeploymentStatus = z.enum(['active', 'failed', 'deploying', 'rolled-back']);
export type DeploymentStatus = z.infer<typeof DeploymentStatus>;

/**
 * Caddy target configuration
 */
export const CaddyTargetSchema = z.object({
  service: z.string(),
  port: z.number().int().min(1).max(65535),
});
export type CaddyTarget = z.infer<typeof CaddyTargetSchema>;

/**
 * Caddy configuration for a node
 */
export const CaddyConfigSchema = z.object({
  domain: z.string(),
  target: CaddyTargetSchema,
});
export type CaddyConfig = z.infer<typeof CaddyConfigSchema>;

/**
 * Node definition in state
 */
export const NodeSchema = z.object({
  name: z.string(),
  ip: z.string().ip(),
  fqdn: z.string(),
  createdAt: z.string().datetime(),
  status: NodeStatus,
  healthPath: z.string().default('/'),
  caddy: CaddyConfigSchema,
});
export type Node = z.infer<typeof NodeSchema>;

/**
 * Deployment definition in state
 */
export const DeploymentSchema = z.object({
  node: z.string(),
  composeHash: z.string(),
  entryService: z.string(),
  entryPort: z.number().int().min(1).max(65535),
  domain: z.string(),
  status: DeploymentStatus,
  updatedAt: z.string().datetime(),
});
export type Deployment = z.infer<typeof DeploymentSchema>;

/**
 * Complete application state schema
 */
export const AppStateSchema = z.object({
  nodes: z.array(NodeSchema),
  deployments: z.array(DeploymentSchema),
});
export type AppState = z.infer<typeof AppStateSchema>;

/**
 * Command result interface
 */
export interface CommandResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Secret configuration loaded from environment variables only
 * NEVER store these in files or state
 */
export interface SecretConfig {
  digitalOceanToken: string;
  cloudflareToken: string;
  cloudflareZoneId: string;
}

/**
 * Non-sensitive configuration with defaults
 */
export interface PublicConfig {
  digitalOcean: {
    region: string;
    size: string;
  };
  cloudflare: {
    domain: string;
  };
  docker: {
    host?: string;
    certPath?: string;
  };
  stateDir: string;
}

/**
 * Runtime configuration combining secrets and public config
 */
export interface RuntimeConfig {
  secrets: SecretConfig;
  public: PublicConfig;
}
