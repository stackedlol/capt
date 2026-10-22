```
      ▄▄██████████████▄▄
    ▄██▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓██▄
   ██▓▓▒░░░░░░░░░░░░░░▒▓▓██
   ██▓▒░              ░▒▓██
   ██▓▒░              ░▒▓██      c a p
   ██▓▒░              ░▒▓██
   ██▓▒░              ░▒▓██      open source screen recording
   ██▓▓▒░░░░░░░░░░░░░░▒▓▓██
    ▀██▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓██▀
      ▀▀██████████████▀▀
```

Record your screen, camera and mic. Share a link or export a video. Own your data.

- **Instant Mode** uploads while you record and hands you a link when you stop.
- **Studio Mode** records locally and opens an editor for backgrounds, zooms, trims and captions.
- **Sharing** with comments, transcripts, AI summaries and viewer analytics.
- **Storage** on Cap Cloud, your own S3 bucket, local disk, or fully self-hosted.

[Download](https://cap.so/download) · [Docs](https://cap.so/docs) · [Discord](https://cap.link/discord)

## Self-host

```bash
docker compose up -d   # http://localhost:3000
```

## Develop

```bash
bun install && bun run env-setup && bun run cap-setup
bun run dev
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Licensed AGPLv3, with `cap-camera*` and `scap-*` crates under [MIT](licenses/LICENSE-MIT).
