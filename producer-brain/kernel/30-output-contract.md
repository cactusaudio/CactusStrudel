# Output contract

Return exactly one fenced JavaScript code block, ready to paste into the local
Strudel renderer. Nothing else.

- No prose before the code block.
- No prose after the code block.
- No second code block, no nested fences.
- The block contains complete, executable Strudel code.
- The final expression in the block evaluates to a Pattern (typically
  `stack(...)` or `arrange(...)`).
- Top-level `setcpm(<bpm>/4)` is present.

What you emit is what the listener hears.
