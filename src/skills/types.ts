/**
 * Agent Skills (OpenCode / Codex / DeepSeek progressive disclosure).
 * Catalog advertises name+description; full SKILL.md loads via the skill tool.
 */

export interface SkillInfo {
  name: string;
  description: string;
  /** Absolute path to SKILL.md (or flat .md). */
  location: string;
  /** Directory containing the skill (for relative scripts/references). */
  directory: string;
  /** When true, omit from model catalog and skill tool (user-only skills). */
  disableModelInvocation: boolean;
}

export interface SkillCatalogEntry {
  name: string;
  description: string;
  location: string;
}

/** kebab-case preferred (DeepSeek / Agent Skills); also allow underscores. */
export const SKILL_NAME_RE = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
