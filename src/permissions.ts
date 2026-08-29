import path from "node:path";

export type PermissionDecision = "allow" | "deny" | "ask";

export interface PermissionRequest {
  toolName: string;
  args: Record<string, unknown>;
  workspace: string;
}

export interface PermissionResult {
  decision: PermissionDecision;
  reason?: string;
}

/**
 * Pre-tool gate before local execution.
 */
export function checkPermission(req: PermissionRequest): PermissionResult {
  const workspaceRoot = path.resolve(req.workspace);

  if ("path" in req.args && typeof req.args.path === "string") {
    const resolved = resolveUnderWorkspace(workspaceRoot, req.args.path);
    if (!resolved.ok) {
      return { decision: "deny", reason: resolved.reason };
    }
  }

  if (req.toolName === "bash" && typeof req.args.command === "string") {
    if (looksDangerous(req.args.command)) {
      return {
        decision: "ask",
        reason: "Command looks potentially destructive; confirm before running.",
      };
    }
  }

  return { decision: "allow" };
}

export function resolveUnderWorkspace(
  workspaceRoot: string,
  filePath: string,
): { ok: true; absolute: string } | { ok: false; reason: string } {
  const root = path.resolve(workspaceRoot);
  const absolute = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(root, filePath);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return {
      ok: false,
      reason: `Path escapes workspace: ${filePath}`,
    };
  }
  return { ok: true, absolute };
}

function looksDangerous(command: string): boolean {
  const lower = command.toLowerCase();
  const patterns = [
    /rm\s+(-[a-z]*f|\/s)/i,
    /del\s+\/[sq]/i,
    /format\s+/i,
    /shutdown/i,
    /:\(\)\s*\{\s*:\|:&\s*\};:/,
  ];
  return patterns.some((re) => re.test(lower));
}
