import { z } from 'zod';

// Core domain types based on specification

/**
 * Node status in the cluster
 */
export const NodeStatus = z.enum([
  'active', // Fully operational
  'inactive', // Stopped/disabled
  'provisioning', // Generic provisioning (backward compatibility)
  'failed', // Creation or operation failed
  // Progressive creation states
  'droplet-created', // DigitalOcean droplet created
  'dns-configured', // Cloudflare DNS record created
  'dns-ready', // DNS propagation verified
  'infrastructure-ready', // Docker infrastructure deployed
]);
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
 * Cluster definition for HA architecture
 */
export const ClusterSchema = z.object({
  name: z.string(),
  baseDomain: z.string(), // e.g., "example.com"
  reservedIp: z.string().ip(),
  reservedIpId: z.string(), // DigitalOcean Reserved IP ID
  region: z.string(),
  vpcId: z.string().optional(), // VPC ID for private networking
  size: z.string(), // default node size
  activeNodeId: z.string(), // two-word ID of active node
  createdAt: z.string().datetime(),
});
export type Cluster = z.infer<typeof ClusterSchema>;

/**
 * Node role in cluster
 */
export const ClusterNodeRole = z.enum(['active', 'standby']);
export type ClusterNodeRole = z.infer<typeof ClusterNodeRole>;

/**
 * Enhanced node for cluster context
 */
export const ClusterNodeSchema = z.object({
  twoWordId: z.string(), // e.g., "misty-owl"
  clusterId: z.string(),
  dropletId: z.string(),
  hostname: z.string(), // e.g., "myapp-misty-owl"
  publicIp: z.string().ip(),
  privateIp: z.string().ip().optional(), // VPC private IP
  role: ClusterNodeRole,
  priority: z.number(), // keepalived priority (higher = preferred)
  status: NodeStatus,
  createdAt: z.string().datetime(),
});
export type ClusterNode = z.infer<typeof ClusterNodeSchema>;

/**
 * Service routing configuration for host-based routing
 */
export const RouteSchema = z.object({
  host: z.string(), // e.g., "api.example.com"
  clusterId: z.string(),
  serviceRef: z.string().optional(), // docker service name (optional for placeholder)
  port: z.number().int().min(1).max(65535).optional(),
  healthPath: z.string().default('/healthz'),
  proxied: z.boolean().default(true), // Cloudflare proxy enabled
  tlsEnabled: z.boolean().default(true),
  isPlaceholder: z.boolean().default(false), // Is this a placeholder service
  composePath: z.string().optional(), // Path to docker-compose file for custom services
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  // Keep deployedAt for backward compatibility
  deployedAt: z.string().datetime().optional(),
});
export type Route = z.infer<typeof RouteSchema>;

/**
 * Complete application state schema with HA support
 */
export const AppStateSchema = z.object({
  // Legacy single nodes (backward compatibility)
  nodes: z.array(NodeSchema),
  deployments: z.array(DeploymentSchema),
  
  // New HA cluster architecture
  clusters: z.array(ClusterSchema).default([]),
  clusterNodes: z.array(ClusterNodeSchema).default([]),
  routes: z.array(RouteSchema).default([]),
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
  sshKeyId: string; // DigitalOcean SSH key ID or fingerprint
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
