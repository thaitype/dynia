import type { CommandModule } from 'yargs';

import type { GlobalConfigOptions } from '../../internal/types.js';
import { createCommandHandler } from '../../shared/base/base-command.js';
import { NodeCreateCommand } from './node-create.js';
import { NodeListCommand } from './node-list.js';

/**
 * Node management command module
 */
export const nodeCommand: CommandModule<GlobalConfigOptions> = {
  command: 'node <action>',
  describe: 'Manage cluster nodes',
  builder: yargs =>
    yargs
      .command({
        command: 'create',
        describe: 'Create a new node',
        builder: yargs =>
          yargs
            .option('name', {
              type: 'string',
              describe: 'Base node name',
              demandOption: true,
            })
            .option('number', {
              type: 'number',
              describe: 'Node number (optional, creates name-number pattern)',
            })
            .option('health-path', {
              type: 'string',
              describe: 'Health check path for this node',
              default: '/',
            })
            .example('$0 node create --name webserver --number 1', 'Create a node named webserver-1')
            .example('$0 node create --name apiserver --number 2', 'Create a node named apiserver-2')
            .example('$0 node create --name database', 'Create a single node named database'),
        handler: createCommandHandler(NodeCreateCommand),
      })
      .command({
        command: 'list',
        aliases: ['ls'],
        describe: 'List all nodes',
        builder: yargs => yargs.example('$0 node list', 'Show all nodes'),
        handler: createCommandHandler(NodeListCommand),
      })
      .demandCommand(1, 'Please specify a node action')
      .help(),
  handler: () => {
    // This will never be called due to demandCommand(1)
  },
};