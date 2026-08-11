const { rm } = require('node:fs/promises');
const { join } = require('node:path');

/**
 * ORT ships prebuilt binaries for every platform inside one package, and a build can only ever
 * load its own. Dropping the rest here rather than through `files` keeps the config free of
 * per-platform rules, so `pnpm dist` needs no edits on a different OS.
 */
const PLATFORMS = ['darwin', 'linux', 'win32'];

exports.default = async function afterPack(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  const resources =
    electronPlatformName === 'darwin'
      ? join(appOutDir, `${packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
      : join(appOutDir, 'resources');

  const bin = join(resources, 'app.asar.unpacked/node_modules/onnxruntime-node/bin/napi-v6');
  const drop = PLATFORMS.filter((name) => name !== electronPlatformName);
  await Promise.all(drop.map((name) => rm(join(bin, name), { recursive: true, force: true })));
};
