// Re-export the native module. On web, it will be resolved to AgentTickPrivateCryptoModule.web.ts
// and on native platforms to AgentTickPrivateCryptoModule.ts
export { default } from './src/AgentTickPrivateCryptoModule';
export * from './src/AgentTickPrivateCrypto.types';
