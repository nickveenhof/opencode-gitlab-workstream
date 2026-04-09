/**
 * Gas Town: Agent-less orchestration infrastructure for OpenCode.
 *
 * Model routing, identity injection, error recovery.
 * Zero agent opinions. Bring your own agents.
 *
 * @see https://github.com/nickveenhof/gas-town
 */

import type { Plugin, Hooks } from "@opencode-ai/plugin";
import {
  createChatMessageHook,
  createSystemTransformHook,
  createToolExecuteAfterHook,
} from "./hooks.js";

const GasTown: Plugin = async (input: PluginInput): Promise<Hooks> => {
  const { directory } = input;

  return {
    // Identity injection: prepend agent identity to user messages.
    // Reads agents/*.md files per agent name. Model routing is handled
    // natively by opencode via the agent section in opencode.json.
    "chat.message": createChatMessageHook(directory),

    // System prompt: inject core-rules.md into every session
    "experimental.chat.system.transform": createSystemTransformHook(directory),

    // Error recovery: JSON truncation + delegate-task retry guidance
    "tool.execute.after": createToolExecuteAfterHook(),
  };
};

export default GasTown;

// Named export for explicit import
export { GasTown };
