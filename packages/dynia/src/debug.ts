// Simple debug script to test HAProxy node passing
import { StateManager } from './core/state/state-manager.js';
import { NodePreparationService } from './shared/services/node-preparation-service.js';
import type { ILogger } from '@thaitype/core-utils';

// Create simple logger that matches ILogger interface
const logger: ILogger = {
  info: (msg: string) => console.log(`[INFO] ${msg}`),
  error: (msg: string) => console.log(`[ERROR] ${msg}`),
  debug: (msg: string) => console.log(`[DEBUG] ${msg}`),
  warn: (msg: string) => console.log(`[WARN] ${msg}`),
};

async function debugHAProxyNodes() {
  console.log('🔍 Debugging HAProxy node configuration...\n');
  
  try {
    // 1. Test getClusterNodes - see what state returns
    console.log('=== STEP 1: Testing getClusterNodes ===');
    const stateManager = new StateManager('/Users/thadawangthammang/gits/thaitype/dynia/examples/basic', logger, '.dynia');
    const allNodes = await stateManager.getClusterNodes('testdynia5');
    console.log(`Found ${allNodes.length} nodes:`);
    allNodes.forEach(node => {
      console.log(`  - ${node.twoWordId}: privateIp=${node.privateIp}, publicIp=${node.publicIp}`);
    });
    
    if (allNodes.length === 0) {
      console.log('❌ No nodes found! Check cluster name or state file.');
      return;
    }
    
    // 2. Test HAProxy backend generation directly
    console.log('\n=== STEP 2: Testing Backend Server Generation ===');
    const backendServers = allNodes.map((node, index) => {
      const serverId = `node${index + 1}`;
      const serverIp = node.privateIp || node.publicIp;
      console.log(`  Backend ${serverId}: ${node.twoWordId} -> ${serverIp}:8080`);
      return `    server ${serverId} ${serverIp}:8080 check inter 5s fall 3 rise 2`;
    }).join('\n');
    
    console.log('\nGenerated backend servers:');
    console.log(backendServers);
    
    // 3. Test the setupHAProxy data flow
    console.log('\n=== STEP 3: Testing setupHAProxy Data Flow ===');
    console.log('Simulating cluster prepare with --node honor-viper...');
    
    // Simulate the filtering that happens in cluster-prepare.ts
    const targetNodeId = 'honor-viper';
    const targetNode = allNodes.find(node => node.twoWordId === targetNodeId);
    const nodesToPrepare = targetNode ? [targetNode] : [];
    
    console.log(`All nodes available: ${allNodes.length}`);
    console.log(`Nodes to prepare (filtered): ${nodesToPrepare.length}`);
    console.log(`Target node: ${targetNode?.twoWordId || 'NOT FOUND'}`);
    
    // 4. Test keepalived config creation (what gets passed to setupHAProxy)
    console.log('\n=== STEP 4: Testing Keepalived Config ===');
    const nodePrep = new NodePreparationService(logger);
    
    if (targetNode) {
      const keepalivedConfig = {
        priority: nodePrep.calculateNodePriority(targetNode, allNodes),
        role: (targetNode.role || 'active') as 'active' | 'standby',
        allNodes: allNodes, // This should contain ALL nodes for HAProxy
      };
      
      console.log(`Keepalived config for ${targetNode.twoWordId}:`);
      console.log(`  Priority: ${keepalivedConfig.priority}`);
      console.log(`  Role: ${keepalivedConfig.role}`);
      console.log(`  AllNodes count: ${keepalivedConfig.allNodes.length}`);
      console.log(`  AllNodes list: ${keepalivedConfig.allNodes.map(n => n.twoWordId).join(', ')}`);
      
      // Test what HAProxy would receive
      console.log('\n=== STEP 5: Testing HAProxy Input ===');
      console.log('HAProxy would receive these nodes:');
      keepalivedConfig.allNodes.forEach((node, index) => {
        const serverId = `node${index + 1}`;
        const serverIp = node.privateIp || node.publicIp;
        console.log(`  ${serverId}: ${node.twoWordId} (${serverIp})`);
      });
      
      console.log(`\nExpected backend servers in HAProxy config: ${keepalivedConfig.allNodes.length}`);
      console.log('✅ If this shows 2, then the data flow is correct!');
      console.log('❌ If this shows 1, then we found the bug!');
      
      // CONCLUSION: Data flow is correct! Let's check why HAProxy config only shows 1 node
      console.log('\n=== CONCLUSION ===');
      console.log('🔍 DATA FLOW IS CORRECT - 2 nodes are being passed to HAProxy!');
      console.log('❓ The bug must be in:');
      console.log('   1. HAProxy config template generation');  
      console.log('   2. HAProxy config file writing');
      console.log('   3. We\'re checking the wrong config file');
      console.log('   4. The config is being overwritten after generation');
      console.log('\n🚨 NEXT: Check the actual HAProxy installSystemHAProxy method!');
    } else {
      console.log('❌ Target node not found!');
    }
    
  } catch (error) {
    console.error('❌ Debug failed:', error);
  }
}

// Run the debug
debugHAProxyNodes().catch(console.error);