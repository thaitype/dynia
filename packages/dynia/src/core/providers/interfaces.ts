/**
 * Provider interfaces for clean architecture
 * These abstractions allow for dependency injection and testing
 */

/**
 * DigitalOcean droplet information
 */
export interface DropletInfo {
  id: string;
  name: string;
  ip: string;
  region: string;
  size: string;
  status: 'new' | 'active' | 'off' | 'archive';
}

/**
 * DigitalOcean SSH key information
 */
export interface SSHKeyInfo {
  id: string;
  name: string;
  fingerprint: string;
  publicKey: string;
}

/**
 * DigitalOcean Reserved IP information
 */
export interface ReservedIpInfo {
  id: string;
  ip: string;
  region: string;
  dropletId?: string; // null if unassigned
}

/**
 * DigitalOcean VPC information
 */
export interface VpcInfo {
  id: string;
  name: string;
  region: string;
  ipRange: string; // CIDR block
}

/**
 * DigitalOcean provider interface
 */
export interface IDigitalOceanProvider {
  /**
   * Create a new droplet
   */
  createDroplet(options: {
    name: string;
    region: string;
    size: string;
    image: string;
    sshKeys?: string[];
  }): Promise<DropletInfo>;

  /**
   * Get droplet information by ID
   */
  getDroplet(dropletId: string): Promise<DropletInfo>;

  /**
   * Delete a droplet
   */
  deleteDroplet(dropletId: string): Promise<void>;

  /**
   * Wait for droplet to reach active status
   */
  waitForDropletActive(dropletId: string, timeoutMs?: number): Promise<DropletInfo>;

  /**
   * Create SSH key in DigitalOcean account
   */
  createSSHKey(options: { name: string; publicKey: string }): Promise<SSHKeyInfo>;

  /**
   * List SSH keys in DigitalOcean account
   */
  listSSHKeys(): Promise<SSHKeyInfo[]>;

  /**
   * Get SSH key by ID or fingerprint
   */
  getSSHKey(idOrFingerprint: string): Promise<SSHKeyInfo | null>;

  /**
   * Delete SSH key from DigitalOcean account
   */
  deleteSSHKey(idOrFingerprint: string): Promise<void>;

  // Reserved IP management
  
  /**
   * Create a new Reserved IP in specified region
   */
  createReservedIp(region: string): Promise<ReservedIpInfo>;

  /**
   * Create a new Reserved IP and assign it to a droplet atomically
   */
  createReservedIpWithDroplet(dropletId: string, region: string): Promise<ReservedIpInfo>;

  /**
   * List all Reserved IPs
   */
  listReservedIps(): Promise<ReservedIpInfo[]>;

  /**
   * Get Reserved IP information by ID
   */
  getReservedIp(reservedIpId: string): Promise<ReservedIpInfo>;

  /**
   * Assign Reserved IP to a droplet
   */
  assignReservedIp(reservedIpId: string, dropletId: string): Promise<void>;

  /**
   * Unassign Reserved IP from current droplet
   */
  unassignReservedIp(reservedIpId: string): Promise<void>;

  /**
   * Delete Reserved IP
   */
  deleteReservedIp(reservedIpId: string): Promise<void>;

  // VPC management

  /**
   * Create a new VPC in specified region
   */
  createVpc(options: {
    name: string;
    region: string;
    ipRange?: string; // CIDR, defaults to 10.10.0.0/16
  }): Promise<VpcInfo>;

  /**
   * List all VPCs
   */
  listVpcs(): Promise<VpcInfo[]>;

  /**
   * Get VPC information by ID
   */
  getVpc(vpcId: string): Promise<VpcInfo>;

  /**
   * Delete VPC
   */
  deleteVpc(vpcId: string): Promise<void>;
}

/**
 * DNS record information
 */
export interface DnsRecord {
  id: string;
  type: string;
  name: string;
  value: string;
  ttl: number;
  proxied: boolean;
}

/**
 * Cloudflare provider interface
 */
export interface ICloudflareProvider {
  /**
   * Create or update an A record
   */
  upsertARecord(options: { name: string; ip: string; ttl?: number; proxied?: boolean }): Promise<DnsRecord>;

  /**
   * Get DNS record by name
   */
  getDnsRecord(name: string): Promise<DnsRecord | null>;

  /**
   * Delete DNS record
   */
  deleteDnsRecord(recordId: string): Promise<void>;

  /**
   * Wait for DNS propagation to specified resolvers
   */
  waitForDnsPropagation(fqdn: string, expectedIp: string, timeoutMs?: number): Promise<void>;

  /**
   * Deploy Cloudflare Worker with origins
   */
  deployWorker(options: { scriptName: string; origins: string[] }): Promise<void>;
}

/**
 * Docker container information
 */
export interface ContainerInfo {
  id: string;
  name: string;
  status: string;
  ports: Array<{ internal: number; external?: number }>;
}

/**
 * Docker compose service information
 */
export interface ComposeServiceInfo {
  name: string;
  ports: number[];
  labels: Record<string, string>;
}

/**
 * Docker provider interface
 */
export interface IDockerProvider {
  /**
   * Execute docker-compose command
   */
  composeUp(
    composeFile: string,
    options?: {
      detach?: boolean;
      pull?: boolean;
    }
  ): Promise<void>;

  /**
   * Stop and remove containers
   */
  composeDown(composeFile: string): Promise<void>;

  /**
   * Get service information from compose file
   */
  getComposeServices(composeFile: string): Promise<ComposeServiceInfo[]>;

  /**
   * Create Docker network
   */
  createNetwork(name: string): Promise<void>;

  /**
   * Check if network exists
   */
  networkExists(name: string): Promise<boolean>;

  /**
   * Get container status
   */
  getContainer(name: string): Promise<ContainerInfo | null>;

  /**
   * Execute command in container
   */
  exec(containerName: string, command: string[]): Promise<string>;
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  healthy: boolean;
  statusCode?: number;
  responseTime?: number;
  error?: string;
}

/**
 * Health check provider interface
 */
export interface IHealthProvider {
  /**
   * Check HTTP endpoint health
   */
  checkHttp(
    url: string,
    options?: {
      timeout?: number;
      expectedStatus?: number[];
    }
  ): Promise<HealthCheckResult>;

  /**
   * Check health with retries
   */
  checkHealthWithRetries(
    url: string,
    options?: {
      maxAttempts?: number;
      retryDelay?: number;
      timeout?: number;
    }
  ): Promise<HealthCheckResult>;
}
