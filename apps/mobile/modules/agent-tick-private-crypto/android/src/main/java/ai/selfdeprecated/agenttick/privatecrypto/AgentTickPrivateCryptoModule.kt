package ai.selfdeprecated.agenttick.privatecrypto

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.PublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.X509EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import java.security.KeyFactory

class AgentTickPrivateCryptoModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AgentTickPrivateCrypto")

    AsyncFunction("isAvailableAsync") {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
    }

    AsyncFunction("ensureKeyPairAsync") { alias: String ->
      val publicKey = loadOrCreateKeyPair(alias)
      mapOf(
        "algorithm" to "p256-ecdh-hkdf-sha256",
        "publicKey" to base64UrlEncode(publicKey.encoded)
      )
    }

    AsyncFunction("decryptRequestPayloadAsync") { alias: String, payloadJson: String ->
      val privateKey = loadPrivateKey(alias)
      val payload = JSONObject(payloadJson)
      if (payload.optString("algorithm") != "aes-256-gcm") {
        throw IllegalArgumentException("Unsupported Private Request content algorithm.")
      }
      val envelopes = payload.getJSONArray("keyEnvelopes")
      var lastError: Exception? = null
      for (index in 0 until envelopes.length()) {
        try {
          val envelope = envelopes.getJSONObject(index)
          val contentKey = unwrapContentKey(privateKey, envelope)
          val plaintext = decryptContentPayload(payload, contentKey)
          return@AsyncFunction String(plaintext, StandardCharsets.UTF_8)
        } catch (error: Exception) {
          lastError = error
        }
      }
      throw lastError ?: IllegalArgumentException("No Private Request envelope matched this device.")
    }
  }

  private fun loadOrCreateKeyPair(alias: String): PublicKey {
    loadPublicKey(alias)?.let { return it }
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
      throw IllegalStateException("Private Request crypto requires Android 12 or newer.")
    }
    val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
    val spec = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_AGREE_KEY)
      .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
      .setDigests(KeyProperties.DIGEST_SHA256)
      .setUserAuthenticationRequired(false)
      .build()
    generator.initialize(spec)
    return generator.generateKeyPair().public
  }

  private fun loadPrivateKey(alias: String): PrivateKey {
    val keyStore = KeyStore.getInstance("AndroidKeyStore")
    keyStore.load(null)
    val key = keyStore.getKey(alias, null) ?: throw IllegalStateException("Private Request key is not available on this device.")
    return key as PrivateKey
  }

  private fun loadPublicKey(alias: String): PublicKey? {
    val keyStore = KeyStore.getInstance("AndroidKeyStore")
    keyStore.load(null)
    val certificate = keyStore.getCertificate(alias) ?: return null
    return certificate.publicKey
  }

  private fun unwrapContentKey(privateKey: PrivateKey, envelope: JSONObject): ByteArray {
    val deviceKeyId = envelope.getString("deviceKeyId")
    if (envelope.getString("algorithm") != "p256-ecdh-hkdf-sha256+aes-256-gcm") {
      throw IllegalArgumentException("Unsupported Private Request key envelope algorithm.")
    }
    val ephemeralPublicKey = publicKeyFromSPKI(envelope.getString("ephemeralPublicKey"))
    val keyAgreement = KeyAgreement.getInstance("ECDH")
    keyAgreement.init(privateKey)
    keyAgreement.doPhase(ephemeralPublicKey, true)
    val sharedSecret = keyAgreement.generateSecret()
    val wrappingKey = hkdfSha256(
      sharedSecret,
      ByteArray(0),
      "agent-tick-private-request:$deviceKeyId".toByteArray(StandardCharsets.UTF_8),
      32
    )
    return aesGcmDecrypt(
      key = wrappingKey,
      nonce = base64UrlDecode(envelope.getString("nonce")),
      ciphertext = base64UrlDecode(envelope.getString("ciphertext")),
      tag = base64UrlDecode(envelope.getString("tag")),
      aad = deviceKeyId.toByteArray(StandardCharsets.UTF_8)
    )
  }

  private fun decryptContentPayload(payload: JSONObject, contentKey: ByteArray): ByteArray {
    return aesGcmDecrypt(
      key = contentKey,
      nonce = base64UrlDecode(payload.getString("nonce")),
      ciphertext = base64UrlDecode(payload.getString("ciphertext")),
      tag = base64UrlDecode(payload.getString("tag")),
      aad = null
    )
  }

  private fun publicKeyFromSPKI(value: String): PublicKey {
    val keySpec = X509EncodedKeySpec(base64UrlDecode(value))
    return KeyFactory.getInstance("EC").generatePublic(keySpec)
  }

  private fun aesGcmDecrypt(key: ByteArray, nonce: ByteArray, ciphertext: ByteArray, tag: ByteArray, aad: ByteArray?): ByteArray {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
    if (aad != null) cipher.updateAAD(aad)
    return cipher.doFinal(ciphertext + tag)
  }

  private fun hkdfSha256(inputKeyMaterial: ByteArray, salt: ByteArray, info: ByteArray, outputLength: Int): ByteArray {
    val actualSalt = if (salt.isNotEmpty()) salt else ByteArray(32)
    val prk = hmacSha256(actualSalt, inputKeyMaterial)
    val output = ByteArray(outputLength)
    var previous = ByteArray(0)
    var generated = 0
    var counter = 1
    while (generated < outputLength) {
      val mac = Mac.getInstance("HmacSHA256")
      mac.init(SecretKeySpec(prk, "HmacSHA256"))
      mac.update(previous)
      mac.update(info)
      mac.update(counter.toByte())
      previous = mac.doFinal()
      val copyLength = minOf(previous.size, outputLength - generated)
      System.arraycopy(previous, 0, output, generated, copyLength)
      generated += copyLength
      counter += 1
    }
    return output
  }

  private fun hmacSha256(key: ByteArray, data: ByteArray): ByteArray {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(key, "HmacSHA256"))
    return mac.doFinal(data)
  }

  private fun base64UrlEncode(value: ByteArray): String {
    return Base64.encodeToString(value, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
  }

  private fun base64UrlDecode(value: String): ByteArray {
    return Base64.decode(value, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
  }
}
