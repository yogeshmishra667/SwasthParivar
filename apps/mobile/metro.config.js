const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.disableHierarchicalLookup = true;
config.resolver.unstable_enableSymlinks = true;
config.resolver.unstable_enablePackageExports = true;

// TypeScript workspace packages use `.js` extensions in imports for ESM compat,
// but Metro resolves them literally. Redirect `.js` → `.ts` / `.tsx` for
// anything under the workspace packages/ directory.
const defaultResolver = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.endsWith(".js")) {
    const tsName = moduleName.slice(0, -3);
    for (const ext of [".ts", ".tsx"]) {
      try {
        return context.resolveRequest(context, tsName + ext, platform);
      } catch {
        // not found with this ext, try next
      }
    }
    // also try extensionless (Metro will apply its own extension list)
    try {
      return context.resolveRequest(context, tsName, platform);
    } catch {
      // fall through to default
    }
  }
  if (defaultResolver) return defaultResolver(context, moduleName, platform);
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: "./global.css" });
