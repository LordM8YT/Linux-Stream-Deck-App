const path = require('node:path');
const { spawnSync } = require('node:child_process');

const filesToCheck = [
  'electron/main.js',
  'electron/preload.js',
  'src/main/ipc/channels.js',
  'src/main/ipc/registerHandlers.js',
  'src/main/runtime/AppRuntime.js',
  'src/main/services/layout/LayoutService.js',
  'src/main/services/obs/ObsService.js',
  'src/main/services/plugins/PluginImportService.js',
  'src/main/services/plugins/PluginManager.js',
  'src/main/services/storage/AppStateStore.js',
  'src/main/services/streamDeck/defaultDeckProfile.js',
  'src/main/services/streamDeck/StreamDeckService.js',
  'src/renderer/main.mjs',
  'src/renderer/previewRenderer.mjs',
  'plugins/com.linuxstreamdeck.demo.hello/index.js',
  'plugins/com.linuxstreamdeck.obs/index.js'
];

for (const relativeFile of filesToCheck) {
  const absoluteFile = path.join(process.cwd(), relativeFile);
  const result = spawnSync(process.execPath, ['--check', absoluteFile], {
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

console.log(`Syntax check passed for ${filesToCheck.length} files.`);
