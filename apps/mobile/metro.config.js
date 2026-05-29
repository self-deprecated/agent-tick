const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const nodeNextJavaScriptExtension = /\.js$/;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('.') && nodeNextJavaScriptExtension.test(moduleName)) {
    try {
      return context.resolveRequest(
        context,
        moduleName.replace(nodeNextJavaScriptExtension, ''),
        platform
      );
    } catch {
      // Fall back to Metro's default lookup so real .js files still resolve normally.
    }
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
