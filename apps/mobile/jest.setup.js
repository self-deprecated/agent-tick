jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);

const mockSecureStore = new Map();
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (key) => mockSecureStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key, value) => { mockSecureStore.set(key, value); }),
  deleteItemAsync: jest.fn(async (key) => { mockSecureStore.delete(key); }),
  __clear: () => mockSecureStore.clear(),
  __entries: () => Array.from(mockSecureStore.entries()),
}));

jest.mock("react-native-purchases", () => ({
  configure: jest.fn(),
  getCustomerInfo: jest.fn(async () => ({ entitlements: { active: {} }, allPurchasedProductIdentifiers: [] })),
  getOfferings: jest.fn(async () => ({ current: { availablePackages: [] } })),
  getProducts: jest.fn(async () => []),
  purchasePackage: jest.fn(async () => ({})),
  purchaseProduct: jest.fn(async () => ({})),
  restorePurchases: jest.fn(async () => ({})),
  logIn: jest.fn(async () => ({})),
  logOut: jest.fn(async () => ({})),
}));

jest.mock("@clerk/expo/native", () => {
  const React = require("react");
  const { Text } = require("react-native");
  return {
    AuthView: ({ mode, isDismissable }) => React.createElement(
      Text,
      null,
      `Native Clerk AuthView ${mode} ${String(isDismissable)}`,
    ),
  };
});
