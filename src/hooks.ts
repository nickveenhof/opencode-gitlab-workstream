/**
 * Gas Town hooks.
 *
 * Four hooks that provide the orchestration infrastructure:
 * 1. chat.params     - Override model per agent
 * 2. chat.message    - Inject identity + core-rules into subagent messages
 * 3. tool.execute.after - Error recovery (JSON truncation, delegate-task retry)
 * 4. experimental.chat.system.transform - System prompt injection for subagents
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { GasTownConfig, AgentConfig } from "./config.js";
import { loadIdentity, parseModelString } from "./config.js";

// ── Core rules loader ────────────────────────────────────────────────

let coreRulesCache: string | null = null;

function loadCoreRules(projectDir: string): string {
  if (coreRulesCache !== null) return coreRulesCache;

  // Search order: project .opencode/, project root, plugin dir
  const searchPaths = [
    join(projectDir, ".opencode", "core-rules.md"),
    join(projectDir, "core-rules.md"),
  ];

  for (const p of searchPaths) {
    if (existsSync(p)) {
      coreRulesCache = readFileSync(p, "utf-8");
      return coreRulesCache;
    }
  }

  // Fallback: bundled core rules
  const bundled = join(import.meta.dir ?? __dirname, "..", "core-rules.md");
  if (existsSync(bundled)) {
    coreRulesCache = readFileSync(bundled, "utf-8");
    return coreRulesCache;
  }

  coreRulesCache = "";
  return coreRulesCache;
}

// ── Identity cache ───────────────────────────────────────────────────

const identityCache = new Map<string, string>();

function getIdentity(agentConfig: AgentConfig, projectDir: string): string {
  if (!agentConfig.identity) return "";
  const cached = identityCache.get(agentConfig.identity);
  if (cached !== undefined) return cached;
  const content = loadIdentity(agentConfig.identity, projectDir);
  identityCache.set(agentConfig.identity, content);
  return content;
}

// ── Hook: chat.params (model routing) ────────────────────────────────

export function createChatParamsHook(config: GasTownConfig) {
  return async (
    input: { sessionID: string; agent: string; model: any; provider: any; message: any },
    output: { temperature: number; topP: number; topK: number; options: Record<string, any> },
  ) => {
    const agentName = input.agent?.toLowerCase?.();
    if (!agentName) return;

    const agentConfig = findAgentConfig(config, agentName);
    if (!agentConfig?.model) return;

    const parsed = parseModelString(agentConfig.model);
    if (!parsed) return;

    // Override model via output options
    // opencode reads model override from chat.params output
    output.options = output.options ?? {};
    output.options.__gastown_model = parsed;

    if (agentConfig.variant) {
      output.options.__gastown_variant = agentConfig.variant;
    }
    if (agentConfig.reasoningEffort) {
      output.options.reasoningEffort = agentConfig.reasoningEffort;
    }
  };
}

// ── Hook: experimental.chat.system.transform (identity injection) ────

export function createSystemTransformHook(
  config: GasTownConfig,
  projectDir: string,
) {
  return async (
    input: { sessionID?: string; model: any },
    output: { system: string[] },
  ) => {
    // We inject core-rules for all sessions, identity per-agent
    // Note: we cannot determine agent name from this hook input,
    // so we inject core-rules universally. Identity injection
    // happens in chat.message where we have the agent name.
    const coreRules = loadCoreRules(projectDir);
    if (coreRules) {
      output.system.push(coreRules);
    }
  };
}

// ── Hook: chat.message (identity injection per agent) ────────────────

export function createChatMessageHook(
  config: GasTownConfig,
  projectDir: string,
) {
  return async (
    input: {
      sessionID: string;
      agent?: string;
      model?: { providerID: string; modelID: string };
      messageID?: string;
      variant?: string;
    },
    output: {
      message: any;
      parts: Array<{ type: string; text?: string }>;
    },
  ) => {
    const agentName = input.agent?.toLowerCase?.();
    if (!agentName) return;

    const agentConfig = findAgentConfig(config, agentName);
    if (!agentConfig) return;

    // Inject identity into the first text part
    const identity = getIdentity(agentConfig, projectDir);
    if (!identity) return;

    const firstTextPart = output.parts.find(
      (p) => p.type === "text" && p.text,
    );
    if (firstTextPart && firstTextPart.text) {
      firstTextPart.text =
        `<agent-identity>\n${identity}\n</agent-identity>\n\n` +
        firstTextPart.text;
    }
  };
}

// ── Hook: tool.execute.after (error recovery) ────────────────────────

const JSON_ERROR_PATTERNS = [
  "JSON Parse error: Expected '}'",
  "JSON Parse error: Unterminated string",
  "expected string, received undefined",
  "invalid_type",
];

const DELEGATE_TASK_ERROR_PATTERNS = [
  {
    pattern: /Must provide either category or subagent_type/i,
    guidance:
      "[gas-town retry] Missing category or subagent_type. " +
      "Use: task(subagent_type=\"agent_name\", load_skills=[], prompt=\"...\", run_in_background=false)",
  },
  {
    pattern: /Agent ['"](\w+)['"] is not (?:allowed|found)/i,
    guidance:
      "[gas-town retry] Agent not found. Check gas-town.jsonc for available agent names.",
  },
];

export function createToolExecuteAfterHook() {
  return async (
    input: { tool: string; sessionID: string; callID: string; args: any },
    output: { title: string; output: string; metadata: any },
  ) => {
    if (typeof output.output !== "string") return;

    // JSON truncation recovery
    const isJsonError = JSON_ERROR_PATTERNS.some((p) =>
      output.output.includes(p),
    );
    if (isJsonError) {
      output.output +=
        "\n\n[gas-town] JSON truncation detected. " +
        "Do NOT retry with the same payload. " +
        "Split content into smaller pieces or write to a temp file first.";
      return;
    }

    // Delegate task retry guidance
    const toolName = input.tool.toLowerCase();
    if (toolName === "task" || toolName === "call_omo_agent") {
      for (const { pattern, guidance } of DELEGATE_TASK_ERROR_PATTERNS) {
        if (pattern.test(output.output)) {
          output.output += `\n\n${guidance}`;
          return;
        }
      }
    }
  };
}

// ── Utility ──────────────────────────────────────────────────────────

function findAgentConfig(
  config: GasTownConfig,
  agentName: string,
): AgentConfig | undefined {
  // Exact match first
  if (config.agents[agentName]) return config.agents[agentName];
  // Case-insensitive fallback
  const key = Object.keys(config.agents).find(
    (k) => k.toLowerCase() === agentName,
  );
  return key ? config.agents[key] : undefined;
}
