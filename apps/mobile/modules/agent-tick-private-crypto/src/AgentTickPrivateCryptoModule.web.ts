import { registerWebModule, NativeModule } from 'expo';
import type { AgentTickPrivateCryptoModuleAPI } from './AgentTickPrivateCrypto.types';

class AgentTickPrivateCryptoModule extends NativeModule<{}> implements AgentTickPrivateCryptoModuleAPI {
  async isAvailableAsync(): Promise<boolean> {
    return false;
  }

  async ensureKeyPairAsync(): Promise<{ algorithm: "p256-ecdh-hkdf-sha256"; publicKey: string }> {
    throw new Error('Agent Tick Private Request crypto is not available on web.');
  }

  async decryptRequestPayloadAsync(): Promise<string> {
    throw new Error('Agent Tick Private Request crypto is not available on web.');
  }
}

export default registerWebModule(AgentTickPrivateCryptoModule, 'AgentTickPrivateCryptoModule');
