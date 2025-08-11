import { ConsoleLogger, type ILogger } from '@thaitype/core-utils';
import type { ArgumentsCamelCase, CommandModule } from 'yargs';

// import { ConfigLoader } from '../commands/ConfigLoader.js';
// import { GenerateCommand, type GenerateCommandOptions } from '../commands/generate/index.js';
import { handlerError } from '../internal/error.js';
import type { GlobalConfigOptions } from '../internal/types.js';

export interface GenerateCommandOptions {
  outDir?: string;
  stdout?: boolean;
  filter?: string[];
}

export const generateCommand: CommandModule<GlobalConfigOptions, GenerateCommandOptions> = {
  command: 'generate',
  describe: 'Generate a stack into yaml files',
  builder: yargs =>
    yargs
      .option('outDir', {
        type: 'string',
        describe: 'Output directory',
        default: 'output',
      })
      .option('stdout', {
        type: 'boolean',
        describe: 'Output to stdout',
        default: false,
      })
      .option('filter', {
        type: 'string',
        describe: 'Filter stacks or resources by ID (e.g., myStack or myStack.resource)',
        array: true,
      }),
  handler: async (argv: ArgumentsCamelCase<GenerateCommandOptions>) => {
    const logger: ILogger = argv.stdout
      ? new ConsoleLogger('silent')
      : ((argv.logger ?? new ConsoleLogger('info')) as ILogger);

    try {
      console.log('start mock generate command');
    } catch (error) {
      handlerError(error, logger);
    }
  },
};
