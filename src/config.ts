/**
 * Gas Town configuration types and loader.
 *
 * Reads gas-town.jsonc from the opencode config directory.
 * Maps agent names to models, identity files, and tool restrictions.
 */

import { existsSync, readFileSync } from "fs";
import { join, resolve, dirname, isAbsolute } from "path";

export interface AgentToolRestrictions {
  [toolName: string]: boolean;
}

export interface AgentConfig {
  /** Model in "provider/model" format, e.g. "anthropic/claude-sonnet-4-5" */
  model?: string;
  /** Path to agent identity markdown file, relative to config dir */
  identity?: string;
  /** Tool allow/deny overrides. false = blocked for this agent. */
  tools?: AgentToolRestrictions;
  /** Max concurrent subagent sessions of this type */
  maxParallel?: number;
  /** Optional reasoning effort override */
  reasoningEffort?: string;
  /** Optional variant override */
  variant?: string;
}

export interface GasTownConfig {
  agents: Record<string, AgentConfig>;
}

const CONFIG_FILENAMES = [
  "gas-town.jsonc",
  "gas-town.json",
];

/**
 * Find and load gas-town config from standard locations.
 * Search order:
 * 1. Project directory (.opencode/gas-town.jsonc)
 * 2. User config (~/.config/opencode/gas-town.jsonc)
 */
export function loadConfig(projectDir: string): GasTownConfig {
  const searchPaths = [
    join(projectDir, ".opencode"),
    join(projectDir),
    getConfigDir(),
  ];

  for (const dir of searchPaths) {
    for (const filename of CONFIG_FILENAMES) {
      const filepath = join(dir, filename);
      if (existsSync(filepath)) {
        return parseConfig(filepath);
      }
    }
  }

  // No config found: return empty (all defaults)
  return { agents: {} };
}

function getConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg) return join(xdg, "opencode");
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  return join(home, ".config", "opencode");
}

function parseConfig(filepath: string): GasTownConfig {
  const raw = readFileSync(filepath, "utf-8");
  // Strip JSONC comments (// and /* */)
  const stripped = raw
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  try {
    return JSON.parse(stripped) as GasTownConfig;
  } catch (e) {
    console.error(`[gas-town] Failed to parse ${filepath}: ${e}`);
    return { agents: {} };
  }
}

/**
 * Resolve an identity file path relative to the config directory.
 */
export function resolveIdentityPath(
  identityPath: string,
  projectDir: string,
): string {
  if (isAbsolute(identityPath)) return identityPath;
  // Try project dir first, then config dir
  const fromProject = join(projectDir, identityPath);
  if (existsSync(fromProject)) return fromProject;
  const fromConfig = join(getConfigDir(), identityPath);
  if (existsSync(fromConfig)) return fromConfig;
  return fromProject; // fallback
}

/**
 * Load an identity file's contents. Returns empty string if not found.
 */
export function loadIdentity(
  identityPath: string,
  projectDir: string,
): string {
  const resolved = resolveIdentityPath(identityPath, projectDir);
  if (!existsSync(resolved)) {
    console.error(`[gas-town] Identity file not found: ${resolved}`);
    return "";
  }
  return readFileSync(resolved, "utf-8");
}

/**
 * Parse a "provider/model" string into providerID and modelID.
 */
export function parseModelString(
  model: string,
): { providerID: string; modelID: string } | null {
  const slash = model.indexOf("/");
  if (slash <= 0) return null;
  return {
    providerID: model.slice(0, slash),
    modelID: model.slice(slash + 1),
  };
}
