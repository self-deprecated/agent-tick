import React from "react";
import { Alert } from "react-native";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";

const { ServerPicker } = require("./ServerPicker") as typeof import("./ServerPicker");
const { hostedServerURL } = require("../mobileAuth") as typeof import("../mobileAuth");
import type { RuntimeAuthConfig } from "../mobileAuth";

const sampleServers = [
  { url: hostedServerURL, label: "agenttick.sh" },
  { url: "https://dev.example.com", authProvider: "clerk" as const, lastUsedAt: "2026-06-01T00:00:00.000Z" },
  { url: "https://tick.example.com", authProvider: "local" as const, lastUsedAt: "2026-05-01T00:00:00.000Z" },
];

function authConfig(overrides: Partial<RuntimeAuthConfig> = {}): RuntimeAuthConfig {
  return { mode: "single", authProvider: "local", ...overrides };
}

type VerifyImpl = (url: string) => Promise<RuntimeAuthConfig>;

/** Builds an onVerifyServer that resolves for specific URLs and rejects others. */
function verifyFor(map: Record<string, RuntimeAuthConfig | "reject">): VerifyImpl {
  return async (url) => {
    const entry = map[url];
    if (entry === "reject" || entry === undefined) throw new Error("reject");
    return entry;
  };
}

/** Auto-presses the destructive (Continue) button of any Alert the picker raises. */
function autoAcceptAlert() {
  return jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => {
    const destructive = (buttons ?? []).find((button) => button.style === "destructive");
    destructive?.onPress?.();
  });
}

/** Auto-presses the cancel button of any Alert the picker raises. */
function autoCancelAlert() {
  return jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => {
    const cancel = (buttons ?? []).find((button) => button.style === "cancel");
    cancel?.onPress?.();
  });
}

describe("ServerPicker", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("lists known servers with the hosted entry first and badges their auth type", () => {
    render(<ServerPicker knownServers={sampleServers} selectedServerURL={hostedServerURL} onSelectServer={() => {}} onVerifyServer={verifyFor({})} onRecordServer={() => {}} />);

    expect(screen.getByText("agenttick.sh")).toBeTruthy();
    expect(screen.getByText("dev.example.com")).toBeTruthy();
    expect(screen.getByText("Clerk sign-in")).toBeTruthy();
    expect(screen.getByText("Token / pairing")).toBeTruthy();
  });

  it("reports a selection", () => {
    const onSelectServer = jest.fn();
    render(<ServerPicker knownServers={sampleServers} selectedServerURL={hostedServerURL} onSelectServer={onSelectServer} onVerifyServer={verifyFor({})} onRecordServer={() => {}} />);

    fireEvent.press(screen.getByLabelText("Select server dev.example.com"));
    expect(onSelectServer).toHaveBeenCalledWith("https://dev.example.com");
  });

  it("coerces a bare hostname to https and records when the https probe confirms", async () => {
    const verify = jest.fn(async (url: string) => {
      if (url !== "https://lab.example.com") throw new Error("reject");
      return authConfig();
    });
    const onRecordServer = jest.fn(async () => {});
    render(<ServerPicker knownServers={sampleServers} selectedServerURL={hostedServerURL} onSelectServer={() => {}} onVerifyServer={verify} onRecordServer={onRecordServer} />);

    fireEvent.press(screen.getByLabelText("Add another Agent Tick server"));
    fireEvent.changeText(screen.getByLabelText("New self-hosted server URL"), "lab.example.com");
    fireEvent.press(screen.getByLabelText("Add self-hosted server"));

    await waitFor(() => expect(onRecordServer).toHaveBeenCalledWith("https://lab.example.com", { authProvider: "local" }));
    // Only the https URL is probed; no insecure fallback needed.
    expect(verify).not.toHaveBeenCalledWith(expect.stringContaining("http://lab.example.com"));
    // Form collapses on success.
    expect(screen.queryByLabelText("New self-hosted server URL")).toBeNull();
  });

  it("falls back to http and records without a prompt for loopback", async () => {
    const verify = verifyFor({ "http://localhost:8787": authConfig() });
    const onRecordServer = jest.fn(async () => {});
    // Coercion sends loopback straight to http, so the primary IS http here.
    render(<ServerPicker knownServers={sampleServers} selectedServerURL={hostedServerURL} onSelectServer={() => {}} onVerifyServer={verify} onRecordServer={onRecordServer} />);

    fireEvent.press(screen.getByLabelText("Add another Agent Tick server"));
    fireEvent.changeText(screen.getByLabelText("New self-hosted server URL"), "localhost:8787");
    fireEvent.press(screen.getByLabelText("Add self-hosted server"));

    await waitFor(() => expect(onRecordServer).toHaveBeenCalledWith("http://localhost:8787", { authProvider: "local" }));
  });

  it("falls back to http, warns insecure, and records after accepting", async () => {
    autoAcceptAlert();
    // https fails; http confirms for the dev server.
    const verify = verifyFor({ "http://dev.example.com": authConfig() });
    const onRecordServer = jest.fn(async () => {});
    render(<ServerPicker knownServers={sampleServers} selectedServerURL={hostedServerURL} onSelectServer={() => {}} onVerifyServer={verify} onRecordServer={onRecordServer} />);

    fireEvent.press(screen.getByLabelText("Add another Agent Tick server"));
    fireEvent.changeText(screen.getByLabelText("New self-hosted server URL"), "dev.example.com");
    fireEvent.press(screen.getByLabelText("Add self-hosted server"));

    await waitFor(() => expect(onRecordServer).toHaveBeenCalledWith("http://dev.example.com", { authProvider: "local", insecureConfirmed: true }));
    expect(Alert.alert).toHaveBeenCalledWith("Connection is not secure", expect.stringContaining("dev.example.com"), expect.any(Array), expect.any(Object));
  });

  it("keeps the form open and records nothing when the insecure warning is cancelled", async () => {
    autoCancelAlert();
    const verify = verifyFor({ "http://dev.example.com": authConfig() });
    const onRecordServer = jest.fn(async () => {});
    render(<ServerPicker knownServers={sampleServers} selectedServerURL={hostedServerURL} onSelectServer={() => {}} onVerifyServer={verify} onRecordServer={onRecordServer} />);

    fireEvent.press(screen.getByLabelText("Add another Agent Tick server"));
    fireEvent.changeText(screen.getByLabelText("New self-hosted server URL"), "dev.example.com");
    fireEvent.press(screen.getByLabelText("Add self-hosted server"));

    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    expect(onRecordServer).not.toHaveBeenCalled();
    // Form stays open so the user can retry or cancel.
    expect(screen.getByLabelText("New self-hosted server URL")).toBeTruthy();
  });

  it("rejects a URL that is not an Agent Tick server over either scheme", async () => {
    const verify = verifyFor({}); // everything rejects
    const onRecordServer = jest.fn(async () => {});
    render(<ServerPicker knownServers={sampleServers} selectedServerURL={hostedServerURL} onSelectServer={() => {}} onVerifyServer={verify} onRecordServer={onRecordServer} />);

    fireEvent.press(screen.getByLabelText("Add another Agent Tick server"));
    fireEvent.changeText(screen.getByLabelText("New self-hosted server URL"), "google.com");
    fireEvent.press(screen.getByLabelText("Add self-hosted server"));

    await waitFor(() => expect(screen.getByText(/is not an Agent Tick server/)).toBeTruthy());
    expect(onRecordServer).not.toHaveBeenCalled();
    expect(screen.getByLabelText("New self-hosted server URL")).toBeTruthy();
  });

  it("blocks submission of an invalid URL", () => {
    const verify = jest.fn();
    render(<ServerPicker knownServers={sampleServers} selectedServerURL={hostedServerURL} onSelectServer={() => {}} onVerifyServer={verify} onRecordServer={() => {}} />);

    fireEvent.press(screen.getByLabelText("Add another Agent Tick server"));
    fireEvent.changeText(screen.getByLabelText("New self-hosted server URL"), "not a url");
    fireEvent.press(screen.getByLabelText("Add self-hosted server"));

    expect(verify).not.toHaveBeenCalled();
  });

  it("can forget a self-hosted server after confirming, but never the hosted one", () => {
    jest.spyOn(Alert, "alert").mockImplementation((_title, _message, buttons) => {
      (buttons ?? []).find((button) => button.style === "destructive")?.onPress?.();
    });
    const onRemoveServer = jest.fn();
    render(<ServerPicker knownServers={sampleServers} selectedServerURL={hostedServerURL} onSelectServer={() => {}} onVerifyServer={verifyFor({})} onRecordServer={() => {}} onRemoveServer={onRemoveServer} />);

    expect(screen.queryByLabelText("Forget server agenttick.sh")).toBeNull();
    fireEvent.press(screen.getByLabelText("Forget server dev.example.com"));
    expect(onRemoveServer).toHaveBeenCalledWith("https://dev.example.com");
  });
});
