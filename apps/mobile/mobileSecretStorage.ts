import * as SecureStore from "expo-secure-store";

export async function getSecretValue(key: string): Promise<string | null> {
  const value = await SecureStore.getItemAsync(key);
  return value || null;
}

export async function setSecretValue(key: string, value: string): Promise<void> {
  if (!value) {
    await clearSecretValue(key);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function clearSecretValue(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key);
}

export async function clearSecretValues(keys: string[]): Promise<void> {
  await Promise.all(keys.map((key) => clearSecretValue(key)));
}
