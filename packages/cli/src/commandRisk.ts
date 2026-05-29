export function isRiskyCommand(command: string): boolean {
  return riskyCommandPatterns.some((pattern) => pattern.test(command));
}

const riskyCommandPatterns = [
  /\brm\s+(-rf?|--recursive)\b/i,
  /\bsudo\b/i,
  /\b(chmod|chown)\b.*\b777\b/i,
  /\b(git|jj)\s+.*\bpush\b/i,
  /\b(docker|podman)\s+compose\s+up\b/i,
  /\b(kubectl|helm|terraform|tofu)\b/i,
  /\b(npm|pnpm|yarn|bun)\s+(install|add|remove|update|upgrade)\b/i,
  /\b(migrate|migration|deploy|release|publish)\b/i,
  /\b\.env\b/i
];
