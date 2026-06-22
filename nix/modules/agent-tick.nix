{ self }:
{ config, lib, pkgs, ... }:
let
  cfg = config.services.agent-tick;

  envValue = value:
    if lib.isBool value then lib.boolToString value else toString value;

  optionalEnv = name: value:
    lib.optionalAttrs (value != null) { ${name} = envValue value; };

  optionalCSVEnv = name: values:
    lib.optionalAttrs (values != [ ]) { ${name} = lib.concatStringsSep "," values; };

in
{
  options.services.agent-tick = {
    enable = lib.mkEnableOption "Agent Tick request-routing service";

    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
      defaultText = lib.literalExpression "inputs.agent-tick.packages.\${pkgs.stdenv.hostPlatform.system}.default";
      description = "Agent Tick server package to run.";
    };

    user = lib.mkOption {
      type = lib.types.str;
      default = "agent-tick";
      description = "User account that runs Agent Tick.";
    };

    group = lib.mkOption {
      type = lib.types.str;
      default = "agent-tick";
      description = "Group account that runs Agent Tick.";
    };

    mode = lib.mkOption {
      type = lib.types.enum [ "single" "clerk" ];
      default = "single";
      description = "Agent Tick human authentication mode.";
    };

    host = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "Address for the HTTP server to listen on.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 8787;
      description = "Port for the HTTP server to listen on.";
    };

    publicUrl = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "https://agenttick.sh";
      description = "Externally reachable URL used by the dashboard, mobile app, and CLI.";
    };

    databaseUrl = lib.mkOption {
      type = lib.types.str;
      default = "file:/var/lib/agent-tick/agent-tick.db";
      description = "Durable database URL. Defaults to a SQLite file; postgres:// and postgresql:// URLs select the PostgreSQL store.";
    };

    databaseMigrateOnStart = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Whether the server should ensure/install the current database schema during startup.";
    };

    redisUrl = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      example = "redis://127.0.0.1:6379";
      description = "Optional Redis URL for cross-process event wakeups and shared rate limiting.";
    };

    eventBusBackend = lib.mkOption {
      type = lib.types.enum [ "memory" "redis" ];
      default = "memory";
      description = "Backend used for request/audit event wakeups.";
    };

    rateLimitBackend = lib.mkOption {
      type = lib.types.enum [ "memory" "redis" ];
      default = "memory";
      description = "Backend used for auth-sensitive route rate limits.";
    };

    secretEnvironmentFile = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      example = "/run/agenix/agent-tick-env";
      description = ''
        Optional environment file containing secrets such as
        AGENT_TICK_ADMIN_TOKEN, AGENT_TICK_CLERK_SECRET_KEY,
        AGENT_TICK_SESSION_SECRET, or AGENT_TICK_REVENUECAT_WEBHOOK_SECRET.
        This is intended to be provided by agenix, sops-nix, or another secret
        manager.
      '';
    };

    clerkPublishableKey = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Clerk publishable key for clerk mode. This is not secret.";
    };

    clerkAuthorizedParties = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
      description = "Allowed Clerk token authorized parties/origins.";
    };

    maxActiveMembers = lib.mkOption {
      type = lib.types.nullOr lib.types.ints.positive;
      default = null;
      description = "Optional self-hosted active-member seat limit.";
    };

    billingProvider = lib.mkOption {
      type = lib.types.enum [ "none" "revenuecat" ];
      default = "none";
      description = "Billing provider for mobile in-app purchases. Set to revenuecat for hosted deployments that receive RevenueCat webhooks.";
    };

    hostedService = lib.mkOption {
      type = lib.types.nullOr lib.types.bool;
      default = null;
      description = "Whether this deployment is the first-party hosted Agent Tick service for hosted billing/entitlement gates. Leave null to let the server infer from publicUrl.";
    };

    revenueCatProjectId = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Optional RevenueCat project identifier for deployments using RevenueCat billing.";
    };

    billingTestMode = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Allow test-only manual billing state mutations. Keep disabled for production RevenueCat deployments.";
    };

    billingDevGrantEmailDomains = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [ ];
      description = "Verified email domains allowed to use the hosted development billing grant while billing test mode remains disabled. Entries match exact domains by default; use *.example.com to allow subdomains.";
    };

    privateRequestsPolicy = lib.mkOption {
      type = lib.types.enum [ "off" "default" "forced" ];
      default = "off";
      description = ''
        Server-wide Private Requests (end-to-end encrypted) policy.

        - "off": each Workspace/Routing Rule decides via its own toggle.
        - "default": new Workspaces are created with Private Requests
          required, but Workspace Owners can still toggle them off.
        - "forced": Private Requests are required for every Workspace and
          Routing Rule on this server, regardless of stored toggles, and
          cannot be disabled. Plain (unencrypted) CLI requests are rejected
          with HTTP 409 `private_required`.
      '';
    };

    requestNotificationWebhookUrl = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Optional Request notification webhook URL.";
    };

    retention = {
      requestDays = lib.mkOption { type = lib.types.nullOr lib.types.ints.unsigned; default = null; };
      statusUpdateDays = lib.mkOption { type = lib.types.nullOr lib.types.ints.unsigned; default = null; };
      auditDays = lib.mkOption { type = lib.types.nullOr lib.types.ints.unsigned; default = null; };
      unregisteredDeviceDays = lib.mkOption { type = lib.types.nullOr lib.types.ints.unsigned; default = null; };
      cleanupEnabled = lib.mkOption { type = lib.types.bool; default = true; };
      cleanupIntervalMinutes = lib.mkOption { type = lib.types.ints.positive; default = 60; };
      cleanupLockBackend = lib.mkOption { type = lib.types.enum [ "none" "redis" ]; default = "none"; };
      cleanupLockTtlMs = lib.mkOption { type = lib.types.ints.positive; default = 600000; };
    };

    rateLimit = {
      windowMs = lib.mkOption { type = lib.types.ints.positive; default = 60000; };
      maxRequests = lib.mkOption { type = lib.types.nullOr lib.types.ints.positive; default = null; };
    };

    environment = lib.mkOption {
      type = lib.types.attrsOf (lib.types.oneOf [ lib.types.str lib.types.int lib.types.bool ]);
      default = { };
      description = "Extra non-secret environment variables for Agent Tick.";
    };
  };

  config = lib.mkIf cfg.enable {
    users.groups.${cfg.group} = { };
    users.users.${cfg.user} = {
      isSystemUser = true;
      group = cfg.group;
      home = "/var/lib/agent-tick";
    };

    systemd.services.agent-tick = {
      description = "Agent Tick request-routing service";
      wantedBy = [ "multi-user.target" ];
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];

      environment = {
        AGENT_TICK_MODE = cfg.mode;
        AGENT_TICK_HOST = cfg.host;
        AGENT_TICK_PORT = toString cfg.port;
        AGENT_TICK_DATABASE_URL = cfg.databaseUrl;
        AGENT_TICK_DATABASE_MIGRATE_ON_START = envValue cfg.databaseMigrateOnStart;
      }
      // optionalEnv "AGENT_TICK_PUBLIC_URL" cfg.publicUrl
      // optionalEnv "AGENT_TICK_REDIS_URL" cfg.redisUrl
      // optionalEnv "AGENT_TICK_EVENT_BUS_BACKEND" cfg.eventBusBackend
      // optionalEnv "AGENT_TICK_RATE_LIMIT_BACKEND" cfg.rateLimitBackend
      // optionalEnv "AGENT_TICK_CLERK_PUBLISHABLE_KEY" cfg.clerkPublishableKey
      // optionalCSVEnv "AGENT_TICK_CLERK_AUTHORIZED_PARTIES" cfg.clerkAuthorizedParties
      // optionalEnv "AGENT_TICK_MAX_ACTIVE_MEMBERS" cfg.maxActiveMembers
      // optionalEnv "AGENT_TICK_BILLING_PROVIDER" cfg.billingProvider
      // optionalEnv "AGENT_TICK_HOSTED_SERVICE" cfg.hostedService
      // optionalEnv "AGENT_TICK_REVENUECAT_PROJECT_ID" cfg.revenueCatProjectId
      // optionalEnv "AGENT_TICK_BILLING_TEST_MODE" cfg.billingTestMode
      // optionalCSVEnv "AGENT_TICK_BILLING_DEV_GRANT_EMAIL_DOMAINS" cfg.billingDevGrantEmailDomains
      // optionalEnv "AGENT_TICK_PRIVATE_REQUESTS_POLICY" cfg.privateRequestsPolicy
      // optionalEnv "AGENT_TICK_REQUEST_NOTIFICATION_WEBHOOK_URL" cfg.requestNotificationWebhookUrl
      // optionalEnv "AGENT_TICK_REQUEST_RETENTION_DAYS" cfg.retention.requestDays
      // optionalEnv "AGENT_TICK_STATUS_UPDATE_RETENTION_DAYS" cfg.retention.statusUpdateDays
      // optionalEnv "AGENT_TICK_AUDIT_RETENTION_DAYS" cfg.retention.auditDays
      // optionalEnv "AGENT_TICK_UNREGISTERED_DEVICE_RETENTION_DAYS" cfg.retention.unregisteredDeviceDays
      // optionalEnv "AGENT_TICK_RETENTION_CLEANUP_ENABLED" cfg.retention.cleanupEnabled
      // optionalEnv "AGENT_TICK_RETENTION_CLEANUP_INTERVAL_MINUTES" cfg.retention.cleanupIntervalMinutes
      // optionalEnv "AGENT_TICK_RETENTION_CLEANUP_LOCK_BACKEND" cfg.retention.cleanupLockBackend
      // optionalEnv "AGENT_TICK_RETENTION_CLEANUP_LOCK_TTL_MS" cfg.retention.cleanupLockTtlMs
      // optionalEnv "AGENT_TICK_RATE_LIMIT_WINDOW_MS" cfg.rateLimit.windowMs
      // optionalEnv "AGENT_TICK_RATE_LIMIT_MAX_REQUESTS" cfg.rateLimit.maxRequests
      // lib.mapAttrs (_: envValue) cfg.environment;

      serviceConfig = {
        ExecStart = lib.getExe cfg.package;
        User = cfg.user;
        Group = cfg.group;
        StateDirectory = "agent-tick";
        WorkingDirectory = "/var/lib/agent-tick";
        EnvironmentFile = lib.optional (cfg.secretEnvironmentFile != null) cfg.secretEnvironmentFile;
        Restart = "on-failure";
        RestartSec = "5s";
        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        ReadWritePaths = [ "/var/lib/agent-tick" ];
      };
    };
  };
}
