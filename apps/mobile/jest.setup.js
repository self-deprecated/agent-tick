jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);

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
