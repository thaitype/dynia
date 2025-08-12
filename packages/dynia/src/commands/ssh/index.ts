import type { CommandModule } from 'yargs';

import type { GlobalConfigOptions } from '../../internal/types.js';
import { createCommandHandler } from '../../shared/base/base-command.js';
import { SSHCreateCommand } from './ssh-create.js';
import { SSHListCommand } from './ssh-list.js';

/**
 * SSH key management command module
 */
export const sshCommand: CommandModule<GlobalConfigOptions> = {
  command: 'ssh <action>',
  describe: 'Manage SSH keys for secure droplet access',
  builder: yargs =>
    yargs
      .command({
        command: 'create',
        describe: 'Create and upload SSH key to DigitalOcean',
        builder: yargs =>
          yargs
            .option('key-name', {
              type: 'string',
              describe: 'Name for the SSH key',
              default: 'dynia',
            })
            .option('output-env', {
              type: 'boolean',
              describe: 'Output environment variable for .env file',
              default: false,
            })
            .option('force', {
              type: 'boolean',
              describe: 'Recreate key if it already exists',
              default: false,
            })
            .example('$0 ssh create', 'Create SSH key with default name "dynia"')
            .example('$0 ssh create --key-name mykey', 'Create SSH key with custom name')
            .example('$0 ssh create --output-env', 'Create key and show .env variable')
            .example('$0 ssh create --force', 'Recreate existing SSH key'),
        handler: createCommandHandler(SSHCreateCommand),
      })
      .command({
        command: 'list',
        aliases: ['ls'],
        describe: 'List SSH keys in DigitalOcean account',
        builder: yargs => yargs.example('$0 ssh list', 'Show all SSH keys in your DigitalOcean account'),
        handler: createCommandHandler(SSHListCommand),
      })
      .demandCommand(1, 'Please specify an SSH action')
      .help(),
  handler: () => {
    // This will never be called due to demandCommand(1)
  },
};
