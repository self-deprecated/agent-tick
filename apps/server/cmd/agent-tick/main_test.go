package main

import (
	"path/filepath"
	"testing"
)

func TestClientConfigDefaults(t *testing.T) {
	t.Setenv("AGENT_TICK_CONFIG", filepath.Join(t.TempDir(), "config.json"))
	t.Setenv("AGENT_TICK_SERVER", "")
	t.Setenv("AGENT_TICK_TOKEN", "")

	if _, err := saveClientConfig(clientConfig{Server: "http://example.test:8787", Token: "agent_test"}); err != nil {
		t.Fatalf("saveClientConfig() error = %v", err)
	}

	if got := defaultServerURL(); got != "http://example.test:8787" {
		t.Fatalf("defaultServerURL() = %q, want configured server", got)
	}
	if got := defaultToken(); got != "agent_test" {
		t.Fatalf("defaultToken() = %q, want configured token", got)
	}
}

func TestClientConfigEnvOverrides(t *testing.T) {
	t.Setenv("AGENT_TICK_CONFIG", filepath.Join(t.TempDir(), "config.json"))
	t.Setenv("AGENT_TICK_SERVER", "http://env.test:8787")
	t.Setenv("AGENT_TICK_TOKEN", "agent_env")

	if _, err := saveClientConfig(clientConfig{Server: "http://config.test:8787", Token: "agent_config"}); err != nil {
		t.Fatalf("saveClientConfig() error = %v", err)
	}

	if got := defaultServerURL(); got != "http://env.test:8787" {
		t.Fatalf("defaultServerURL() = %q, want env server", got)
	}
	if got := defaultToken(); got != "agent_env" {
		t.Fatalf("defaultToken() = %q, want env token", got)
	}
}
