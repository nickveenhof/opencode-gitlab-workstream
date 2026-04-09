/**
 * Gas Town agent spawning tool.
 *
 * Registers a custom tool that spawns subagent sessions with
 * per-agent model routing via session.promptAsync().
 *
 * This is required because opencode's built-in `task` tool
 * does not support per-agent model overrides. The model must
 * be passed directly in the promptAsync() call body.
 */

import { tool } from "@opencode-ai/plugin";
import type { PluginInput } from "@opencode-ai/plugin";
import type { GasTownConfig } from "./config.js";
import { parseModelString } from "./config.js";

export function createAgentTool(
  config: GasTownConfig,
  ctx: PluginInput,
) {
  return tool({
    description:
      "Spawn a Gas Town subagent with per-agent model routing. " +
      "Use this instead of the built-in task tool when you need " +
      "a specific agent from gas-town.jsonc with its configured model.",
    args: {
      subagent_type: tool.schema
        .string()
        .describe("Agent name from gas-town.jsonc (e.g. explore, librarian, oracle)"),
      prompt: tool.schema
        .string()
        .describe("The task prompt for the subagent"),
      description: tool.schema
        .string()
        .optional()
        .describe("Short description of the task"),
      run_in_background: tool.schema
        .boolean()
        .optional()
        .describe("If true, return immediately with session_id. Default false (wait for result)."),
    },
    async execute(args, toolContext) {
      const agentName = args.subagent_type.toLowerCase();
      const agentConfig = config.agents[agentName]
        ?? Object.entries(config.agents).find(
          ([k]) => k.toLowerCase() === agentName,
        )?.[1];

      // Parse model from config
      let model: { providerID: string; modelID: string } | undefined;
      if (agentConfig?.model) {
        model = parseModelString(agentConfig.model) ?? undefined;
      }

      // Parse tool restrictions
      const tools: Record<string, boolean> = {};
      if (agentConfig?.tools) {
        Object.assign(tools, agentConfig.tools);
      }
      // Subagents should not spawn further subagents by default
      if (tools.task === undefined) {
        tools.task = false;
      }
      if (tools.call_gas_town_agent === undefined) {
        tools.call_gas_town_agent = false;
      }

      try {
        // Create child session
        const createResult = await ctx.client.session.create({
          body: {
            parentID: toolContext.sessionID,
            title: `${args.description ?? args.subagent_type} (@${agentName})`,
          },
          query: { directory: ctx.directory },
        });

        if (createResult.error) {
          return `[gas-town] Failed to create session: ${createResult.error}`;
        }

        const sessionID = (createResult.data as any)?.id;
        if (!sessionID) {
          return `[gas-town] Session created but no ID returned`;
        }

        // Send prompt with model override
        const promptResult = await ctx.client.session.promptAsync({
          path: { id: sessionID },
          body: {
            agent: agentName,
            ...(model ? { model } : {}),
            ...(Object.keys(tools).length > 0 ? { tools } : {}),
            parts: [{ type: "text" as const, text: args.prompt }],
          },
          query: { directory: ctx.directory },
        });

        if (promptResult.error) {
          return `[gas-town] Prompt error: ${promptResult.error}`;
        }

        // Background mode: return immediately, don't poll.
        if (args.run_in_background) {
          return `[gas-town] Agent started in background.\n\n<task_metadata>\nsession_id: ${sessionID}\n</task_metadata>`;
        }

        // Poll for completion using session.status() + stable message count.
        // Backs off from 500ms to 3s over time to handle slow Opus-class models.
        const MAX_WAIT = 15 * 60 * 1000; // 15 minutes (Opus needs more time)
        const pollStart = Date.now();
        let lastMsgCount = 0;
        let stablePolls = 0;
        const STABILITY_REQUIRED = 3;

        while (Date.now() - pollStart < MAX_WAIT) {
          if (toolContext.abort.aborted) {
            return `[gas-town] Task aborted. Session: ${sessionID}`;
          }

          // Back off: 500ms for first 30s, 1s up to 2min, 3s after that
          const elapsed = Date.now() - pollStart;
          const interval = elapsed < 30000 ? 500 : elapsed < 120000 ? 1000 : 3000;
          await new Promise((r) => setTimeout(r, interval));

          // Check if session is idle
          const statusResult = await (ctx.client.session as any).status();
          const allStatuses = statusResult?.data ?? statusResult ?? {};
          const sessionStatus = allStatuses[sessionID];

          if (sessionStatus && sessionStatus.type !== "idle") {
            stablePolls = 0;
            lastMsgCount = 0;
            continue;
          }

          // Session idle: check message count stability
          const messagesResult = await ctx.client.session.messages({
            path: { id: sessionID },
          });
          const msgs: any[] = Array.isArray(messagesResult?.data)
            ? messagesResult.data
            : [];
          const currentCount = msgs.length;

          if (currentCount > 0 && currentCount === lastMsgCount) {
            stablePolls++;
            if (stablePolls >= STABILITY_REQUIRED) {
              // Done. Role is at m.info.role, not m.role.
              const assistantMsgs = msgs.filter(
                (m: any) => m.info?.role === "assistant" || m.info?.role === "tool",
              );
              const extractedContent: string[] = [];
              for (const msg of assistantMsgs) {
                for (const part of msg.parts ?? []) {
                  if ((part.type === "text" || part.type === "reasoning") && part.text) {
                    extractedContent.push(part.text);
                  }
                }
              }
              const text = extractedContent.filter(Boolean).join("\n");
              return (text || "[gas-town] Agent completed but returned no text") +
                `\n\n<task_metadata>\nsession_id: ${sessionID}\n</task_metadata>`;
            }
          } else {
            stablePolls = 0;
            lastMsgCount = currentCount;
          }
        }

        return `[gas-town] Agent timed out after 5 minutes. Session: ${sessionID}`;
      } catch (e: any) {
        return `[gas-town] Error: ${e.message}`;
      }
    },
  });
}
