import { NativeModule, requireNativeModule } from 'expo';
import type { AgentTickPrivateCryptoModuleAPI } from './AgentTickPrivateCrypto.types';

declare class AgentTickPrivateCryptoModule extends NativeModule<{}> implements AgentTickPrivateCryptoModuleAPI {
  isAvailableAsync(): Promise<boolean>;
  ensureKeyPairAsync(alias: string): Promise<{ algorithm: "p256-ecdh-hkdf-sha256"; publicKey: string }>;
  decryptRequestPayloadAsync(alias: string, payloadJson: string): Promise<string>;
}

let nativeModule: AgentTickPrivateCryptoModule | null = null;
try {
  nativeModule = requireNativeModule<AgentTickPrivateCryptoModule>('AgentTickPrivateCrypto');
} catch {
  nativeModule = null;
}

export default nativeModule;
