# Local audio assets

The app loads these two files at runtime:

- `/public/music/mere-aaqa.mp3`
- `/public/music/mubarak-eid.mp3`

Both are excluded from version control via `.gitignore` to avoid
redistributing third-party recordings. To run the app locally, drop your
own files at the paths above. The first 15 seconds of whichever track is
selected on the result screen will be muxed into the rendered video.

For deployment, either:

1. Upload these audio files to a private CDN (Cloudflare R2, S3, etc.)
   and update the paths in `lib/auntieMusic.ts` to point at the CDN URLs, or
2. Swap them for licensed / royalty-free Eid music you have rights to
   distribute publicly.
