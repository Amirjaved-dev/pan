import { Command } from 'commander';
import { startMesh } from '../shell/mesh.js';

export function createMeshCommand(): Command {
  return new Command('mesh')
    .description('Enter live multi-agent tool exchange TUI (both terminals)')
    .action(async () => {
      await startMesh();
    });
}
