/**
 * Gas Town hooks.
 *
 * One hook: tool.execute.after
 * - JSON truncation recovery: detect parse errors and append retry guidance
 * - Task retry guidance: detect unknown agent type and suggest fix
 *
 * Everything else is native opencode:
 * - core-rules.md: loaded via "instructions" in opencode.json
 * - Agent identity: loaded via YAML frontmatter in agents/*.md
 * - Model routing: configured via "model" in agents/*.md frontmatter
 */

// ── Hook: tool.execute.after (error recovery) ─────────────────────────

const JSON_ERROR_PATTERNS = [
  "JSON Parse error: Expected '}'",
  "JSON Parse error: Unterminated string",
  "expected string, received undefined",
];

const TASK_ERROR_PATTERNS = [
  {
    pattern: /Unknown agent type: (\S+) is not a valid agent type/i,
    guidance:
      "[gas-town] Unknown agent type. Check agents/*.md files and opencode.json. " +
      "Agent name must match the .md filename exactly.",
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
