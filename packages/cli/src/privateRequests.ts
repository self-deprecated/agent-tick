import { createCipheriv, createECDH, createHash, createPrivateKey, createPublicKey, diffieHellman, hkdfSync, randomBytes } from 'node:crypto';
import type { Choice, CreateRequest, CreateStatusUpdate, DevicePublicKeyRecord, EncryptedRequestPayload, PrivateRequestPrepareResponse, PrivateStatusUpdatePlaintext, PrivateStatusUpdatePrepareResponse } from '@self-deprecated/agent-tick-shared';

type RequestChoiceInput = NonNullable<CreateRequest['choices']>[number];

const CONTENT_ALGORITHM = 'aes-256-gcm' as const;
const ENVELOPE_ALGORITHM = 'p256-ecdh-hkdf-sha256+aes-256-gcm' as const;

export interface PrivateRequestPlaintext {
  title: string;
  body?: string;
  command?: string;
  choices: Choice[];
  session?: unknown;
  requestType: string;
}

export function privateModeFromValue(value: string | undefined): 'off' | 'always' {
  return value === 'always' || value === 'true' || value === '1' ? 'always' : 'off';
}

export function publicChoicesForPrivateRequest(choices: Choice[]): Choice[] {
  return choices.map((choice) => ({ id: choice.id, kind: choice.kind, label: choice.kind === 'deny' ? 'Deny' : 'Approve' }));
}

export function createPrivateStatusUpdateInput(base: CreateStatusUpdate, plaintext: PrivateStatusUpdatePlaintext, prepare: PrivateStatusUpdatePrepareResponse): CreateStatusUpdate {
  if (!prepare.deviceKeys.length) throw new Error('Private Status Update could not be created: no recipient has a usable Private Request device key.');
  return {
    ...base,
    contentMode: 'private',
    encryptedPayload: encryptPrivateRequestPayload(plaintext, prepare.deviceKeys),
    privateRecipientVersion: prepare.recipientVersion
  };
}

export function createPrivateRequestInput(base: CreateRequest, prepare: PrivateRequestPrepareResponse): CreateRequest {
  if (!prepare.deviceKeys.length) throw new Error('Private Request could not be created: no recipient has a usable Private Request device key.');
  const choices = base.choices?.length ? base.choices.map(normalizeChoice) : defaultChoices(base.requestType ?? 'sanction');
  const encryptedPayload = encryptPrivateRequestPayload({
    title: base.title,
    ...(base.body ? { body: base.body } : {}),
    ...(base.command ? { command: base.command } : {}),
    choices,
    ...(base.session ? { session: base.session } : {}),
    requestType: base.requestType ?? 'sanction'
  }, prepare.deviceKeys);
  return {
    ...base,
    title: 'Private Request',
    body: undefined,
    command: undefined,
    questions: undefined,
    choices: publicChoicesForPrivateRequest(choices),
    allowFreeformReply: false,
    contentMode: 'private',
    encryptedPayload,
    privateRecipientVersion: prepare.recipientVersion
  };
}

export function encryptPrivateRequestPayload(plaintext: PrivateRequestPlaintext | PrivateStatusUpdatePlaintext, deviceKeys: DevicePublicKeyRecord[]): EncryptedRequestPayload {
  const contentKey = randomBytes(32);
  const nonce = randomBytes(12);
  const serialized = Buffer.from(JSON.stringify(plaintext), 'utf8');
  const cipher = createCipheriv(CONTENT_ALGORITHM, contentKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(serialized), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    version: 1,
    algorithm: CONTENT_ALGORITHM,
    nonce: b64(nonce),
    ciphertext: b64(ciphertext),
    tag: b64(tag),
    keyEnvelopes: deviceKeys.map((key) => wrapContentKey(contentKey, key))
  };
}

function wrapContentKey(contentKey: Buffer, deviceKey: DevicePublicKeyRecord): EncryptedRequestPayload['keyEnvelopes'][number] {
  const recipientPublicKey = createPublicKey({ key: Buffer.from(deviceKey.publicKey, 'base64url'), format: 'der', type: 'spki' });
  const ephemeral = createECDH('prime256v1');
  ephemeral.generateKeys();
  const ephemeralPrivateKey = ephemeralKeyPairPrivateKey(ephemeral);
  const sharedSecret = diffieHellman({ privateKey: ephemeralPrivateKey, publicKey: recipientPublicKey });
  const wrappingKey = Buffer.from(hkdfSync('sha256', sharedSecret, Buffer.alloc(0), Buffer.from(`agent-tick-private-request:${deviceKey.deviceKeyId}`, 'utf8'), 32));
  const nonce = randomBytes(12);
  const cipher = createCipheriv(CONTENT_ALGORITHM, wrappingKey, nonce);
  cipher.setAAD(Buffer.from(deviceKey.deviceKeyId, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(contentKey), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    deviceKeyId: deviceKey.deviceKeyId,
    algorithm: ENVELOPE_ALGORITHM,
    ephemeralPublicKey: b64(ephemeralKeyPairPublicSpki(ephemeral)),
    nonce: b64(nonce),
    ciphertext: b64(ciphertext),
    tag: b64(tag)
  };
}

function ephemeralKeyPairPrivateKey(ecdh: ReturnType<typeof createECDH>) {
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: b64(ecdh.getPublicKey(undefined, 'uncompressed').subarray(1, 33)),
    y: b64(ecdh.getPublicKey(undefined, 'uncompressed').subarray(33, 65)),
    d: b64(ecdh.getPrivateKey())
  };
  return createPrivateKey({ key: jwk, format: 'jwk' });
}

function ephemeralKeyPairPublicSpki(ecdh: ReturnType<typeof createECDH>): Buffer {
  const key = createPublicKey(ephemeralKeyPairPrivateKey(ecdh));
  return key.export({ format: 'der', type: 'spki' }) as Buffer;
}

function defaultChoices(requestType: string): Choice[] {
  if (requestType === 'steering') return [{ id: 'option_a', label: 'Option A', kind: 'approve' }, { id: 'option_b', label: 'Option B', kind: 'approve' }, { id: 'cancel', label: 'Cancel', kind: 'deny' }];
  return [{ id: 'approve', label: 'Approve', kind: 'approve' }, { id: 'deny', label: 'Deny', kind: 'deny' }];
}

function normalizeChoice(choice: RequestChoiceInput): Choice {
  return { ...choice, kind: choice.kind ?? 'approve' };
}

function b64(value: Buffer): string {
  return value.toString('base64url');
}

export function publicKeyFingerprint(publicKey: string): string {
  return createHash('sha256').update(`p256-ecdh-hkdf-sha256:${publicKey}`).digest('base64url');
}
