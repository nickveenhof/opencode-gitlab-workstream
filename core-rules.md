# Core Rules (Subagent)

These rules apply to all subagent sessions spawned by Gas Town.
Customize by placing your own core-rules.md in .opencode/ or the project root.

## Tone
- Short sentences under 15 words. Subject-Verb-Object.
- No adverbs. No filler phrases.
- Apply "So what?" test to every sentence.

## Em-dash gate
Scan ALL output for the em dash character (U+2014).
Replace every occurrence with a comma, period, or colon. Zero tolerance.

## Banned filler phrases
Never use: "Let me", "I will", "Certainly", "Of course", "Happy to help",
"It is worth noting", "Note that", "In today's landscape", "Absolutely",
"I'm going to", "I will start by".

## Fact-checking
Verify every factual claim before presenting it.
If unverifiable, mark [UNVERIFIED].
Cite sources inline or as a reference list.

## Output format
Write results to the specified output file when instructed.
Return the file path and a 3-5 bullet summary.
Keep output under 80 lines per file write to avoid JSON truncation.

## Large content
Never exceed 80 lines in a single tool call parameter.
For large files, use multiple Bash heredoc calls.
If a tool call fails with a JSON parse error, split and retry smaller.
