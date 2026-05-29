import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { clearSecretValue, clearSecretValues, getSecretValue, setSecretValue } from "./mobileSecretStorage";

const secureStoreMock = SecureStore as typeof SecureStore & {
  __clear: () => void;
  __entries: () => Array<[string, string]>;
};

describe("mobile secret storage", () => {
  beforeEach(async () => {
    secureStoreMock.__clear();
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it("does not read pre-launch AsyncStorage secret values", async () => {
    await AsyncStorage.setItem("agent-tick.session.example.token", "old-token");

    await expect(getSecretValue("agent-tick.session.example.token")).resolves.toBeNull();

    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(secureStoreMock.__entries()).toEqual([]);
  });

  it("reads fresh SecureStore values", async () => {
    await SecureStore.setItemAsync("agent-tick.selfHostedBearerToken", "secure-token");
    await AsyncStorage.setItem("agent-tick.selfHostedBearerToken", "ignored-token");

    await expect(getSecretValue("agent-tick.selfHostedBearerToken")).resolves.toBe("secure-token");
  });

  it("writes secrets only to SecureStore", async () => {
    await AsyncStorage.setItem("__agent_tick_mobile_session_jwt", "old-token");

    await setSecretValue("__agent_tick_mobile_session_jwt", "new-token");

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith("__agent_tick_mobile_session_jwt", "new-token");
    await expect(AsyncStorage.getItem("__agent_tick_mobile_session_jwt")).resolves.toBe("old-token");
    await expect(getSecretValue("__agent_tick_mobile_session_jwt")).resolves.toBe("new-token");
  });

  it("deletes secrets from SecureStore for sign-out cleanup", async () => {
    await SecureStore.setItemAsync("agent-tick.mobileAccountSession.account", "saved-token");
    await AsyncStorage.setItem("agent-tick.mobileAccountSession.account", "ignored-token");

    await clearSecretValue("agent-tick.mobileAccountSession.account");

    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith("agent-tick.mobileAccountSession.account");
    await expect(AsyncStorage.getItem("agent-tick.mobileAccountSession.account")).resolves.toBe("ignored-token");
    await expect(getSecretValue("agent-tick.mobileAccountSession.account")).resolves.toBeNull();
  });

  it("clears saved-account tokens in batches when accounts are removed", async () => {
    await SecureStore.setItemAsync("agent-tick.mobileAccountSession.one", "one-token");
    await SecureStore.setItemAsync("agent-tick.mobileAccountSession.two", "two-token");

    await clearSecretValues(["agent-tick.mobileAccountSession.one", "agent-tick.mobileAccountSession.two"]);

    await expect(getSecretValue("agent-tick.mobileAccountSession.one")).resolves.toBeNull();
    await expect(getSecretValue("agent-tick.mobileAccountSession.two")).resolves.toBeNull();
  });
});
