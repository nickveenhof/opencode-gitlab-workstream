/**
 * Gas Town: Agent-less orchestration infrastructure for OpenCode.
 *
 * Model routing, identity injection, error recovery.
 * Zero agent opinions. Bring your own agents.
 *
 * @see https://github.com/nickveenhof/gas-town
 */

import type { Plugin, Hooks } from "@opencode-ai/plugin";
import { createToolExecuteAfterHook } from "./hooks.js";

const GasTown: Plugin = async (_input: PluginInput): Promise<Hooks> => {
  return {
    // Error recovery: JSON truncation + delegate-task retry guidance.
    // core-rules.md is loaded natively via opencode.json "instructions" field.
    // Agent identity is loaded natively via agents/*.md frontmatter.
    // Model routing is configured natively via agents/*.md frontmatter.
    "tool.execute.after": createToolExecuteAfterHook(),
  };
};

export default GasTown;

// Named export for explicit import
export { GasTown };
