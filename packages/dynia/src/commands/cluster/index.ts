import type { CommandModule } from 'yargs';

import type { GlobalConfigOptions } from '../../internal/types.js';
import { createCommandHandler } from '../../shared/base/base-command.js';
import { ClusterCreateHaCommand } from './cluster-create-ha.js';
import { ClusterDestroyCommand } from './cluster-destroy.js';
import { ClusterListCommand } from './cluster-list.js';
import { ClusterNodeAddCommand } from './cluster-node-add.js';
import { ClusterNodeListCommand } from './cluster-node-list.js';
import { ClusterNodeRemoveCommand } from './cluster-node-remove.js';
import { ClusterNodeActivateCommand } from './cluster-node-activate.js';
import { ClusterReservedIpAssignCommand } from './cluster-reserved-ip-assign.js';
import { ClusterReservedIpListCommand } from './cluster-reserved-ip-list.js';
import { ClusterDeploymentCreateCommand } from './cluster-deployment-create.js';
import { ClusterRepairHaCommand } from './cluster-repair-ha.js';
import { ClusterNodePrepareCommand } from './cluster-node-prepare.js';
import { ClusterPrepareCommand } from './cluster-prepare.js';

/**
 * Cluster management command module
 */
export const clusterCommand: CommandModule<GlobalConfigOptions> = {
  command: 'cluster <action>',
  describe: 'Manage HA clusters with Reserved IP and host-based routing',
  builder: yargs =>
    yargs
      .command({
        command: 'create-ha',
        describe: 'Create a new HA cluster (starts with 1 node)',
        builder: yargs =>
          yargs
            .option('name', {
              type: 'string',
              describe: 'Cluster name',
              demandOption: true,
            })
            .option('region', {
              type: 'string',
              describe: 'DigitalOcean region',
              default: 'nyc3',
            })
            .option('size', {
              type: 'string',
              describe: 'Default droplet size for nodes',
              default: 's-1vcpu-1gb',
            })
            .option('base-domain', {
              type: 'string',
              describe: 'Base domain for services (e.g., example.com)',
              demandOption: true,
            })
            .example(
              '$0 cluster create-ha --name myapp --region sgp1 --base-domain example.com',
              'Create HA cluster in Singapore region'
            )
            .example(
              '$0 cluster create-ha --name webapp --base-domain mycompany.com',
              'Create HA cluster with custom domain'
            ),
        handler: createCommandHandler(ClusterCreateHaCommand),
      })
      .command({
        command: 'destroy <name>',
        describe: 'Destroy a cluster and all its resources',
        builder: yargs =>
          yargs
            .positional('name', {
              type: 'string',
              describe: 'Cluster name to destroy',
              demandOption: true,
            })
            .option('confirm', {
              type: 'boolean',
              describe: 'Confirm destruction without prompt',
              default: false,
            })
            .example('$0 cluster destroy myapp --confirm', 'Destroy cluster with confirmation'),
        handler: createCommandHandler(ClusterDestroyCommand),
      })
      .command({
        command: 'list',
        aliases: ['ls'],
        describe: 'List all clusters',
        builder: yargs => yargs.example('$0 cluster list', 'Show all clusters'),
        handler: createCommandHandler(ClusterListCommand),
      })
      .command({
        command: 'node <action>',
        describe: 'Manage cluster nodes',
        builder: yargs =>
          yargs
            .command({
              command: 'add',
              describe: 'Add node(s) to cluster',
              builder: yargs =>
                yargs
                  .option('cluster', {
                    type: 'string',
                    describe: 'Cluster name',
                    demandOption: true,
                  })
                  .option('count', {
                    type: 'number',
                    describe: 'Number of nodes to add',
                    default: 1,
                  })
                  .example('$0 cluster node add --cluster myapp', 'Add one node to cluster')
                  .example('$0 cluster node add --cluster myapp --count 2', 'Add two nodes to cluster'),
              handler: createCommandHandler(ClusterNodeAddCommand),
            })
            .command({
              command: 'remove',
              describe: 'Remove a node from cluster',
              builder: yargs =>
                yargs
                  .option('cluster', {
                    type: 'string',
                    describe: 'Cluster name',
                    demandOption: true,
                  })
                  .option('node', {
                    type: 'string',
                    describe: 'Two-word node ID (e.g., brave-panda)',
                    demandOption: true,
                  })
                  .option('confirm', {
                    type: 'boolean',
                    describe: 'Confirm removal without prompt',
                    default: false,
                  })
                  .example(
                    '$0 cluster node remove --cluster myapp --node brave-panda --confirm',
                    'Remove node from cluster'
                  ),
              handler: createCommandHandler(ClusterNodeRemoveCommand),
            })
            .command({
              command: 'activate',
              describe: 'Make a node active (move Reserved IP)',
              builder: yargs =>
                yargs
                  .option('cluster', {
                    type: 'string',
                    describe: 'Cluster name',
                    demandOption: true,
                  })
                  .option('node', {
                    type: 'string',
                    describe: 'Two-word node ID to make active',
                    demandOption: true,
                  })
                  .example(
                    '$0 cluster node activate --cluster myapp --node misty-owl',
                    'Make misty-owl the active node'
                  ),
              handler: createCommandHandler(ClusterNodeActivateCommand),
            })
            .command({
              command: 'list',
              describe: 'List nodes in a cluster',
              builder: yargs =>
                yargs
                  .option('cluster', {
                    type: 'string',
                    describe: 'Cluster name',
                    demandOption: true,
                  })
                  .example('$0 cluster node list --cluster myapp', 'List all nodes in cluster'),
              handler: createCommandHandler(ClusterNodeListCommand),
            })
            .command({
              command: 'prepare',
              describe: 'Prepare node infrastructure (Docker + Caddy + keepalived)',
              builder: yargs =>
                yargs
                  .option('cluster', {
                    type: 'string',
                    describe: 'Cluster name',
                    demandOption: true,
                  })
                  .option('node', {
                    type: 'string',
                    describe: 'Two-word node ID to prepare',
                    demandOption: true,
                  })
                  .option('force', {
                    type: 'boolean',
                    describe: 'Force re-preparation even if node appears ready',
                    default: false,
                  })
                  .example(
                    '$0 cluster node prepare --cluster myapp --node brave-panda',
                    'Prepare node infrastructure'
                  )
                  .example(
                    '$0 cluster node prepare --cluster myapp --node brave-panda --force',
                    'Force re-preparation of node'
                  ),
              handler: createCommandHandler(ClusterNodePrepareCommand),
            })
            .demandCommand(1, 'Please specify a node action')
            .help(),
        handler: () => {
          // This will never be called due to demandCommand(1)
        },
      })
      .command({
        command: 'deployment <action>',
        describe: 'Manage cluster service deployments',
        builder: yargs =>
          yargs
            .command({
              command: 'create',
              describe: 'Deploy services to cluster with host-based routing',
              builder: yargs =>
                yargs
                  .option('name', {
                    type: 'string',
                    describe: 'Cluster name',
                    demandOption: true,
                  })
                  .option('compose', {
                    type: 'string',
                    describe: 'Path to docker-compose.yml file',
                  })
                  .option('domain', {
                    type: 'string',
                    describe: 'FQDN to bind service to (e.g., api.example.com)',
                  })
                  .option('placeholder', {
                    type: 'boolean',
                    describe: 'Deploy placeholder service for testing',
                    default: false,
                  })
                  .option('health-path', {
                    type: 'string',
                    describe: 'Health check path',
                    default: '/healthz',
                  })
                  .option('proxied', {
                    type: 'boolean',
                    describe: 'Enable Cloudflare proxy',
                    default: true,
                  })
                  .check(argv => {
                    if (!argv.placeholder && (!argv.compose || !argv.domain)) {
                      throw new Error('Either --placeholder or both --compose and --domain are required');
                    }
                    return true;
                  })
                  .example(
                    '$0 cluster deployment create --name myapp --compose ./app.yml --domain myapp-api.example.com',
                    'Deploy app with custom domain'
                  )
                  .example('$0 cluster deployment create --name myapp --placeholder', 'Deploy test placeholder'),
              handler: createCommandHandler(ClusterDeploymentCreateCommand),
            })
            .demandCommand(1, 'Please specify a deployment action')
            .help(),
        handler: () => {
          // This will never be called due to demandCommand(1)
        },
      })
      .command({
        command: 'prepare <name>',
        describe: 'Prepare cluster infrastructure on all nodes',
        builder: yargs =>
          yargs
            .positional('name', {
              type: 'string',
              describe: 'Cluster name to prepare',
              demandOption: true,
            })
            .option('force', {
              type: 'boolean',
              describe: 'Force re-preparation of all nodes',
              default: false,
            })
            .option('parallel', {
              type: 'boolean',
              describe: 'Prepare nodes in parallel (faster but harder to debug)',
              default: false,
            })
            .example('$0 cluster prepare myapp', 'Prepare all nodes in cluster')
            .example('$0 cluster prepare myapp --force --parallel', 'Force parallel preparation'),
        handler: createCommandHandler(ClusterPrepareCommand),
      })
      .command({
        command: 'repair-ha <name>',
        describe: 'Repair cluster infrastructure',
        builder: yargs =>
          yargs
            .positional('name', {
              type: 'string',
              describe: 'Cluster name to repair',
              demandOption: true,
            })
            .option('check-only', {
              type: 'boolean',
              describe: 'Only check status, do not repair',
              default: false,
            })
            .option('force', {
              type: 'boolean',
              describe: 'Execute repairs without confirmation',
              default: false,
            })
            .example('$0 cluster repair-ha myapp --check-only', 'Check cluster health')
            .example('$0 cluster repair-ha myapp --force', 'Force repair cluster'),
        handler: createCommandHandler(ClusterRepairHaCommand),
      })
      .command({
        command: 'reserved-ip <action>',
        describe: 'Manage Reserved IP assignments',
        builder: yargs =>
          yargs
            .command({
              command: 'assign',
              describe: 'Assign Reserved IP to cluster node',
              builder: yargs =>
                yargs
                  .option('cluster', {
                    type: 'string',
                    describe: 'Cluster name',
                    demandOption: true,
                  })
                  .option('node', {
                    type: 'string', 
                    describe: 'Node ID to assign Reserved IP to',
                    demandOption: true,
                  })
                  .example(
                    '$0 cluster reserved-ip assign --cluster myapp --node brave-panda',
                    'Assign Reserved IP to specific node'
                  ),
              handler: createCommandHandler(ClusterReservedIpAssignCommand),
            })
            .command({
              command: 'list',
              aliases: ['ls'],
              describe: 'List all Reserved IPs and their assignment status',
              builder: yargs =>
                yargs
                  .option('region', {
                    type: 'string',
                    describe: 'Filter by DigitalOcean region (e.g., nyc3, sgp1)',
                  })
                  .option('status', {
                    type: 'string',
                    choices: ['assigned', 'unassigned', 'all'],
                    describe: 'Filter by assignment status',
                    default: 'all',
                  })
                  .example('$0 cluster reserved-ip list', 'List all Reserved IPs')
                  .example('$0 cluster reserved-ip list --region nyc3', 'List Reserved IPs in NYC region')
                  .example('$0 cluster reserved-ip list --status unassigned', 'List available Reserved IPs'),
              handler: createCommandHandler(ClusterReservedIpListCommand),
            })
            .demandCommand(1, 'Please specify a Reserved IP action')
            .help(),
        handler: () => {
          // This will never be called due to demandCommand(1)
        },
      })
      .demandCommand(1, 'Please specify a cluster action')
      .help(),
  handler: () => {
    // This will never be called due to demandCommand(1)
  },
};