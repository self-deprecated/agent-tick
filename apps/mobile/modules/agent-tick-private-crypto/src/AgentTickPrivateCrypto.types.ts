export type AgentTickPrivateCryptoKeyPair = {
  algorithm: "p256-ecdh-hkdf-sha256";
  publicKey: string;
};

export type AgentTickPrivateCryptoModuleAPI = {
  isAvailableAsync(): Promise<boolean>;
  ensureKeyPairAsync(alias: string): Promise<AgentTickPrivateCryptoKeyPair>;
  decryptRequestPayloadAsync(alias: string, payloadJson: string): Promise<string>;
};
