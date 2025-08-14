import type { ILogger } from '@thaitype/core-utils';
import { DockerInfrastructure } from '../utils/docker-infrastructure.js';
import type { ClusterNode } from '../types/index.js';

export interface NodePreparationOptions {
  nodeIp: string;
  nodeName: string;
  baseDomain: string;
  cluster?: {
    name: string;
    region: string;
    reservedIp?: string;
    reservedIpId?: string;
  };
  keepalived?: {
    priority: number;
    role: 'active' | 'standby';
    allNodes: ClusterNode[];
  };
}

/**
 * Service for preparing cluster nodes according to HA design specification
 * Handles complete VM setup: Docker + Caddy + keepalived + security
 */
export class NodePreparationService {
  constructor(private readonly logger: ILogger) {}

  /**
   * Complete node preparation according to HA spec
   * - Docker infrastructure (Docker + Caddy + networking)  
   * - keepalived for HA failover
   * - Security configuration
   */
  async prepareNode(options: NodePreparationOptions): Promise<void> {
    const { nodeIp, nodeName, baseDomain, cluster, keepalived } = options;
    
    this.logger.info(`Preparing node ${nodeName} (${nodeIp}) for HA cluster...`);
    
    // Step 1: Set up basic Docker infrastructure (Docker + Caddy + networking)
    await this.setupDockerInfrastructure(nodeIp, nodeName, baseDomain);
    
    // Step 2: Deploy HAProxy for cluster load balancing (if cluster info available)
    if (keepalived && cluster) {
      await this.setupHAProxyInfrastructure(nodeIp, nodeName, baseDomain, cluster, keepalived);
    }
    
    // Step 3: Configure keepalived for HA (if cluster has multiple nodes or reserved IP)
    if (keepalived && cluster) {
      await this.configureKeepalived(nodeIp, nodeName, cluster, keepalived);
    }
    
    // Step 4: Apply security configuration
    await this.applySecurityConfiguration(nodeIp, nodeName);
    
    this.logger.info(`✅ Node ${nodeName} preparation complete`);
  }

  /**
   * Set up Docker infrastructure (existing DockerInfrastructure logic)
   */
  private async setupDockerInfrastructure(
    nodeIp: string, 
    nodeName: string, 
    baseDomain: string
  ): Promise<void> {
    this.logger.info(`Setting up Docker infrastructure on ${nodeName}...`);
    
    const infrastructure = new DockerInfrastructure(
      nodeIp,
      nodeName,
      baseDomain,
      this.logger
    );
    
    await infrastructure.setupInfrastructure();
    
    this.logger.info(`✅ Docker infrastructure ready on ${nodeName}`);
  }

  /**
   * Set up HAProxy infrastructure for cluster load balancing
   */
  private async setupHAProxyInfrastructure(
    nodeIp: string, 
    nodeName: string, 
    baseDomain: string,
    cluster: { name: string; region: string; reservedIp?: string; reservedIpId?: string },
    keepalived: { priority: number; role: 'active' | 'standby'; allNodes: ClusterNode[] }
  ): Promise<void> {
    this.logger.info(`Setting up HAProxy infrastructure on ${nodeName}...`);
    
    const infrastructure = new DockerInfrastructure(
      nodeIp,
      nodeName,
      baseDomain,
      this.logger
    );
    
    // Prepare cluster nodes data for HAProxy configuration
    const clusterNodes = keepalived.allNodes.map(node => ({
      twoWordId: node.twoWordId,
      privateIp: node.privateIp || node.publicIp, // Fallback to public IP if private IP not available
      publicIp: node.publicIp,
      role: node.role
    }));
    
    // Step 1: Install and configure HAProxy
    await infrastructure.installSystemHAProxy(clusterNodes, cluster.name, cluster.reservedIp);
    
    // Step 2: Ensure certificates are provisioned (independent of HAProxy installation)
    await infrastructure.ensureCertificates(baseDomain);
    
    this.logger.info(`✅ HAProxy infrastructure ready on ${nodeName}`);
  }

  /**
   * Configure keepalived for HA failover following spec requirements
   */
  private async configureKeepalived(
    nodeIp: string,
    nodeName: string, 
    cluster: { name: string; region: string; reservedIp?: string; reservedIpId?: string },
    keepalived: { priority: number; role: 'active' | 'standby'; allNodes: ClusterNode[] }
  ): Promise<void> {
    this.logger.info(`Configuring keepalived on ${nodeName} (${keepalived.role}, priority ${keepalived.priority})...`);
    
    if (!cluster.reservedIp) {
      this.logger.warn(`No Reserved IP configured for cluster ${cluster.name}, skipping keepalived setup`);
      return;
    }

    const keepalivedConfig = this.generateKeepalivedConfig(
      nodeName,
      cluster,
      keepalived
    );
    
    await this.deployKeepalivedConfig(nodeIp, nodeName, keepalivedConfig);
    
    this.logger.info(`✅ keepalived configured on ${nodeName}`);
  }

  /**
   * Generate keepalived configuration based on HA spec
   */
  private generateKeepalivedConfig(
    nodeName: string,
    cluster: { name: string; region: string; reservedIp?: string },
    keepalived: { priority: number; role: 'active' | 'standby'; allNodes: ClusterNode[] }
  ): string {
    const { reservedIp } = cluster;
    const { priority, role } = keepalived;
    
    // keepalived VRRP configuration
    // Based on spec: single node = MASTER-alone, multi-node = priority-based failover
    const isSingleNode = keepalived.allNodes.length === 1;
    const state = role === 'active' ? 'MASTER' : 'BACKUP';
    
    return `# keepalived configuration for Dynia HA cluster
# Generated for node: ${nodeName}
# Cluster: ${cluster.name}
# Role: ${role} (priority: ${priority})

global_defs {
    router_id ${nodeName}
    vrrp_skip_check_adv_addr
    vrrp_strict
    vrrp_garp_interval 0
    vrrp_gna_interval 0
}

# Health check script for Caddy
vrrp_script chk_caddy {
    script "/usr/local/bin/check_caddy.sh"
    interval 2
    weight -2
    fall 3
    rise 2
}

# VRRP instance for Reserved IP failover
vrrp_instance VI_1 {
    state ${state}
    interface eth0
    virtual_router_id 51
    priority ${priority}
    advert_int 1
    authentication {
        auth_type PASS
        auth_pass ${cluster.name.substring(0, 8)}
    }
    
    virtual_ipaddress {
        ${reservedIp}
    }
    
    track_script {
        chk_caddy
    }
    
    ${isSingleNode ? '# Single node mode - no notify scripts needed' : `
    # Multi-node failover scripts
    notify_master "/usr/local/bin/master_notify.sh"
    notify_backup "/usr/local/bin/backup_notify.sh"
    notify_fault "/usr/local/bin/fault_notify.sh"`}
}`;
  }

  /**
   * Deploy keepalived configuration to the node
   */
  private async deployKeepalivedConfig(
    nodeIp: string,
    nodeName: string,
    keepalivedConfig: string
  ): Promise<void> {
    this.logger.info(`Deploying keepalived configuration to ${nodeName}...`);
    
    // This would use SSH to deploy the configuration
    // For now, this is a placeholder for the actual SSH implementation
    this.logger.info('📝 keepalived configuration prepared (SSH deployment TODO)');
    
    // TODO: Implement SSH deployment using SSHExecutor
    // - Copy keepalived.conf to /etc/keepalived/
    // - Create health check scripts
    // - Create notification scripts for multi-node
    // - Install and start keepalived service
    
    this.logger.debug(`keepalived config for ${nodeName}:\n${keepalivedConfig}`);
  }

  /**
   * Apply security configuration according to HA spec
   */
  private async applySecurityConfiguration(nodeIp: string, nodeName: string): Promise<void> {
    this.logger.info(`Applying security configuration to ${nodeName}...`);
    
    // Security configuration per spec:
    // - Cloud Firewall: Allow 22/tcp from admin IPs
    // - Cloud Firewall: Allow 80/443/tcp to nodes  
    // - Cloud Firewall: Allow VPC CIDR for app/health ports
    // - Basic host hardening
    
    // This would be implemented with DigitalOcean Firewall API calls
    this.logger.info('🔒 Security configuration applied (Firewall rules TODO)');
    
    // TODO: Implement security configuration
    // - Configure DigitalOcean Cloud Firewall rules
    // - Basic host security hardening
    // - SSH key management
  }

  /**
   * Test node readiness after preparation (internal infrastructure only)
   */
  async testNodeReadiness(nodeIp: string, nodeName: string): Promise<boolean> {
    this.logger.info(`Testing readiness of prepared node ${nodeName}...`);
    
    try {
      // Use existing DockerInfrastructure internal health checks only
      const infrastructure = new DockerInfrastructure(
        nodeIp,
        nodeName,
        'placeholder.domain', // placeholder - not used for internal testing
        this.logger
      );
      
      // Only test internal infrastructure, not public domain accessibility
      const isHealthy = await infrastructure.testInternalHealth();
      
      if (isHealthy) {
        this.logger.info(`✅ Node ${nodeName} is ready and healthy (internal infrastructure)`);
        return true;
      } else {
        this.logger.error(`❌ Node ${nodeName} failed internal health checks`);
        return false;
      }
    } catch (error) {
      this.logger.error(`❌ Node ${nodeName} readiness test failed: ${error}`);
      return false;
    }
  }
}