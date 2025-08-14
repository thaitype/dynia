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
- `pnpm tsx packages/dynia/src/debug/test-cli.ts` - Run isolated debugging utilities for data flow testing (need to create test-cli.ts first)

### Cluster Testing Commands
- `dynia cluster deployment create --placeholder <cluster>` - Deploy test service to ALL cluster nodes
- `dynia cluster node list <cluster>` - Verify cluster configuration and node status
- `curl https://domain.com/` - Test application-level load balancing (shows serving node)
- `dynia cluster config inspect <cluster> --routing-summary` - Verify HAProxy backend configurations

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

## Infrastructure Rules

### Node Configuration Consistency
- **CRITICAL**: All cluster nodes must have identical configurations for proper load balancing
- **Caddyfile**: Every node must have the same route configurations
- **HAProxy**: All nodes must have identical backend server lists (all cluster nodes)
- **Services**: Applications must be deployed to ALL nodes for load balancing to work
- **Infrastructure**: Docker, networking, and proxy configs must be consistent across nodes

### Service Deployment Architecture
- **Cluster Commands Default**: All `cluster` commands operate on ALL nodes unless explicitly filtered
- **Load Balancing Requirement**: Services must exist on ALL backend servers for HAProxy to work
- **Single-Node Deployment**: Only use for infrastructure setup, never for applications
- **Deployment Verification**: Always test that services respond from all cluster nodes

### Application vs Infrastructure Separation
- **Infrastructure Layer**: Node preparation, networking, proxy setup (system-level)
- **Application Layer**: Service deployments, routing, health checks (app-level)  
- **Placeholder Services**: Part of APPLICATION layer, not infrastructure
- **Command Responsibility**: `cluster prepare` = infrastructure, `cluster deployment create` = application

## High Availability Rules

### L3/L4 vs L7 Load Balancing Patterns
- **L3/L4 (Reserved IP + keepalived)**: Node-level failover for infrastructure services
  - Use for: Infrastructure components, single active service patterns
  - Behavior: One node active at a time, others standby
- **L7 (HAProxy)**: Application-level load balancing across all nodes  
  - Use for: Application services, traffic distribution
  - Behavior: All nodes active, traffic distributed via round-robin

### Cluster Command Behavior
- **Default Scope**: Cluster commands operate on ALL nodes unless explicitly limited
- **Node Filtering**: Use `--node` for targeting specific operations, not changing architecture
- **Configuration Consistency**: Filtered operations must maintain cluster-wide configuration consistency
- **Load Balancing**: Never deploy applications to single nodes in cluster mode

### Deployment Architecture Principles
1. **All-Nodes Deployment**: Applications must deploy to ALL cluster nodes for load balancing
2. **Parallel Execution**: Use `Promise.all()` for efficient cluster-wide operations
3. **Configuration Sync**: Update configurations on all nodes after deployments
4. **Health Validation**: Verify services are accessible from all backend nodes

## Deployment Patterns

### Application Service Deployment
```typescript
// CORRECT: Deploy to all cluster nodes
const allNodes = await this.stateManager.getClusterNodes(name);
await this.deployServiceToAllNodes(allNodes, domain, placeholder, compose, healthPath);

// WRONG: Deploy to single node (breaks load balancing)  
const activeNode = await this.stateManager.getActiveClusterNode(name);
await this.deployServiceToNode(activeNode, domain, placeholder, compose, healthPath);
```

### Placeholder Service Rules
- **Purpose**: Testing and validation of cluster deployment architecture
- **Layer**: Application layer, not infrastructure layer
- **Deployment**: Must use `cluster deployment create --placeholder`, never manual deployment
- **Location**: Deploy to ALL cluster nodes for proper load balancing testing
- **Validation**: Verify load balancing works by testing traffic distribution

### Load Balancing Validation
```bash
# Test service deployment to all nodes
pnpm --filter @examples/basic dynia cluster deployment create --placeholder <cluster-name>

# Verify load balancing at APPLICATION level (should show different nodes)
for i in {1..4}; do 
  echo "Request $i:"; 
  curl -s https://your-domain.com/ | grep -o "node: [^)]*"
done

# Expected: Alternating node names
# Request 1: node: honor-viper
# Request 2: node: crystal-panda  
# Request 3: node: honor-viper
# Request 4: node: crystal-panda

# NOTE: Test root path (/) not /dynia-health (HAProxy infrastructure level)
```

### Configuration Management
- **Caddyfile Generation**: Use `regenerateCompleteCaddyfileOnAllNodes()` for cluster-wide updates
- **Route Consistency**: All nodes must have identical routing configurations
- **Health Check Paths**: Consistent across all nodes for proper HAProxy health monitoring
- **TLS Configuration**: Consistent certificate handling across cluster nodes

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

### Cluster Architecture Debugging
- **Node Consistency**: Always verify all cluster nodes have identical configurations
- **Load Balancing Issues**: Check if services exist on ALL backend nodes, not just one
- **Data Flow**: Trace from command input → service calls → node operations
- **Deployment Scope**: Verify cluster commands operate on all nodes, not single nodes
- **Configuration Validation**: Test routing, health checks, and service availability on each node

### Infrastructure vs Application Debugging
- **Layer Separation**: Don't use infrastructure tools for application problems
- **Command Scope**: Verify cluster commands default to cluster-wide operations  
- **Service Distribution**: Confirm applications deploy to all nodes for load balancing
- **Architecture Validation**: Test that HAProxy backends match deployed services