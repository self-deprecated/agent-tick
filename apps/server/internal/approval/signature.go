package approval

import (
	"crypto/ed25519"
	"encoding/base64"
	"fmt"
	"net/http"
	"strconv"
	"time"
)

const (
	signatureHeader = "X-Agent-Tick-Signature"
	publicKeyHeader = "X-Agent-Tick-Public-Key"
	timestampHeader = "X-Agent-Tick-Timestamp"
)

func verifySignature(r *http.Request, body []byte, now time.Time) error {
	signatureValue := r.Header.Get(signatureHeader)
	publicKeyValue := r.Header.Get(publicKeyHeader)
	timestampValue := r.Header.Get(timestampHeader)
	if signatureValue == "" || publicKeyValue == "" || timestampValue == "" {
		return fmt.Errorf("missing signature headers")
	}

	timestamp, err := strconv.ParseInt(timestampValue, 10, 64)
	if err != nil {
		return fmt.Errorf("invalid signature timestamp")
	}
	signedAt := time.Unix(timestamp, 0)
	if now.Sub(signedAt) > 5*time.Minute || signedAt.Sub(now) > 5*time.Minute {
		return fmt.Errorf("signature timestamp is outside allowed window")
	}

	signature, err := base64.StdEncoding.DecodeString(signatureValue)
	if err != nil {
		return fmt.Errorf("invalid signature encoding")
	}
	publicKey, err := base64.StdEncoding.DecodeString(publicKeyValue)
	if err != nil {
		return fmt.Errorf("invalid public key encoding")
	}
	if len(publicKey) != ed25519.PublicKeySize {
		return fmt.Errorf("invalid public key size")
	}

	message := append([]byte(timestampValue+"."), body...)
	if !ed25519.Verify(ed25519.PublicKey(publicKey), message, signature) {
		return fmt.Errorf("invalid request signature")
	}
	return nil
}
