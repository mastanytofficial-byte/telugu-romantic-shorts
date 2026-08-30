# Telugu Wisdom Shorts

Automated Telugu life-wisdom/motivational quote YouTube Shorts generator.

Each run generates one original quote in native Telugu script (Groq LLM), a
matching AI image, and renders/uploads a 9:16 video over a randomly picked
channel BGM (`assets/bgm-motivation.mp3` by leberch, or
`assets/bgm-climax-piano.mp3` by Clavier-Music — both royalty-free, Pixabay
Content License).

**Auto-publish:** videos upload directly as **Public**. No manual review step —
each run's video goes live immediately after upload. The generator still
prints a link (and writes `work/review.txt`) after every run so you can
check it, and you can always edit/unlist/delete it in YouTube Studio.

## Required GitHub Actions secrets

- `GROQ_API_KEY`
- `YT_CLIENT_ID`
- `YT_CLIENT_SECRET`
- `YT_REFRESH_TOKEN`

These must belong to the YouTube channel/Google account this repo publishes
to.
<!-- schedule resync 2026-08-28T05:43:55Z -->
