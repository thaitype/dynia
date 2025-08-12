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
import { ClusterDeployCommand } from './cluster-deploy.js';
import { ClusterRepairHaCommand } from './cluster-repair-ha.js';

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
                  .option('name', {
                    type: 'string',
                    describe: 'Cluster name',
                    demandOption: true,
                  })
                  .option('count', {
                    type: 'number',
                    describe: 'Number of nodes to add',
                    default: 1,
                  })
                  .example('$0 cluster node add --name myapp', 'Add one node to cluster')
                  .example('$0 cluster node add --name myapp --count 2', 'Add two nodes to cluster'),
              handler: createCommandHandler(ClusterNodeAddCommand),
            })
            .command({
              command: 'remove <cluster-name> <node-id>',
              describe: 'Remove a node from cluster',
              builder: yargs =>
                yargs
                  .positional('cluster-name', {
                    type: 'string',
                    describe: 'Cluster name',
                    demandOption: true,
                  })
                  .positional('node-id', {
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
                    '$0 cluster node remove myapp brave-panda --confirm',
                    'Remove node from cluster'
                  ),
              handler: createCommandHandler(ClusterNodeRemoveCommand),
            })
            .command({
              command: 'activate <cluster-name> <node-id>',
              describe: 'Make a node active (move Reserved IP)',
              builder: yargs =>
                yargs
                  .positional('cluster-name', {
                    type: 'string',
                    describe: 'Cluster name',
                    demandOption: true,
                  })
                  .positional('node-id', {
                    type: 'string',
                    describe: 'Two-word node ID to make active',
                    demandOption: true,
                  })
                  .example(
                    '$0 cluster node activate myapp misty-owl',
                    'Make misty-owl the active node'
                  ),
              handler: createCommandHandler(ClusterNodeActivateCommand),
            })
            .command({
              command: 'list <cluster-name>',
              describe: 'List nodes in a cluster',
              builder: yargs =>
                yargs
                  .positional('cluster-name', {
                    type: 'string',
                    describe: 'Cluster name',
                    demandOption: true,
                  })
                  .example('$0 cluster node list myapp', 'List all nodes in cluster'),
              handler: createCommandHandler(ClusterNodeListCommand),
            })
            .demandCommand(1, 'Please specify a node action')
            .help(),
        handler: () => {
          // This will never be called due to demandCommand(1)
        },
      })
      .command({
        command: 'deploy',
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
              '$0 cluster deploy --name myapp --compose ./app.yml --domain api.example.com',
              'Deploy app with custom domain'
            )
            .example('$0 cluster deploy --name myapp --placeholder', 'Deploy test placeholder'),
        handler: createCommandHandler(ClusterDeployCommand),
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