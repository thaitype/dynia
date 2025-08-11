import type { ILogger } from '@thaitype/core-utils';
import type { ArgumentsCamelCase } from 'yargs';

import type { RuntimeConfig, CommandResult } from '../types/index.js';
import type { GlobalConfigOptions } from '../../internal/types.js';
import { StateManager } from '../../core/state/state-manager.js';
import { ConfigLoader } from '../../core/config/config-loader.js';

/**
 * Base class for all Dynia commands
 * Provides common functionality and dependency injection
 */
export abstract class BaseCommand<TOptions = Record<string, unknown>> {
  protected readonly logger: ILogger;
  protected readonly config: RuntimeConfig;
  protected readonly stateManager: StateManager;
  protected readonly dryRun: boolean;

  constructor(
    protected readonly argv: ArgumentsCamelCase<GlobalConfigOptions & TOptions>
  ) {
    this.logger = argv.logger!;
    this.dryRun = argv.dryRun || false;
    
    // Load configuration from environment
    const configLoader = new ConfigLoader(this.logger);
    this.config = configLoader.loadConfig();
    
    // Initialize state manager
    const rootDir = argv.root || process.cwd();
    this.stateManager = new StateManager(
      rootDir,
      this.logger,
      this.config.public.stateDir
    );
  }

  /**
   * Execute the command with error handling
   */
  async execute(): Promise<CommandResult> {
    try {
      this.logger.debug(`Executing ${this.constructor.name}${this.dryRun ? ' (dry run)' : ''}`);
      
      // Validate configuration before execution
      await this.validatePrerequisites();
      
      // Execute the actual command
      const result = await this.run();
      
      this.logger.debug(`${this.constructor.name} completed successfully`);
      return { success: true, data: result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`${this.constructor.name} failed: ${message}`);
      
      if (this.logger.level === 'debug' && error instanceof Error && error.stack) {
        this.logger.error(`Stack trace: ${error.stack}`);
      }
      
      return { success: false, error: message };
    }
  }

  /**
   * Abstract method for command implementation
   */
  protected abstract run(): Promise<void | unknown>;

  /**
   * Validate prerequisites before command execution
   * Override in subclasses for specific validation
   */
  protected async validatePrerequisites(): Promise<void> {
    // Base validation - ensure state can be loaded
    await this.stateManager.loadState();
  }

  /**
   * Helper for dry-run logging
   */
  protected logDryRun(action: string): void {
    if (this.dryRun) {
      this.logger.info(`[DRY RUN] Would ${action}`);
    }
  }

  /**
   * Helper to execute action conditionally based on dry-run mode
   */
  protected async conditionalExecute<T>(
    action: () => Promise<T>,
    description: string
  ): Promise<T | undefined> {
    if (this.dryRun) {
      this.logDryRun(description);
      return undefined;
    }
    return await action();
  }
}

/**
 * Utility function to create command handlers that use BaseCommand
 */
export function createCommandHandler<TOptions>(
  CommandClass: new (argv: ArgumentsCamelCase<GlobalConfigOptions & TOptions>) => BaseCommand<TOptions>
) {
  return async (argv: ArgumentsCamelCase<GlobalConfigOptions & TOptions>): Promise<void> => {
    const command = new CommandClass(argv);
    const result = await command.execute();
    
    if (!result.success) {
      throw new Error(result.error);
    }
  };
}