import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { getStoredConnectionCredential, loadStoredMobileConnections, mobileConnectionOrderStorageKey, mobileConnectionsStorageKey, persistSavedConnectionCredential, saveStoredMobileConnections, unregisterSavedConnectionDevice } from "./mobileConnections";
import { mobileConnectionCredentialKey, upsertSavedMobileAccount } from "./mobileAuth";

describe("mobile connection storage", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    (SecureStore as unknown as { __clear: () => void }).__clear();
  });

  it("stores connection metadata in SecureStore and only order in AsyncStorage", async () => {
    const [connection] = upsertSavedMobileAccount([], {
      serverURL: "https://app.agenttick.sh",
      authProvider: "clerk",
      userID: "usr_1",
      email: "ada@example.com",
      clerkSessionID: "sess_1",
      signInMethod: "Apple",
      label: "Apple account",
      updatedAt: "2026-05-10T00:00:00.000Z",
    });

    await saveStoredMobileConnections([connection!]);

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(mobileConnectionsStorageKey, expect.stringContaining("ada@example.com"));
    expect(await AsyncStorage.getItem(mobileConnectionOrderStorageKey)).toBe(JSON.stringify([connection!.id]));
    await expect(loadStoredMobileConnections()).resolves.toMatchObject([
      {
        id: connection!.id,
        serverURL: "https://app.agenttick.sh",
        authScheme: "clerk-bootstrap-mobile-token",
        credentialRef: mobileConnectionCredentialKey(connection!.id),
        displayName: "Apple account",
        email: "ada@example.com",
      },
    ]);
  });

  it("persists local connection credentials to the connection credential ref", async () => {
    const [connection] = upsertSavedMobileAccount([], {
      serverURL: "https://tick.example.com",
      authProvider: "local",
      label: "Example device",
      deviceID: "dev_1",
      updatedAt: "2026-05-10T00:00:00.000Z",
    });

    await expect(persistSavedConnectionCredential(connection!, { isClerkMode: false, token: "device_secret" })).resolves.toBe("saved-local");

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(mobileConnectionCredentialKey(connection!.id), "device_secret");
  });

  it("does not save Clerk credentials as local connection credentials", async () => {
    const [connection] = upsertSavedMobileAccount([], {
      serverURL: "https://app.agenttick.sh",
      authProvider: "clerk",
      label: "Apple account",
      userID: "usr_1",
      clerkSessionID: "sess_1",
      updatedAt: "2026-05-10T00:00:00.000Z",
    });

    await expect(persistSavedConnectionCredential(connection!, { isClerkMode: true, token: "clerk_jwt" })).resolves.toBe("cleared-clerk");

    expect(SecureStore.setItemAsync).not.toHaveBeenCalledWith(mobileConnectionCredentialKey(connection!.id), "clerk_jwt");
  });

  it("unregisters a saved connection's server-side device before logout cleanup", async () => {
    const [connection] = upsertSavedMobileAccount([], {
      serverURL: "https://app.agenttick.sh/",
      authProvider: "clerk",
      label: "Apple account",
      userID: "usr_1",
      clerkSessionID: "sess_1",
      deviceID: "dev_1",
      workspaceID: "wsp_1",
      updatedAt: "2026-05-10T00:00:00.000Z",
    });
    const unregisterDevice = jest.fn(async () => ({}));
    const clientFactory = jest.fn(() => ({ unregisterDevice }));

    await expect(unregisterSavedConnectionDevice(connection!, { token: "mobile_token", clientFactory })).resolves.toBe("unregistered");

    expect(clientFactory).toHaveBeenCalledWith({ baseUrl: "https://app.agenttick.sh", token: "mobile_token", workspaceId: "wsp_1" });
    expect(unregisterDevice).toHaveBeenCalledWith("dev_1");
  });

  it("skips remote unregister when a saved connection has no device", async () => {
    const [connection] = upsertSavedMobileAccount([], {
      serverURL: "https://app.agenttick.sh",
      authProvider: "clerk",
      label: "Apple account",
      userID: "usr_1",
      updatedAt: "2026-05-10T00:00:00.000Z",
    });
    const clientFactory = jest.fn();

    await expect(unregisterSavedConnectionDevice(connection!, { token: "mobile_token", clientFactory })).resolves.toBe("skipped");

    expect(clientFactory).not.toHaveBeenCalled();
  });
});
