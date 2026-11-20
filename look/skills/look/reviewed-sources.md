# Reviewed sources for the look skill

## Use in the next round

Check this register before searching, and skip a row's page unless its version changed or a claim on it needs a targeted check. A row covers the page as its Scope column says; it does not cover the rest of that site.

The register is topic-level, not a browsing history. Search snippets and failed fetches are not rows. A citation here is research, not a runtime test of the looker.

## Official docs

| Source | Topic evidence | Reviewed | Scope |
| --- | --- | --- | --- |
| [Claude vision](https://platform.claude.com/docs/en/build-with-claude/vision) | [evidence.md](evidence.md) | 2026-11-15 | Agent-inspected, undated page covering models up to Claude 5.x. Adopted: resize tiers, token formula, images before text with labels, stated limitations. |

## Papers

| Source | Topic evidence | Reviewed | Scope |
| --- | --- | --- | --- |
| [IG-VLM: An Image Grid Can Be Worth a Video](https://arxiv.org/html/2403.18406v1) | [evidence.md](evidence.md) | 2026-11-15 | Agent-inspected HTML v1. Adopted: 3 × 2 grid, 6 frames, row-first order. Not compared with separate images. |
| [Number it: Temporal Grounding Videos like Flipping Manga (NumPro)](https://arxiv.org/html/2411.10332v3) | [evidence.md](evidence.md) | 2026-11-15 | Agent-inspected HTML v3. Adopted: frame numbers drawn on frames. Grounding tasks, not judging. |
| [Vinoground](https://arxiv.org/html/2410.02763v1) | [evidence.md](evidence.md) | 2026-11-15 | Agent-inspected HTML v1. Adopted: near-chance order reading for Claude 3.5 Sonnet at 4 frames; frame-count ablation for GPT-4o. |
| [Seeing the Arrow of Time in Large Multimodal Models](https://arxiv.org/html/2506.03340) | [evidence.md](evidence.md) | 2026-11-15 | Agent-inspected HTML. Adopted: shuffled and reversed frames barely change most scores. Open 7B models only. |
| [Which Way Did It Move?](https://arxiv.org/abs/2605.22823) | [evidence.md](evidence.md) | 2026-11-15 | Agent-inspected abstract. Adopted: direction of motion read near chance. Video models; numbers to check in the PDF. |
| [Time Blindness (SpookyBench)](https://arxiv.org/abs/2505.24867) | — | 2026-11-15 | Agent-inspected abstract. Not adopted: temporal noise patterns, far from game captures. |
| [TraceVLA](https://arxiv.org/html/2412.10345v3) | [evidence.md](evidence.md) | 2026-11-15 | Agent-inspected HTML v3. Adopted: drawn trace beside the clean frame beats text traces and stacked frames. Robot policy, trained on traces. |
| [RT-Trajectory](https://arxiv.org/html/2311.01977v2) | [evidence.md](evidence.md) | 2026-11-15 | Agent-inspected HTML v2. Adopted: time as a colour gradient, circles at events. Robot policy, trained on traces. |
| [Dynamic Image Networks](https://arxiv.org/abs/1612.00738) | — | 2026-11-15 | Agent-inspected abstract only. Not adopted: a trained CNN input, no VLM reading. |
| [Visual Chronicles](https://arxiv.org/html/2504.08727) | — | 2026-11-15 | Agent-inspected HTML. Not adopted: MLLMs handle sorted image sequences for change detection, but no difference-image comparison. |
| [GlitchBench](https://arxiv.org/html/2312.05291v2) | [evidence.md](evidence.md) | 2026-11-15 | Agent-inspected HTML v2. Adopted: animation and pose hardest; 3 frames lowered accuracy. GPT-4V era. |
| [PhysGame](https://arxiv.org/abs/2412.01800) | — | 2026-11-15 | Agent-inspected abstract. Not adopted: no per-model numbers on the page. |
| [VideoGameQA-Bench](https://arxiv.org/html/2505.15952v1) | [evidence.md](evidence.md) | 2026-11-15 | Agent-inspected HTML v1. Adopted: screenshot glitch detection and false-positive rate; poor frame localization. |
| [Keyframe glitch detection in industry](https://arxiv.org/html/2603.22706v1) | — | 2026-11-15 | Agent-inspected HTML v1. Not adopted: one-labeller keyframe study; motion bugs left as future work. |
| [Automated bug frame retrieval](https://arxiv.org/html/2508.04895v1) | [evidence.md](evidence.md) | 2026-11-15 | Agent-inspected HTML v1. Adopted: per-category F1, animation lowest. One FPS game. |
| [Sony VLM clipping study](https://www.alphaxiv.org/abs/2607.25921) | [evidence.md](evidence.md) | 2026-11-15 | Agent-inspected abstract page. Adopted: VLMs as high-recall filters. No numbers on the page. |
| [VideoPhy-2](https://arxiv.org/html/2503.06800) | [evidence.md](evidence.md) | 2026-11-15 | Agent-inspected HTML. Adopted: weak judge–human correlation on physical plausibility. |
| [VideoPhy](https://arxiv.org/html/2406.03520v2) | — | 2026-11-15 | Agent-inspected HTML v2. Not adopted beyond VideoPhy-2's finding. |

## Industry write-ups

| Source | Topic evidence | Reviewed | Scope |
| --- | --- | --- | --- |
| [Razer QA Companion AI at GDC 2026](https://www.razer.com/blog/ai-that-plays-to-test-razer-qa-companion-ai-at-gdc-2026/) | — | 2026-11-15 | Agent-inspected vendor blog. Not adopted: claims without method or numbers. |
