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