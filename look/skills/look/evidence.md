# What vision models can judge from pictures

Research evidence behind the look skill's rules. Each finding names its source.

## Image input to Claude

- Current Claude models see an image at up to 2,576 px on its long edge (about 4,800 visual tokens); a larger image is scaled down. One visual token is a 28 × 28 px patch. A 1280 × 720 capture therefore carries about a third of the detail the model can take in. [Claude vision docs]
- Claude works best with the images before the text, each introduced by a label such as "Image 1:". [Claude vision docs]
- Anthropic names spatial positions, coordinates and counts of many small objects as approximate, and images under 200 px or of low quality as a cause of hallucination. [Claude vision docs]

## Leading questions and repeated runs

- A question that states the expected answer raises agreement with it (visual sycophancy); rewriting the question neutrally lowers it. [Sycophancy in VLMs 2408.11261, snippet only]
- Majority voting over several runs gives modest gains, and only when the answers are fixed choices that can be compared exactly. [Critique 2608.01207, snippet only]

## Motion and timing from stills

- A grid of frames beats a single frame for questions about events: 6 frames in a 3 × 2 grid, filled row by row, was best among 4 to 20 frames, and near-square grids beat a single row or column. GPT-4V on ActivityNet-QA rose from 26.3 to 54.7. [IG-VLM]
- A number drawn on each frame helps a model place events in time (GPT-4o on ActivityNet grounding, 23.7 to 33.6 mIoU). [NumPro]
- Models often ignore frame order: shuffled or reversed frames barely change accuracy on most video benchmarks. On a test built to need order, Claude 3.5 Sonnet with 4 frames scored near chance. So a grid alone does not show direction or timing reliably. [Arrow of Time; Vinoground]
- Models read the direction of a single object's motion near chance, even from video. [Which Way Did It Move?]
- A path drawn over the frame, shown beside the clean frame, helps models with motion more than the same path described in text, and more than a stack of past frames, which made results worse. Time is drawn as a colour gradient along the path, with circles at events. This evidence comes from robot-control models trained on such traces, not from judges reading them cold. [TraceVLA; RT-Trajectory]
- No study tests how vision models read a ghosted composite, several translucent poses of one moving object over one background. Models undercount repeated similar objects, so the copies may read as several objects. Test it before relying on it. [counting papers, snippet only]
- On three motion moments from the author's own game playtests, judged against the player's words, no image kind matched in two of three cases: the trail and all three together matched once, the frame grid and the ghost never. On one, the looker contradicted the player (it saw one character on top of another, where the player saw it inside). [author's motion eval]

## What game screenshots reveal

- Animation and pose glitches are the hardest category to spot in game frames (GPT-4V 30.3%, against 41 to 46% for physics, rendering and camera glitches). Showing 3 frames around a glitch instead of 1 lowered accuracy. [GlitchBench]
- Matching a bug report to a frame works well for lighting, physics and UI (F1 0.83 to 0.94) and worst for animation and effects (F1 0.51). [Bug frame retrieval]
- Single-screenshot glitch detection reaches about 82% (GPT-4o), with a 17.8% false-positive rate; a model that found a glitch in 72 of 100 videos placed its frame in only 19. [VideoGameQA-Bench]
- Frame-based judges agree weakly with people on physical plausibility (correlations about 0.1 to 0.4). [VideoPhy-2]
- Studios that use vision models for QA treat them as a high-recall filter whose findings another check confirms. [Sony clipping study; bug frame retrieval]
