# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Dynia is a lightweight, CLI-driven orchestrator for small clusters that provisions nodes, runs HTTPS proxies, and deploys applications. It's built as a TypeScript monorepo using pnpm workspaces and Turbo for task orchestration.

## Common Commands

### Development
- `pnpm dev` - Start development mode with file watching (excludes template and examples)
- `pnpm build` - Build all packages using Turbo
- `pnpm test` - Run all tests
- `pnpm test:watch` - Run tests in watch mode

### Quality Assurance
- `pnpm lint:check` - Check for linting issues and type errors
- `pnpm lint:fix` - Fix linting issues and format code
- `pnpm format` - Check code formatting
- `pnpm format:fix` - Fix code formatting

### Testing
- `pnpm test:coverage` - Generate test coverage reports
- `pnpm test:view-report` - View test reports

### Release
- `pnpm release` - Build, lint, test, version, and publish using changesets

### Local CLI Testing
- `pnpm --filter @examples/basic dynia` - Run the Dynia CLI in the basic example project (make sure cli is built first)
- `pnpm tsx packages/dynia/src/debug.ts` - Run isolated debugging utilities for data flow testing

### Debugging Commands
- **Debug utilities first**: Create debug.ts scripts to test data flow in isolation before running full commands
- **Full system testing**: Only use full CLI commands after isolated testing confirms data flow
- **Data tracing**: Always trace data from source to destination when debugging

## Architecture

### Monorepo Structure
- **packages/dynia** - Main CLI package with commands and core functionality
- **configs/** - Shared configuration packages (ESLint, TypeScript, Vitest)
- **tools/mono** - Internal build tooling using @thaitype/mono-scripts
- **tools/template** - Package template for new packages

### Build System
- Uses Turbo for task orchestration with dependency management
- Dual package builds (ESM + CJS) using TypeScript + Babel pipeline
- Custom build scripts in tools/mono handle ESM→CJS transformation and annotations

### CLI Architecture
The main CLI (`packages/dynia`) uses:
- **yargs** for command parsing with middleware support
- **Entry point**: `src/cli.ts` → `cli-interfaces/entrypoint.ts`
- **Commands**: Modular command structure (generate command implemented)
- **Binary names**:  `dynia` 

### Package Management
- **pnpm workspaces** with workspace protocol dependencies
- **Node.js 22+** requirement across all packages
- **Changeset-based** versioning and publishing

### Code Quality
- **ESLint** with TypeScript, Prettier, and Turbo plugin integration
- **Prettier** with import sorting and consistent style (120 char width, single quotes)
- **Husky** pre-push hooks run `pnpm lint:husky` (lint + format checks)
- **Vitest** for testing with Istanbul coverage
- **Debug utilities**: Use packages/dynia/src/debug.ts for isolated component testing

## Key Technical Details

### Build Pipeline
Each package follows this build sequence:
1. `build-esm` - TypeScript compilation to ESM
2. `build-cjs` - Babel transformation to CommonJS 
3. `build-annotate` - Pure call annotations for tree shaking

### Dependencies
- **Core**: Uses `@thaitype/core-utils` for logging, `zod` for validation
- **CLI**: `yargs` for argument parsing, `execa` for process execution
- **Utilities**: `lodash-es`, `hotscript`, `unconfig`, `yaml`

### Configuration
- TypeScript configs extend from `@dynia/config-typescript` 
- ESLint configs extend from `@dynia/config-eslint`
- Vitest configs use `@dynia/config-vitest`

## Cluster Architecture

### High Availability Design
- **L3/L4 Failover**: Reserved IP binding using keepalived (for node-level failover)
- **L7 Load Balancing**: HAProxy distributes traffic to apps on all nodes via VPC private IPs
- **Critical**: HAProxy must receive ALL cluster nodes, not just filtered nodes for preparation

### Data Flow Patterns
- **Node Filtering**: `cluster prepare --node <name>` filters nodes for preparation but NOT for configuration
- **Service Configuration**: HAProxy, keepalived configs need complete cluster node data
- **Parameter Passing**: Separate `nodesToPrepare` (filtered) from `allNodes` (for config)

## Debugging Best Practices

### Methodology
1. **Listen to User Feedback**: Pay attention to user guidance about root cause areas
2. **Isolated Testing**: Create debug utilities (debug.ts) to test small components before full system runs
3. **Data Flow Tracing**: Always verify data from source to destination, don't assume intermediate steps
4. **Simple Solutions First**: Most bugs have simple fixes - avoid overengineering complex solutions

### Common Pitfalls
- **Wrong Assumptions**: Don't assume where bugs are located without verification
- **Overengineered Solutions**: Prefer finding simple root causes over complex fixes
- **Full System Testing**: Avoid running full commands (2+ minute cycles) when debugging data flow
- **Parameter Passing**: Be extremely careful about what data is passed between services

### Debug Workflow
1. **Create debug.ts**: Write isolated test scripts for suspected problem areas
2. **Verify Data Flow**: Test that correct data reaches each service layer
3. **Trace Parameters**: Follow data from command parsing through service calls
4. **Simple Validation**: Use logging and debug output to verify assumptions

### Development Workflow Guidelines
- **Debug First**: Create isolated tests before debugging full system flows
- **Keep Debug Tools**: Maintain debug.ts and similar utilities for future use
- **User Feedback**: Take user criticism as valuable guidance about debugging approach
- **Focus**: Don't get distracted by secondary issues when debugging core functionality