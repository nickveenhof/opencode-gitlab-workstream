# Gas Town

Agent-less orchestration infrastructure plugin for [OpenCode](https://github.com/anomalyco/opencode).

Model routing, identity injection, error recovery. Zero agent opinions. Bring your own agents.

## Why

Every OpenCode orchestration plugin ships with opinionated agent rosters. Sisyphus, Orchestrator, Loom, Architect. You get their agents whether you want them or not.

Gas Town is different. It provides the **infrastructure only**:

- **Model routing**: different models per agent (Haiku for exploration, Opus for strategy)
- **Identity injection**: load agent personality from your own markdown files
- **Core rules**: shared rules injected into every subagent (tone, fact-checking, output format)
- **Error recovery**: JSON truncation detection, delegate-task retry guidance
- **Tool restrictions**: control which tools each agent type can access

You define the agents. Gas Town routes them.

## Install

```bash
# In your opencode project
npm install gas-town
```

Add to your `opencode.json`:

```json
{
  "plugin": ["gas-town"]
}
```

## Configure

Create `~/.config/opencode/gas-town.jsonc` (or `.opencode/gas-town.jsonc` in your project):

```jsonc
{
  "agents": {
    "explore": {
      "model": "anthropic/claude-haiku-3-5",
      "tools": { "write": false, "edit": false, "task": false },
      "maxParallel": 4
    },
    "librarian": {
      "model": "anthropic/claude-sonnet-4-5",
      "identity": "agents/librarian.md",
      "tools": { "write": false, "edit": false, "task": false }
    },
    "oracle": {
      "model": "anthropic/claude-opus-4",
      "identity": "agents/oracle.md",
      "tools": { "write": false, "edit": false, "task": false }
    },
    "builder": {
      "model": "anthropic/claude-sonnet-4-5",
      "identity": "agents/builder.md"
    }
  }
}
```

Agent names must match what you pass to `task(subagent_type="...")`.

## Agent Identity Files

Identity files are markdown files that define an agent's personality, rules, and output format. Place them anywhere and reference them in the config:

```jsonc
{
  "agents": {
    "librarian": {
      "model": "anthropic/claude-sonnet-4-5",
      "identity": "agents/librarian.md"
    }
  }
}
```

Gas Town resolves identity paths relative to the project directory first, then the config directory.

## Core Rules

Gas Town injects a shared `core-rules.md` into every subagent session. This file contains tone rules, fact-checking requirements, output format guidelines, and the em-dash gate.

To customize: place your own `core-rules.md` in `.opencode/` or the project root. Gas Town uses the first one found in this order:

1. `.opencode/core-rules.md`
2. `./core-rules.md` (project root)
3. Bundled default (from the gas-town package)

## How It Works

Gas Town uses four OpenCode plugin hooks:

| Hook | Purpose |
|---|---|
| `chat.params` | Override model per agent based on config |
| `chat.message` | Inject agent identity into user messages |
| `experimental.chat.system.transform` | Inject core-rules.md into system prompt |
| `tool.execute.after` | JSON truncation recovery, delegate-task retry |

When you call `task(subagent_type="librarian", ...)`:

1. OpenCode creates a child session
2. Gas Town reads the agent name from the session
3. Gas Town looks up `gas-town.jsonc` for model and identity
4. Model is overridden via `chat.params` hook
5. Identity is injected via `chat.message` hook
6. Core rules are injected via `experimental.chat.system.transform`

No AGENTS.md injection. No search-mode. No analyze-mode. No VERIFICATION_REMINDER. Just your agent identity and your core rules.

## Migration from oh-my-openagent

1. Replace `call_omo_agent(...)` with `task(...)` in your prompts
2. Copy your agent identity files (they work as-is)
3. Create `gas-town.jsonc` from your `oh-my-openagent.jsonc` agent configs
4. Replace `"oh-my-openagent"` with `"gas-town"` in your `opencode.json` plugin array
5. Remove `oh-my-openagent` from `package.json`

```diff
# In your agent prompts:
- call_omo_agent(subagent_type="librarian", prompt="...", run_in_background=true)
+ task(subagent_type="librarian", load_skills=[], prompt="...", run_in_background=true)

# In opencode.json:
- "plugin": ["oh-my-openagent", "opencode-notify"]
+ "plugin": ["gas-town", "opencode-notify"]
```

## Token Overhead

| Component | Tokens |
|---|---|
| Core rules (shared) | ~400 |
| Agent identity (avg) | ~1,200 |
| **Total per subagent** | **~1,600** |

Compare with oh-my-openagent: ~7,900 tokens per subagent (AGENTS.md + search-mode + VERIFICATION_REMINDER + identity). Gas Town saves ~80% of subagent prompt overhead.

## What Gas Town Does NOT Do

- **No built-in agents.** You define them.
- **No orchestration opinions.** No Sisyphus, no ultrawork, no planning phases.
- **No AGENTS.md injection into subagents.** Your orchestrator session gets AGENTS.md via OpenCode's built-in mechanism. Subagents get only core-rules.md and their identity file.
- **No search-mode / analyze-mode injection.** Those are OMO-specific prompt prefixes.
- **No tmux/multiplexer integration.** Use oh-my-opencode for that.
- **No LSP/AST-grep tools.** Use oh-my-opencode for that.

## License

MIT
