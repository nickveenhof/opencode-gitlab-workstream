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

        // Background mode: return immediately with session ID.
        if (args.run_in_background) {
          return `[gas-town] Agent started.\n\n<task_metadata>\nsession_id: ${sessionID}\n</task_metadata>`;
        }

        // Poll session.messages() until last assistant message has
        // info.time.completed set. That field appears when LLM finishes.
        // NOTE: session.status() keys by PARENT session ID, not subagent
        // session ID. Cannot use it to check subagent completion.
        const MAX_WAIT = 10 * 60 * 1000;
        const POLL_INTERVAL = 500;
        const LOG_INTERVAL = 5000; // report status every 5s
        const pollStart = Date.now();
        let lastLogTime = pollStart;
        let pollCount = 0;

        while (Date.now() - pollStart < MAX_WAIT) {
          if (toolContext.abort?.aborted) {
            return `[gas-town] Task aborted. Session: ${sessionID}`;
          }

          await new Promise((r) => setTimeout(r, POLL_INTERVAL));
          pollCount++;

          const messagesResult = await ctx.client.session.messages({
            path: { id: sessionID },
          });
          const msgs: any[] = Array.isArray(messagesResult?.data)
            ? messagesResult.data : [];

          const assistantMsgs = msgs.filter((m: any) => m.info?.role === "assistant");
          const lastAssistant = assistantMsgs.at(-1);
          const elapsed = Math.round((Date.now() - pollStart) / 1000);

          // Report status every 5s via toolContext.metadata
          if (Date.now() - lastLogTime >= LOG_INTERVAL) {
            lastLogTime = Date.now();
            const lastParts = lastAssistant?.parts ?? [];
            const lastText = lastParts
              .filter((p: any) => p.type === "text" && p.text)
              .map((p: any) => p.text)
              .join(" ")
              .slice(0, 120);
            toolContext.metadata({
              title: `[gas-town] ${sessionID} — ${elapsed}s elapsed`,
              metadata: {
                poll: pollCount,
                msgCount: msgs.length,
                assistantMsgs: assistantMsgs.length,
                lastAssistantCompleted: !!lastAssistant?.info?.time?.completed,
                lastAssistantFinish: lastAssistant?.info?.finish ?? null,
                lastTextPreview: lastText || "(none yet)",
              },
            });
          }

          if (lastAssistant?.info?.time?.completed) {
            const text = (lastAssistant.parts ?? [])
              .filter((p: any) => p.type === "text" && p.text)
              .map((p: any) => p.text)
              .join("\n");
            return (text || "[gas-town] Agent completed but returned no text") +
              `\n\n<task_metadata>\nsession_id: ${sessionID}\n</task_metadata>`;
          }
        }

        return `[gas-town] Agent timed out. Session: ${sessionID}`;
      } catch (e: any) {
        return `[gas-town] Error: ${e.message}`;
      }
    },
  });
}
