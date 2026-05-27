# Audio assets

The app expects two files at runtime:

- `mere-aaqa.mp3`
- `mubarak-eid.mp3`

By default they're loaded from `/music/<file>.mp3` on the same origin as
the deployed app. You can override the base URL by setting
`NEXT_PUBLIC_AUDIO_BASE_URL` at build time
(e.g. `https://cdn.example.com/eid`).

These files are excluded from version control via `.gitignore` so the repo
itself does not redistribute third-party recordings. That means a fresh
deployment ships **without audio** unless you do one of the two things
below.

If audio is missing on a deploy, the app still works — the renderer falls
back to a silent audio track and the result video shows a small `silent`
badge in the preview so the user knows why.

## Option A — bundle the files with the deploy (private repo)

If your hosting target is private (or you accept the redistribution risk),
remove the `/public/music/*.mp3` line from `.gitignore`, then:

```
git add public/music/mere-aaqa.mp3 public/music/mubarak-eid.mp3
git commit -m "Bundle audio assets"
git push
```

Next.js will serve these as static assets at `/music/<file>.mp3`.

## Option B — host on a CDN (recommended for public repos)

1. Upload both files to a CDN of your choice (Cloudflare R2, AWS S3 +
   CloudFront, Bunny, etc.). Make sure CORS is configured to allow your
   deployed origin.
2. Set the env var at build/deploy time:

   ```
   NEXT_PUBLIC_AUDIO_BASE_URL=https://cdn.example.com/eid
   ```

   On Vercel, this goes in **Project Settings → Environment Variables**.

3. Trigger a rebuild. The app will now fetch from
   `${NEXT_PUBLIC_AUDIO_BASE_URL}/mere-aaqa.mp3` etc.

## Option C — swap in royalty-free Eid tracks

If the original tracks are commercial recordings and you want full
clearance to redistribute, replace them with licensed or
public-domain alternatives, keeping the same filenames.
