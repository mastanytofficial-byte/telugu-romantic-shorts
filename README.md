# Telugu Wisdom Shorts

Automated Telugu life-wisdom/motivational quote YouTube Shorts generator.

Each run generates one original Tenglish wisdom quote (Groq LLM), a matching
AI image, an original instrumental BGM, and renders/uploads a 9:16 video.

**Human review gate:** videos upload as **Private**. Nothing goes public
automatically — check the quote/image/audio in YouTube Studio and switch
visibility to Public yourself before it is live. The generator prints a
review link (and writes `work/review.txt`) after every run.

## Required GitHub Actions secrets

- `GROQ_API_KEY`
- `YT_CLIENT_ID`
- `YT_CLIENT_SECRET`
- `YT_REFRESH_TOKEN`

These must belong to the YouTube channel/Google account this repo publishes
to.