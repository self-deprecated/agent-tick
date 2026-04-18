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

func TestParseBoolEnv(t *testing.T) {
	tests := []struct {
		value string
		want  bool
	}{
		{"1", true},
		{"true", true},
		{"yes", true},
		{"TRUE", true},
		{"YES", true},
		{"True", true},
		{"0", false},
		{"false", false},
		{"", false},
		{"no", false},
	}
	for _, tt := range tests {
		t.Run(tt.value, func(t *testing.T) {
			if got := parseBoolEnv(tt.value); got != tt.want {
				t.Fatalf("parseBoolEnv(%q) = %v, want %v", tt.value, got, tt.want)
			}
		})
	}
}

func TestFlagEnvPrecedence(t *testing.T) {
	t.Run("server env overrides hardcoded default", func(t *testing.T) {
		t.Setenv("AGENT_TICK_SERVER", "http://env.test:8787")
		t.Setenv("AGENT_TICK_TOKEN", "")
		t.Setenv("AGENT_TICK_CONFIG", filepath.Join(t.TempDir(), "config.json"))
		cmd := newRequestCmd()
		flag := cmd.Flags().Lookup("server")
		if flag == nil {
			t.Fatal("--server flag not found on request command")
		}
		if flag.DefValue != "http://env.test:8787" {
			t.Errorf("--server default = %q, want env value %q", flag.DefValue, "http://env.test:8787")
		}
	})
	t.Run("server uses localhost when env and config absent", func(t *testing.T) {
		t.Setenv("AGENT_TICK_SERVER", "")
		t.Setenv("AGENT_TICK_TOKEN", "")
		t.Setenv("AGENT_TICK_CONFIG", filepath.Join(t.TempDir(), "config.json"))
		cmd := newRequestCmd()
		flag := cmd.Flags().Lookup("server")
		if flag == nil {
			t.Fatal("--server flag not found on request command")
		}
		if flag.DefValue != "http://localhost:8787" {
			t.Errorf("--server default = %q, want localhost default", flag.DefValue)
		}
	})
}
