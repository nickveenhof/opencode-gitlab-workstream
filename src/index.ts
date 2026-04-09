/**
 * Gas Town: Agent-less orchestration infrastructure for OpenCode.
 *
 * Model routing, identity injection, error recovery.
 * Zero agent opinions. Bring your own agents.
 *
 * @see https://github.com/nickveenhof/gas-town
 */

import type { Plugin, Hooks, PluginInput } from "@opencode-ai/plugin";
import { loadConfig } from "./config.js";
import {
  createChatParamsHook,
  createChatMessageHook,
  createSystemTransformHook,
  createToolExecuteAfterHook,
} from "./hooks.js";

const GasTown: Plugin = async (input: PluginInput): Promise<Hooks> => {
  const { directory } = input;

  // Load configuration
  const config = loadConfig(directory);

  const agentCount = Object.keys(config.agents).length;
  if (agentCount === 0) {
    console.warn(
      "[gas-town] No agents configured. " +
      "Create a gas-town.jsonc in .opencode/ or ~/.config/opencode/",
    );
  }

  return {
    // Model routing: override model per agent based on config
    "chat.params": createChatParamsHook(config),

    // Identity injection: prepend agent identity to user messages
    "chat.message": createChatMessageHook(config, directory),

    // System prompt: inject core-rules.md for all sessions
    "experimental.chat.system.transform": createSystemTransformHook(
      config,
      directory,
    ),

    // Error recovery: JSON truncation + delegate-task retry guidance
    "tool.execute.after": createToolExecuteAfterHook(),
  };
};

export default GasTown;

// Named export for explicit import
export { GasTown };
export type { GasTownConfig, AgentConfig } from "./config.js";
