/**
 * Gas Town hooks.
 *
 * Three hooks:
 * 1. chat.message    - Inject agent identity from agents/*.md
 * 2. experimental.chat.system.transform - Inject core-rules.md
 * 3. tool.execute.after - Error recovery (JSON truncation, task retry)
 *
 * Model routing is handled natively by opencode via the `agent`
 * section in opencode.json. No config file needed here.
 */

import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";

// ── Core rules loader ────────────────────────────────────────────────

let coreRulesCache: string | null = null;

function loadCoreRules(projectDir: string): string {
  if (coreRulesCache !== null) return coreRulesCache;

  const searchPaths = [
    join(projectDir, ".opencode", "core-rules.md"),
    join(projectDir, "core-rules.md"),
    join(import.meta.dir ?? __dirname, "..", "core-rules.md"),
  ];

  for (const p of searchPaths) {
    if (existsSync(p)) {
      coreRulesCache = readFileSync(p, "utf-8");
      return coreRulesCache;
    }
  }

  coreRulesCache = "";
  return coreRulesCache;
}

// ── Identity loader ───────────────────────────────────────────────────

const identityCache = new Map<string, string>();

function loadAgentIdentity(agentName: string, projectDir: string): string {
  const cached = identityCache.get(agentName);
  if (cached !== undefined) return cached;

  // Map agent name to identity file in agents/ directory
  // Tries: agents/<name>.md, agents/<name>/ directory index
  const agentsDir = join(projectDir, "agents");
  const candidates = [
    join(agentsDir, `${agentName}.md`),
    // common mapping overrides
    join(agentsDir, "analytics-insights-mgr.md"),  // librarian
    join(agentsDir, "developer-advocate.md"),       // oracle
  ];

  // Direct match first
  const direct = join(agentsDir, `${agentName}.md`);
  if (existsSync(direct)) {
    const content = readFileSync(direct, "utf-8");
    identityCache.set(agentName, content);
    return content;
  }

  // Name mapping: opencode agent names → identity files
  const nameMap: Record<string, string> = {
    librarian: "analytics-insights-mgr.md",
    oracle: "developer-advocate.md",
    scribe: "technical-writer.md",
    social: "social-media-mgr.md",
    sentinel: "fullstack-engineer.md",
    designer: "ux-designer.md",
    architect: "solutions-architect.md",
    reviewer: "quality-reviewer.md",
  };

  const mapped = nameMap[agentName];
  if (mapped) {
    const p = join(agentsDir, mapped);
    if (existsSync(p)) {
      const content = readFileSync(p, "utf-8");
      identityCache.set(agentName, content);
      return content;
    }
  }

  identityCache.set(agentName, "");
  return "";
}

// ── Hook: chat.message (identity injection) ───────────────────────────

export function createChatMessageHook(projectDir: string) {
  return async (
    input: { sessionID: string; agent?: string },
    output: { message: any; parts: Array<{ type: string; text?: string }> },
  ) => {
    const agentName = input.agent?.toLowerCase?.();
    if (!agentName || agentName === "paul" || agentName === "build") return;

    const identity = loadAgentIdentity(agentName, projectDir);
    if (!identity) return;

    const firstTextPart = output.parts.find((p) => p.type === "text" && p.text);
    if (firstTextPart && firstTextPart.text) {
      firstTextPart.text =
        `<agent-identity>\n${identity}\n</agent-identity>\n\n` +
        firstTextPart.text;
    }
  };
}

// ── Hook: experimental.chat.system.transform (core-rules) ────────────

export function createSystemTransformHook(projectDir: string) {
  return async (
    _input: { model: any },
    output: { system: string[] },
  ) => {
    const coreRules = loadCoreRules(projectDir);
    if (coreRules) {
      output.system.push(coreRules);
    }
  };
}

// ── Hook: tool.execute.after (error recovery) ─────────────────────────

const JSON_ERROR_PATTERNS = [
  "JSON Parse error: Expected '}'",
  "JSON Parse error: Unterminated string",
  "expected string, received undefined",
];

const TASK_ERROR_PATTERNS = [
  {
    pattern: /Unknown agent type: (\w+) is not a valid agent type/i,
    guidance:
      "[gas-town] Unknown agent type. Check the `agent` section in opencode.json. " +
      "Agent name must match exactly what is defined there.",
  },
];

export function createToolExecuteAfterHook() {
  return async (
    input: { tool: string; sessionID: string; callID: string; args: any },
    output: { title: string; output: string; metadata: any },
  ) => {
    if (typeof output.output !== "string") return;

    if (JSON_ERROR_PATTERNS.some((p) => output.output.includes(p))) {
      output.output +=
        "\n\n[gas-town] JSON truncation detected. " +
        "Do NOT retry with the same payload. " +
        "Split content into smaller pieces or write to a temp file first.";
      return;
    }

    if (input.tool === "task") {
      for (const { pattern, guidance } of TASK_ERROR_PATTERNS) {
        if (pattern.test(output.output)) {
          output.output += `\n\n${guidance}`;
          return;
        }
      }
    }
  };
}
