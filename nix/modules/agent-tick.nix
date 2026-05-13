{ self }:
{ config, lib, pkgs, ... }:
let
  cfg = config.services.agent-tick;

  envValue = value:
    if lib.isBool value then lib.boolToString value else toString value;

  optionalEnv = name: value:
    lib.optionalAttrs (value != null) { ${name} = envValue value; };

  optionalCSVEnv = name: values:
    lib.optionalAttrs (values != []) { ${name} = lib.concatStringsSep "," values; };

in {
  options.services.agent-tick = {
    enable = lib.mkEnableOption "Agent Tick approval service";

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
      description = "Database URL. Supports SQLite file URLs for simple deployments and PostgreSQL URLs for production-style deployments.";
    };

    databaseMigrateOnStart = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Whether the server should run database migrations during startup.";
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
      description = "Backend used for approval/audit event wakeups.";
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
        AGENT_TICK_ADMIN_TOKEN or AGENT_TICK_CLERK_SECRET_KEY. This is intended
        to be provided by agenix, sops-nix, or another secret manager.
      '';
    };

    clerkPublishableKey = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Clerk publishable key for clerk mode. This is not secret.";
    };

    clerkAuthorizedParties = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      default = [];
      description = "Allowed Clerk token authorized parties/origins.";
    };

    maxActiveMembers = lib.mkOption {
      type = lib.types.nullOr lib.types.ints.positive;
      default = null;
      description = "Optional self-hosted active-member seat limit.";
    };

    inviteEmailWebhookUrl = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Optional invite email webhook URL.";
    };

    approvalNotificationWebhookUrl = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Optional approval notification webhook URL.";
    };

    retention = {
      approvalDays = lib.mkOption { type = lib.types.nullOr lib.types.ints.unsigned; default = null; };
      auditDays = lib.mkOption { type = lib.types.nullOr lib.types.ints.unsigned; default = null; };
      unregisteredDeviceDays = lib.mkOption { type = lib.types.nullOr lib.types.ints.unsigned; default = null; };
      expiredInviteDays = lib.mkOption { type = lib.types.nullOr lib.types.ints.unsigned; default = null; };
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
      default = {};
      description = "Extra non-secret environment variables for Agent Tick.";
    };
  };

  config = lib.mkIf cfg.enable {
    users.groups.${cfg.group} = {};
    users.users.${cfg.user} = {
      isSystemUser = true;
      group = cfg.group;
      home = "/var/lib/agent-tick";
    };

    systemd.services.agent-tick = {
      description = "Agent Tick approval service";
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
      // optionalEnv "AGENT_TICK_INVITE_EMAIL_WEBHOOK_URL" cfg.inviteEmailWebhookUrl
      // optionalEnv "AGENT_TICK_APPROVAL_NOTIFICATION_WEBHOOK_URL" cfg.approvalNotificationWebhookUrl
      // optionalEnv "AGENT_TICK_APPROVAL_RETENTION_DAYS" cfg.retention.approvalDays
      // optionalEnv "AGENT_TICK_AUDIT_RETENTION_DAYS" cfg.retention.auditDays
      // optionalEnv "AGENT_TICK_UNREGISTERED_DEVICE_RETENTION_DAYS" cfg.retention.unregisteredDeviceDays
      // optionalEnv "AGENT_TICK_EXPIRED_INVITE_RETENTION_DAYS" cfg.retention.expiredInviteDays
      // optionalEnv "AGENT_TICK_RETENTION_CLEANUP_ENABLED" cfg.retention.cleanupEnabled
      // optionalEnv "AGENT_TICK_RETENTION_CLEANUP_INTERVAL_MINUTES" cfg.retention.cleanupIntervalMinutes
      // optionalEnv "AGENT_TICK_RETENTION_CLEANUP_LOCK_BACKEND" cfg.retention.cleanupLockBackend
      // optionalEnv "AGENT_TICK_RETENTION_CLEANUP_LOCK_TTL_MS" cfg.retention.cleanupLockTtlMs
      // optionalEnv "AGENT_TICK_RATE_LIMIT_WINDOW_MS" cfg.rateLimit.windowMs
      // optionalEnv "AGENT_TICK_RATE_LIMIT_MAX_REQUESTS" cfg.rateLimit.maxRequests
      // cfg.environment;

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
