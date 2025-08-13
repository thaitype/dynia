import { BaseCommand } from '../../shared/base/base-command.js';
import { SSHExecutor } from '../../shared/utils/ssh.js';
import type { ClusterNode, Cluster } from '../../shared/types/index.js';
import { Table } from 'console-table-printer';
import pAll from 'p-all';

export interface ClusterConfigInspectOptions {
  component?: string;
  node?: string;
  full?: boolean;
  routes?: boolean;
}

interface ComponentConfig {
  component: string;
  node: string;
  status: string;
  key_config: Record<string, string>;
  full_config?: string;
}

/**
 * Command to inspect live configuration of cluster nodes across all components
 * Shows configuration for Caddy, Docker, HAProxy, keepalived, and system info
 * Includes routing information and active node identification
 */
export class ClusterConfigInspectCommand extends BaseCommand<ClusterConfigInspectOptions> {
  private readonly supportedComponents = ['caddy', 'docker', 'haproxy', 'keepalived', 'system'];

  protected async run(): Promise<void> {
    const { name, component, node, full, routes } = this.argv;

    // Validate inputs (cluster name handled by parent command)
    if (!name) {
      throw new Error('Cluster name is required. Use --name <cluster-name>');
    }
    
    const clusterName = name as string;

    if (component && !this.supportedComponents.includes(component)) {
      throw new Error(`Unsupported component '${component}'. Supported components: ${this.supportedComponents.join(', ')}`);
    }

    this.logger.info(`Inspecting configuration for cluster: ${clusterName}`);

    // Get cluster
    const cluster = await this.stateManager.getCluster(clusterName);
    if (!cluster) {
      throw new Error(`Cluster '${clusterName}' not found. Use 'dynia cluster create-ha' to create it first.`);
    }

    // Get cluster nodes
    const allNodes = await this.stateManager.getClusterNodes(clusterName);
    
    if (allNodes.length === 0) {
      this.logger.info(`No nodes found in cluster '${clusterName}'.`);
      this.logger.info(`Add nodes with: dynia cluster node add --name ${clusterName}`);
      return;
    }

    // Filter nodes if specified
    let targetNodes = allNodes;
    if (node) {
      targetNodes = allNodes.filter(n => n.twoWordId === node);
      if (targetNodes.length === 0) {
        throw new Error(`Node '${node}' not found in cluster '${clusterName}'.`);
      }
    }

    // Determine components to inspect
    const componentsToInspect = routes ? ['caddy', 'haproxy'] : (component ? [component] : this.supportedComponents);

    // Show cluster overview with active node information
    const activeNode = allNodes.find(n => n.role === 'active');
    const reservedIpInfo = cluster.reservedIp ? ` (Reserved IP: ${cluster.reservedIp})` : '';
    
    this.logger.info(`\nCluster: ${clusterName}${reservedIpInfo}`);
    this.logger.info(`Active Node: ${activeNode ? `🟢 ${activeNode.twoWordId} (${activeNode.publicIp})` : '❌ None'}`);
    this.logger.info(`Total Nodes: ${allNodes.length} (${allNodes.filter(n => n.role === 'active').length} active, ${allNodes.filter(n => n.role === 'standby').length} standby)`);
    this.logger.info(`Inspecting: ${targetNodes.length} node(s), ${componentsToInspect.join(', ')} component(s)`);
    this.logger.info(`Mode: ${full ? 'Full Configuration' : 'Summary'}\n`);

    // Collect configurations from all nodes and components
    const configurations: ComponentConfig[] = [];

    for (const targetNode of targetNodes) {
      this.logger.info(`Inspecting node: ${targetNode.twoWordId} (${targetNode.publicIp})`);
      
      for (const comp of componentsToInspect) {
        try {
          const config = await this.inspectComponent(targetNode, comp, full || false);
          configurations.push(config);
        } catch (error) {
          this.logger.warn(`Failed to inspect ${comp} on ${targetNode.twoWordId}: ${error}`);
          configurations.push({
            component: comp,
            node: targetNode.twoWordId,
            status: 'Error',
            key_config: { error: error instanceof Error ? error.message : String(error) }
          });
        }
      }
    }

    // Display results
    if (routes) {
      this.displayRoutingSummary(configurations, allNodes, cluster);
    } else if (full) {
      this.displayFullConfiguration(configurations, allNodes);
    } else {
      this.displaySummaryConfiguration(configurations, allNodes);
    }

    // Show helpful commands
    if (!routes) {
      console.log('\nUseful commands:');
      console.log(`  dynia cluster config inspect --name ${clusterName} --routes # Show routing summary`);
      console.log(`  dynia cluster config inspect --name ${clusterName} --full # Show full configurations`);
      if (!component) {
        console.log(`  dynia cluster config inspect --name ${clusterName} --component caddy # Filter by component`);
        console.log(`  dynia cluster config inspect --name ${clusterName} --component haproxy # Show HAProxy config`);
      }
      if (!node && targetNodes.length > 1) {
        console.log(`  dynia cluster config inspect --name ${clusterName} --node ${targetNodes[0].twoWordId} # Filter by node`);
      }
      console.log(`  dynia cluster node list --name ${clusterName} # Show node status`);
    }
  }

  /**
   * Inspect a specific component on a node
   */
  private async inspectComponent(node: ClusterNode, component: string, full: boolean): Promise<ComponentConfig> {
    const ssh = new SSHExecutor(node.publicIp, this.logger);

    switch (component) {
      case 'caddy':
        return await this.inspectCaddy(ssh, node, full);
      case 'docker':
        return await this.inspectDocker(ssh, node, full);
      case 'haproxy':
        return await this.inspectHaproxy(ssh, node, full);
      case 'keepalived':
        return await this.inspectKeepalived(ssh, node, full);
      case 'system':
        return await this.inspectSystem(ssh, node, full);
      default:
        throw new Error(`Unknown component: ${component}`);
    }
  }

  /**
   * Inspect Caddy configuration and status
   */
  private async inspectCaddy(ssh: SSHExecutor, node: ClusterNode, full: boolean): Promise<ComponentConfig> {
    const config: ComponentConfig = {
      component: 'caddy',
      node: node.twoWordId,
      status: 'Unknown',
      key_config: {}
    };

    try {
      // Create parallel SSH tasks
      const sshTasks = [
        () => ssh.executeCommand('docker ps --filter "name=dynia-caddy" --format "{{.Status}}"'),
        () => ssh.executeCommand('test -f /opt/dynia/caddy/Caddyfile && echo "exists" || echo "missing"'),
        () => ssh.executeCommand('grep -c "^[a-zA-Z0-9.-]\\+\\.[a-zA-Z]\\+.*{" /opt/dynia/caddy/Caddyfile || echo "0"'),
        () => ssh.executeCommand('curl -f --connect-timeout 2 --max-time 5 http://localhost:8080/dynia-health >/dev/null 2>&1')
          .then(() => 'accessible')
          .catch(() => 'not-accessible'),
        () => ssh.executeCommand('docker inspect dynia-caddy --format "{{.State.Health.Status}}" 2>/dev/null || echo "no-healthcheck"'),
        () => ssh.executeCommand('grep -E "^[a-zA-Z0-9.-]+\\.[a-zA-Z]+" /opt/dynia/caddy/Caddyfile | head -5 | tr "\\n" "," | sed "s/,$//g" || echo "none"'),
        () => ssh.executeCommand('grep -E "reverse_proxy" /opt/dynia/caddy/Caddyfile | grep -oE "[a-zA-Z0-9.-]+:[0-9]+" | head -3 | tr "\\n" "," | sed "s/,$//g" || echo "none"')
      ];

      // Add full config task if needed
      if (full) {
        sshTasks.push(() => ssh.executeCommand('cat /opt/dynia/caddy/Caddyfile'));
      }

      // Execute all SSH commands in parallel
      const results = await pAll(sshTasks, { concurrency: 7 });

      // Process results
      const [containerStatus, caddyfileExists, domainCount, adminApiResult, healthStatus, routeDomains, routeTargets, fullConfigResult] = results;
      
      config.status = containerStatus.trim() ? 'Running' : 'Stopped';
      config.key_config.caddyfile = caddyfileExists.trim();
      
      if (caddyfileExists.trim() === 'exists') {
        config.key_config.domains = domainCount.trim();
        config.key_config.admin_api = adminApiResult === 'accessible' ? 'Accessible' : 'Not accessible';
        config.key_config.route_domains = routeDomains.trim();
        config.key_config.route_targets = routeTargets.trim();
        
        if (full && fullConfigResult) {
          config.full_config = fullConfigResult;
        }
      }

      // Set health status if container is running
      if (config.status === 'Running') {
        config.key_config.health = healthStatus.trim();
      }

    } catch (error) {
      config.status = 'Error';
      config.key_config.error = error instanceof Error ? error.message : String(error);
    }

    return config;
  }

  /**
   * Inspect Docker configuration and status
   */
  private async inspectDocker(ssh: SSHExecutor, node: ClusterNode, full: boolean): Promise<ComponentConfig> {
    const config: ComponentConfig = {
      component: 'docker',
      node: node.twoWordId,
      status: 'Unknown',
      key_config: {}
    };

    try {
      // Create parallel SSH tasks
      const sshTasks = [
        () => ssh.executeCommand('systemctl is-active docker || echo "inactive"'),
        () => ssh.executeCommand('docker ps -q | wc -l'),
        () => ssh.executeCommand('docker network ls -q | wc -l'),
        () => ssh.executeCommand('docker network ls --filter "name=edge" --format "{{.Name}}" | head -1 || echo "missing"'),
        () => ssh.executeCommand('docker --version | cut -d" " -f3 | cut -d"," -f1')
      ];

      // Add full config task if needed
      if (full) {
        sshTasks.push(() => ssh.executeCommand('docker ps --format "table {{.Names}}\\t{{.Image}}\\t{{.Status}}\\t{{.Ports}}"'));
      }

      // Execute all SSH commands in parallel
      const results = await pAll(sshTasks, { concurrency: 7 });

      // Process results
      const [dockerStatus, containerCount, networkCount, edgeNetwork, dockerVersion, containerDetails] = results;
      
      config.status = dockerStatus.trim() === 'active' ? 'Running' : 'Stopped';
      config.key_config.running_containers = containerCount.trim();
      config.key_config.networks = networkCount.trim();
      config.key_config.edge_network = edgeNetwork.trim();
      config.key_config.version = dockerVersion.trim();

      if (full && containerDetails) {
        config.full_config = containerDetails;
      }

    } catch (error) {
      config.status = 'Error';
      config.key_config.error = error instanceof Error ? error.message : String(error);
    }

    return config;
  }

  /**
   * Inspect HAProxy configuration and status (System service)
   */
  private async inspectHaproxy(ssh: SSHExecutor, node: ClusterNode, full: boolean): Promise<ComponentConfig> {
    const config: ComponentConfig = {
      component: 'haproxy',
      node: node.twoWordId,
      status: 'Unknown',
      key_config: {}
    };

    try {
      // Check if HAProxy is installed as system service
      const haproxyExists = await ssh.executeCommand('which haproxy >/dev/null 2>&1 && echo "installed" || echo "not-installed"');
      
      if (haproxyExists.trim() === 'not-installed') {
        config.status = 'Not Configured';
        config.key_config.installation = 'Not installed';
        return config;
      }

      // Create parallel SSH tasks for system HAProxy
      const sshTasks = [
        () => ssh.executeCommand('systemctl is-active haproxy 2>/dev/null || echo "inactive"'),
        () => ssh.executeCommand('test -f /etc/haproxy/haproxy.cfg && echo "exists" || echo "missing"')
      ];

      // Execute initial tasks in parallel
      const [serviceStatus, configExists] = await pAll(sshTasks, { concurrency: 7 });
      
      config.status = serviceStatus.trim() === 'active' ? 'Running' : 'Stopped';
      config.key_config.config_file = configExists.trim();
      config.key_config.service_status = serviceStatus.trim();

      // Additional tasks based on config existence
      const additionalTasks = [];

      if (configExists.trim() === 'exists') {
        additionalTasks.push(
          () => ssh.executeCommand('grep -c "^\\s*server\\s" /etc/haproxy/haproxy.cfg || echo "0"'),
          () => ssh.executeCommand('grep -c "^\\s*backend\\s" /etc/haproxy/haproxy.cfg || echo "0"'),
          () => ssh.executeCommand('grep -oE "bind.*:[0-9]+" /etc/haproxy/haproxy.cfg | head -3 | tr "\\n" "," | sed "s/,$//g" || echo "none"')
        );
        
        if (full) {
          additionalTasks.push(() => ssh.executeCommand('cat /etc/haproxy/haproxy.cfg'));
        }
      }

      // Check HAProxy stats if running
      if (config.status === 'Running') {
        additionalTasks.push(() => ssh.executeCommand('curl -s http://localhost:8404/stats 2>/dev/null | grep -q "HAProxy Statistics" && echo "accessible" || echo "not-accessible"'));
      }

      // Get service logs if there are issues
      if (config.status === 'Stopped') {
        additionalTasks.push(() => ssh.executeCommand('systemctl status haproxy --no-pager -l | tail -5 | tr "\\n" "; " || echo "no-logs"'));
      }

      // Get process information
      additionalTasks.push(() => ssh.executeCommand('pgrep haproxy >/dev/null && echo "running" || echo "not-running"'));

      // Execute additional tasks in parallel if any
      if (additionalTasks.length > 0) {
        const additionalResults = await pAll(additionalTasks, { concurrency: 7 });
        let resultIndex = 0;

        if (configExists.trim() === 'exists') {
          config.key_config.servers = additionalResults[resultIndex].trim();
          resultIndex++;
          config.key_config.backends = additionalResults[resultIndex].trim();
          resultIndex++;
          config.key_config.listen_ports = additionalResults[resultIndex].trim();
          resultIndex++;
          
          if (full) {
            config.full_config = additionalResults[resultIndex];
            resultIndex++;
          }
        }

        if (config.status === 'Running') {
          config.key_config.stats_page = additionalResults[resultIndex].trim();
          resultIndex++;
        }

        if (config.status === 'Stopped') {
          config.key_config.recent_logs = additionalResults[resultIndex].trim();
          resultIndex++;
        }

        // Always get process status (last task)
        config.key_config.process_status = additionalResults[resultIndex].trim();
      }

    } catch (error) {
      config.status = 'Error';
      config.key_config.error = error instanceof Error ? error.message : String(error);
    }

    return config;
  }

  /**
   * Inspect keepalived configuration and status
   */
  private async inspectKeepalived(ssh: SSHExecutor, node: ClusterNode, full: boolean): Promise<ComponentConfig> {
    const config: ComponentConfig = {
      component: 'keepalived',
      node: node.twoWordId,
      status: 'Unknown',
      key_config: {}
    };

    try {
      // Check if keepalived is installed/configured first
      const keepalivedExists = await ssh.executeCommand('which keepalived >/dev/null 2>&1 && echo "installed" || echo "not-installed"');
      
      if (keepalivedExists.trim() === 'not-installed') {
        config.status = 'Not Configured';
        config.key_config.installation = 'Not installed';
        return config;
      }

      // Create parallel SSH tasks for installed keepalived
      const sshTasks = [
        () => ssh.executeCommand('systemctl is-active keepalived 2>/dev/null || echo "inactive"'),
        () => ssh.executeCommand('test -f /etc/keepalived/keepalived.conf && echo "exists" || echo "missing"')
      ];

      // Execute initial tasks in parallel
      const [serviceStatus, configExists] = await pAll(sshTasks, { concurrency: 7 });
      
      config.status = serviceStatus.trim() === 'active' ? 'Running' : 'Stopped';
      config.key_config.config_file = configExists.trim();

      // Additional tasks based on config existence and service status
      const additionalTasks = [];

      if (configExists.trim() === 'exists') {
        additionalTasks.push(() => ssh.executeCommand('grep -E "^\\s*state|^\\s*priority" /etc/keepalived/keepalived.conf | head -2 | tr "\\n" " " || echo "unknown"'));
        
        if (full) {
          additionalTasks.push(() => ssh.executeCommand('cat /etc/keepalived/keepalived.conf'));
        }
      }

      if (config.status === 'Running') {
        additionalTasks.push(() => ssh.executeCommand('ip -br addr show | grep -q "scope global secondary" && echo "has-vip" || echo "no-vip"'));
      }

      // Execute additional tasks in parallel if any
      if (additionalTasks.length > 0) {
        const additionalResults = await pAll(additionalTasks, { concurrency: 7 });
        let resultIndex = 0;

        if (configExists.trim() === 'exists') {
          config.key_config.vrrp_config = additionalResults[resultIndex].trim();
          resultIndex++;
          
          if (full) {
            config.full_config = additionalResults[resultIndex];
            resultIndex++;
          }
        }

        if (config.status === 'Running') {
          config.key_config.virtual_ip = additionalResults[resultIndex].trim();
        }
      }

    } catch (error) {
      config.status = 'Error';
      config.key_config.error = error instanceof Error ? error.message : String(error);
    }

    return config;
  }

  /**
   * Inspect system configuration and status
   */
  private async inspectSystem(ssh: SSHExecutor, node: ClusterNode, full: boolean): Promise<ComponentConfig> {
    const config: ComponentConfig = {
      component: 'system',
      node: node.twoWordId,
      status: 'Running',
      key_config: {}
    };

    try {
      // Create parallel SSH tasks
      const sshTasks = [
        () => ssh.executeCommand('uptime -p'),
        () => ssh.executeCommand('free -h | grep Mem | awk \'{print $3 "/" $2}\''),
        () => ssh.executeCommand('df -h /opt/dynia | tail -1 | awk \'{print $3 "/" $2 " (" $5 ")"}\''),
        () => ssh.executeCommand('cat /proc/loadavg | cut -d" " -f1-3'),
        () => ssh.executeCommand('find /opt/dynia -maxdepth 2 -type d | wc -l')
      ];

      // Add full config task if needed
      if (full) {
        sshTasks.push(() => ssh.executeCommand('uname -a; echo "---"; df -h; echo "---"; free -h; echo "---"; ps aux --sort=-%mem | head -10'));
      }

      // Execute all SSH commands in parallel
      const results = await pAll(sshTasks, { concurrency: 7 });

      // Process results
      const [uptime, memUsage, diskUsage, loadAvg, dyniaStructure, systemInfo] = results;
      
      config.key_config.uptime = uptime.trim();
      config.key_config.memory = memUsage.trim();
      config.key_config.disk_usage = diskUsage.trim();
      config.key_config.load_average = loadAvg.trim();
      config.key_config.dynia_dirs = dyniaStructure.trim();

      if (full && systemInfo) {
        config.full_config = systemInfo;
      }

    } catch (error) {
      config.status = 'Error';
      config.key_config.error = error instanceof Error ? error.message : String(error);
    }

    return config;
  }

  /**
   * Display summary configuration in table format
   */
  private displaySummaryConfiguration(configurations: ComponentConfig[], allNodes: ClusterNode[]): void {
    const table = new Table({
      columns: [
        { name: 'node', title: 'Node', alignment: 'left' },
        { name: 'component', title: 'Component', alignment: 'left' },
        { name: 'status', title: 'Status', alignment: 'center' },
        { name: 'key_info', title: 'Key Configuration', alignment: 'left' }
      ]
    });

    configurations.forEach(config => {
      const statusIcon = this.getStatusIcon(config.status);
      const keyInfo = this.formatKeyInfo(config.key_config);
      
      // Find if this node is active
      const node = allNodes.find(n => n.twoWordId === config.node);
      const nodeDisplay = node?.role === 'active' ? `🟢 ${config.node}` : config.node;

      table.addRow({
        node: nodeDisplay,
        component: config.component,
        status: `${statusIcon} ${config.status}`,
        key_info: keyInfo
      });
    });

    table.printTable();
  }

  /**
   * Display full configuration with detailed output
   */
  private displayFullConfiguration(configurations: ComponentConfig[], allNodes: ClusterNode[]): void {
    configurations.forEach((config, index) => {
      if (index > 0) console.log('\n' + '='.repeat(80) + '\n');
      
      // Find if this node is active
      const node = allNodes.find(n => n.twoWordId === config.node);
      const nodeDisplay = node?.role === 'active' ? `🟢 ${config.node}` : config.node;
      
      console.log(`Node: ${nodeDisplay} | Component: ${config.component}`);
      console.log(`Status: ${this.getStatusIcon(config.status)} ${config.status}`);
      
      if (Object.keys(config.key_config).length > 0) {
        console.log('\nKey Configuration:');
        Object.entries(config.key_config).forEach(([key, value]) => {
          console.log(`  ${key}: ${value}`);
        });
      }

      if (config.full_config) {
        console.log('\nFull Configuration:');
        console.log('-'.repeat(40));
        console.log(config.full_config);
        console.log('-'.repeat(40));
      }
    });
  }

  /**
   * Get status icon for display
   */
  private getStatusIcon(status: string): string {
    switch (status.toLowerCase()) {
      case 'running':
        return '🟢';
      case 'stopped':
        return '🔴';
      case 'error':
        return '❌';
      case 'not configured':
        return '⚪';
      default:
        return '🟡';
    }
  }

  /**
   * Format key configuration info for table display
   */
  private formatKeyInfo(keyConfig: Record<string, string>): string {
    const items: string[] = [];
    
    Object.entries(keyConfig).forEach(([key, value]) => {
      if (key === 'error') {
        items.push(`❌ ${value}`);
      } else {
        items.push(`${key}: ${value}`);
      }
    });

    return items.slice(0, 3).join(', ') + (items.length > 3 ? '...' : '');
  }

  /**
   * Display routing-focused summary showing domain mappings and active node
   */
  private displayRoutingSummary(configurations: ComponentConfig[], allNodes: ClusterNode[], cluster: Cluster): void {
    const activeNode = allNodes.find(n => n.role === 'active');
    
    console.log('🌐 ROUTING SUMMARY');
    console.log('='.repeat(50));
    
    // Cluster-level routing info
    console.log(`\nCluster: ${cluster.name}`);
    console.log(`Active Node: ${activeNode ? `🟢 ${activeNode.twoWordId} (${activeNode.publicIp})` : '❌ None'}`);
    if (cluster.reservedIp) {
      console.log(`Reserved IP: ${cluster.reservedIp} (receives external traffic)`);
    }
    
    // Extract routing information from Caddy and HAProxy configs
    const routingTable = new Table({
      columns: [
        { name: 'proxy', title: 'Proxy', alignment: 'left' },
        { name: 'node', title: 'Node', alignment: 'left' },
        { name: 'domains', title: 'Domains', alignment: 'left' },
        { name: 'targets', title: 'Backend Targets', alignment: 'left' },
        { name: 'status', title: 'Status', alignment: 'center' }
      ]
    });

    configurations.forEach(config => {
      if (config.component === 'caddy' || config.component === 'haproxy') {
        const node = allNodes.find(n => n.twoWordId === config.node);
        const nodeDisplay = node?.role === 'active' ? `🟢 ${config.node}` : config.node;
        const statusIcon = this.getStatusIcon(config.status);
        
        let domains = 'None';
        let targets = 'None';
        
        if (config.component === 'caddy') {
          domains = config.key_config.route_domains || 'None';
          targets = config.key_config.route_targets || 'None';
        } else if (config.component === 'haproxy') {
          domains = `${config.key_config.listen_ports || 'None'} (ports)`;
          targets = `${config.key_config.servers || '0'} servers`;
        }

        routingTable.addRow({
          proxy: config.component.toUpperCase(),
          node: nodeDisplay,
          domains: domains,
          targets: targets,
          status: `${statusIcon} ${config.status}`
        });
      }
    });

    console.log('\n📊 ROUTING CONFIGURATION:');
    routingTable.printTable();

    // Traffic flow summary
    console.log('\n🔄 TRAFFIC FLOW:');
    if (cluster.reservedIp && activeNode) {
      console.log(`Internet → ${cluster.reservedIp} (Reserved IP) → ${activeNode.twoWordId} (${activeNode.publicIp}) → Backend Services`);
    } else if (activeNode) {
      console.log(`Internet → ${activeNode.twoWordId} (${activeNode.publicIp}) → Backend Services`);
    } else {
      console.log('❌ No active node configured - traffic routing unavailable');
    }
    
    console.log('\n💡 ROUTING TIPS:');
    console.log('• Only the active node receives external traffic');
    console.log('• Standby nodes are ready to take over if active node fails');
    console.log('• Use "dynia cluster node activate" to change the active node');
    console.log('• Check DNS records point to the Reserved IP for high availability');
  }

  protected async validatePrerequisites(): Promise<void> {
    await super.validatePrerequisites();
  }
}