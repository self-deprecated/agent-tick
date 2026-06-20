import CryptoKit
import ExpoModulesCore
import Foundation
import Security

public class AgentTickPrivateCryptoModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AgentTickPrivateCrypto")

    AsyncFunction("isAvailableAsync") { () -> Bool in
      true
    }

    AsyncFunction("ensureKeyPairAsync") { (alias: String) throws -> [String: String] in
      let privateKey = try loadOrCreatePrivateKey(alias: alias)
      guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
        throw privateCryptoError("Could not read Private Request public key.")
      }
      let rawPublicKey = try externalRepresentation(publicKey)
      let spkiPublicKey = try spkiFromP256X963(rawPublicKey)
      return [
        "algorithm": "p256-ecdh-hkdf-sha256",
        "publicKey": base64URLEncode(spkiPublicKey)
      ]
    }

    AsyncFunction("decryptRequestPayloadAsync") { (alias: String, payloadJson: String) throws -> String in
      let privateKey = try loadPrivateKey(alias: alias)
      let payloadData = Data(payloadJson.utf8)
      guard let payload = try JSONSerialization.jsonObject(with: payloadData) as? [String: Any] else {
        throw privateCryptoError("Private Request payload is not an object.")
      }
      guard let algorithm = payload["algorithm"] as? String, algorithm == "aes-256-gcm" else {
        throw privateCryptoError("Unsupported Private Request content algorithm.")
      }
      guard let envelopes = payload["keyEnvelopes"] as? [[String: Any]], !envelopes.isEmpty else {
        throw privateCryptoError("Private Request has no key envelopes.")
      }

      var lastError: Error?
      for envelope in envelopes {
        do {
          let contentKey = try unwrapContentKey(privateKey: privateKey, envelope: envelope)
          let plaintext = try decryptContentPayload(payload: payload, contentKey: contentKey)
          guard let plaintextJson = String(data: plaintext, encoding: .utf8) else {
            throw privateCryptoError("Private Request plaintext is not UTF-8.")
          }
          return plaintextJson
        } catch {
          lastError = error
        }
      }
      throw lastError ?? privateCryptoError("No Private Request envelope matched this device.")
    }
  }
}

private let p256SPKIHeader = Data([
  0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x02, 0x01,
  0x06, 0x08, 0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00
])

private func loadOrCreatePrivateKey(alias: String) throws -> SecKey {
  if let key = try? loadPrivateKey(alias: alias) {
    return key
  }
  let tag = Data(alias.utf8)
  let attributes: [String: Any] = [
    kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
    kSecAttrKeySizeInBits as String: 256,
    kSecPrivateKeyAttrs as String: [
      kSecAttrIsPermanent as String: true,
      kSecAttrApplicationTag as String: tag,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    ]
  ]
  var error: Unmanaged<CFError>?
  guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
    throw error?.takeRetainedValue() ?? privateCryptoError("Could not create Private Request key.")
  }
  return key
}

private func loadPrivateKey(alias: String) throws -> SecKey {
  let tag = Data(alias.utf8)
  let query: [String: Any] = [
    kSecClass as String: kSecClassKey,
    kSecAttrApplicationTag as String: tag,
    kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
    kSecReturnRef as String: true
  ]
  var item: CFTypeRef?
  let status = SecItemCopyMatching(query as CFDictionary, &item)
  guard status == errSecSuccess, let key = item else {
    throw privateCryptoError("Private Request key is not available on this device.")
  }
  return (key as! SecKey)
}

private func externalRepresentation(_ key: SecKey) throws -> Data {
  var error: Unmanaged<CFError>?
  guard let data = SecKeyCopyExternalRepresentation(key, &error) as Data? else {
    throw error?.takeRetainedValue() ?? privateCryptoError("Could not export public key.")
  }
  return data
}

private func spkiFromP256X963(_ rawKey: Data) throws -> Data {
  if rawKey.starts(with: p256SPKIHeader) {
    return rawKey
  }
  guard rawKey.count == 65, rawKey.first == 0x04 else {
    throw privateCryptoError("Unexpected P-256 public key format.")
  }
  return p256SPKIHeader + rawKey
}

private func p256X963FromSPKI(_ spki: Data) throws -> Data {
  if spki.starts(with: p256SPKIHeader) {
    return spki.dropFirst(p256SPKIHeader.count)
  }
  if spki.count == 65, spki.first == 0x04 {
    return spki
  }
  throw privateCryptoError("Unexpected P-256 SPKI public key format.")
}

private func publicKeyFromSPKI(_ encoded: String) throws -> SecKey {
  let spki = try base64URLDecode(encoded)
  let rawKey = try p256X963FromSPKI(spki)
  let attributes: [String: Any] = [
    kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
    kSecAttrKeyClass as String: kSecAttrKeyClassPublic,
    kSecAttrKeySizeInBits as String: 256
  ]
  var error: Unmanaged<CFError>?
  guard let key = SecKeyCreateWithData(rawKey as CFData, attributes as CFDictionary, &error) else {
    throw error?.takeRetainedValue() ?? privateCryptoError("Could not import envelope public key.")
  }
  return key
}

private func unwrapContentKey(privateKey: SecKey, envelope: [String: Any]) throws -> Data {
  guard let deviceKeyId = envelope["deviceKeyId"] as? String,
        let algorithm = envelope["algorithm"] as? String,
        let ephemeralPublicKey = envelope["ephemeralPublicKey"] as? String,
        let nonceString = envelope["nonce"] as? String,
        let ciphertextString = envelope["ciphertext"] as? String,
        let tagString = envelope["tag"] as? String else {
    throw privateCryptoError("Private Request key envelope is incomplete.")
  }
  guard algorithm == "p256-ecdh-hkdf-sha256+aes-256-gcm" else {
    throw privateCryptoError("Unsupported Private Request key envelope algorithm.")
  }

  let publicKey = try publicKeyFromSPKI(ephemeralPublicKey)
  var exchangeError: Unmanaged<CFError>?
  guard let sharedSecret = SecKeyCopyKeyExchangeResult(
    privateKey,
    SecKeyAlgorithm.ecdhKeyExchangeStandard,
    publicKey,
    [:] as CFDictionary,
    &exchangeError
  ) as Data? else {
    throw exchangeError?.takeRetainedValue() ?? privateCryptoError("Could not derive Private Request shared secret.")
  }
  let info = Data("agent-tick-private-request:\(deviceKeyId)".utf8)
  let wrappingKey = HKDF<SHA256>.deriveKey(
    inputKeyMaterial: SymmetricKey(data: sharedSecret),
    salt: Data(),
    info: info,
    outputByteCount: 32
  )
  let sealedBox = try AES.GCM.SealedBox(
    nonce: AES.GCM.Nonce(data: try base64URLDecode(nonceString)),
    ciphertext: try base64URLDecode(ciphertextString),
    tag: try base64URLDecode(tagString)
  )
  return try AES.GCM.open(sealedBox, using: wrappingKey, authenticating: Data(deviceKeyId.utf8))
}

private func decryptContentPayload(payload: [String: Any], contentKey: Data) throws -> Data {
  guard let nonceString = payload["nonce"] as? String,
        let ciphertextString = payload["ciphertext"] as? String,
        let tagString = payload["tag"] as? String else {
    throw privateCryptoError("Private Request encrypted payload is incomplete.")
  }
  let sealedBox = try AES.GCM.SealedBox(
    nonce: AES.GCM.Nonce(data: try base64URLDecode(nonceString)),
    ciphertext: try base64URLDecode(ciphertextString),
    tag: try base64URLDecode(tagString)
  )
  return try AES.GCM.open(sealedBox, using: SymmetricKey(data: contentKey))
}

private func base64URLEncode(_ data: Data) -> String {
  data.base64EncodedString()
    .replacingOccurrences(of: "+", with: "-")
    .replacingOccurrences(of: "/", with: "_")
    .replacingOccurrences(of: "=", with: "")
}

private func base64URLDecode(_ value: String) throws -> Data {
  var base64 = value.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
  let padding = (4 - base64.count % 4) % 4
  if padding > 0 {
    base64 += String(repeating: "=", count: padding)
  }
  guard let data = Data(base64Encoded: base64) else {
    throw privateCryptoError("Invalid base64url value.")
  }
  return data
}

private func privateCryptoError(_ message: String) -> NSError {
  NSError(domain: "AgentTickPrivateCrypto", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
}
