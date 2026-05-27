"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { TemplateId, TrackId, AspectRatio } from "@/lib/renderVideo";
// Static import: primeAudio() MUST run synchronously inside the user
// gesture or iOS Safari refuses to authorise the AudioContext. A dynamic
// import would push it across at least one microtask boundary and risk
// iOS marking the gesture stale before resume() actually fires.
import { primeAudio } from "@/lib/auntieMusic";

// Web Share API isn't on every browser's lib.dom; declare the minimal shape
// we actually call so the share button compiles cleanly.
type NavigatorShareCapable = Navigator & {
  canShare?: (data: { files?: File[] }) => boolean;
  share?: (data: { files?: File[]; title?: string; text?: string }) => Promise<void>;
};

// Programmatic download fallback for browsers without the Web Share API.
// Uses the anchor-click pattern because some browsers ignore window.open for
// blob URLs.
function triggerDownload(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

type Stage = "idle" | "removing" | "rendering" | "done";

type VariantEntry = { url: string; ext: "mp4" | "webm"; hasAudio: boolean };

// Each cached blob URL pins a ~3-5 MB encoded video in memory. Twelve of those
// approach iOS Safari's per-tab budget on older iPhones — devices with low
// deviceMemory get killed mid-render. Cap lower on those devices; we only
// ever pre-render 5 extras, so 8 covers the realistic working set.
function variantCacheCap(): number {
  if (typeof navigator !== "undefined") {
    const memGB = (navigator as Navigator & { deviceMemory?: number })
      .deviceMemory;
    if (typeof memGB === "number" && memGB > 0 && memGB <= 2) return 4;
  }
  return 8;
}

// Evicts the oldest cache entry while skipping both the entry just added and
// the URL currently displayed on screen. Without that double exception the
// active <video src> can be revoked from under us, breaking the preview.
function evictOldest(
  cache: Map<string, VariantEntry>,
  justAddedKey: string,
  displayedUrl: string | null,
  max = variantCacheCap(),
) {
  while (cache.size > max) {
    let evictedOne = false;
    for (const oldestKey of cache.keys()) {
      if (oldestKey === justAddedKey) continue;
      const entry = cache.get(oldestKey)!;
      if (entry.url === displayedUrl) continue;
      URL.revokeObjectURL(entry.url);
      cache.delete(oldestKey);
      evictedOne = true;
      break;
    }
    // Safety: every remaining key is protected → stop trying.
    if (!evictedOne) return;
  }
}

const TEMPLATES: {
  id: TemplateId;
  label: string;
  gradient: string;
}[] = [
  {
    id: "gold-mosque",
    label: "Gold",
    gradient: "linear-gradient(135deg, #0E3D2C 0%, #D4AF37 60%, #FFE38A 100%)",
  },
  {
    id: "rose-garden",
    label: "Rose",
    gradient: "linear-gradient(135deg, #5A1336 0%, #E73C7E 60%, #FFE2EC 100%)",
  },
  {
    id: "starry-night",
    label: "Night",
    gradient: "linear-gradient(135deg, #0A1A3A 0%, #9B8FE0 60%, #FFFFFF 100%)",
  },
];

const TRACKS: { id: TrackId; label: string }[] = [
  { id: "mere-aaqa", label: "Mere Aaqa" },
  { id: "mubarak-eid", label: "Mubarak Eid" },
];

const ASPECTS: {
  id: AspectRatio;
  label: string;
  sub: string;
  w: number;
  h: number;
}[] = [
  { id: "9:16", label: "Story", sub: "9:16", w: 13, h: 23 },
  { id: "4:5", label: "Post", sub: "4:5", w: 17, h: 21 },
  { id: "1:1", label: "Square", sub: "1:1", w: 20, h: 20 },
];

export default function Home() {
  const [stage, setStage] = useState<Stage>("idle");
  const [renderPct, setRenderPct] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoExt, setVideoExt] = useState<"mp4" | "webm">("mp4");
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [currentTemplate, setCurrentTemplate] =
    useState<TemplateId>("gold-mosque");
  const [currentTrack, setCurrentTrack] = useState<TrackId>("mere-aaqa");
  const [currentAspect, setCurrentAspect] = useState<AspectRatio>("9:16");
  const [isMuted, setIsMuted] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const subjectRef = useRef<ImageBitmap | null>(null);

  // Cache of previously rendered variants so back-and-forth switching is
  // instant. Keyed by `${template}|${track}|${aspect}`.
  const variantCacheRef = useRef<Map<string, VariantEntry>>(new Map());

  // Live mirror of the on-screen blob URL so the background pre-render queue
  // can read the latest value at eviction time (closures capture stale state).
  const currentDisplayedUrlRef = useRef<string | null>(null);

  // Track whether we've kicked off the background pre-render queue. Reset on
  // upload of a new photo.
  const preRenderStartedRef = useRef(false);

  // Track whether the currently displayed variant has audio.
  const [hasAudio, setHasAudio] = useState(true);

  // Synchronous claim flag for the encoder pipeline. Both the foreground
  // render path and the background pre-render queue must claim this before
  // touching MediaRecorder / AudioContext, and must wait if it's held.
  // Without that mutual exclusion two encoders can run at once and produce
  // glitchy output.
  const renderingRef = useRef(false);

  // Monotonic session id, bumped whenever the user resets or uploads a new
  // photo. In-flight renders capture the value at start and bail before
  // committing state if it no longer matches — prevents a late-arriving
  // render from snapping the UI back to a stale video after reset.
  const sessionRef = useRef(0);

  // Has the user explicitly unmuted at least once this session? On the first
  // unmute we restart from t=0 so they hear the intro; on later toggles we
  // leave currentTime alone so they don't get yanked back mid-watch.
  const firstUnmuteDoneRef = useRef(false);

  const variantKey = (
    t: TemplateId,
    k: TrackId,
    a: AspectRatio,
  ) => `${t}|${k}|${a}`;

  // The variant cache owns every blob URL. On component unmount, revoke them
  // all so we don't leak. We intentionally do NOT revoke on `videoUrl` change
  // — the URL set into state is always a reference to a cached entry, and
  // revoking it here would corrupt the cache the moment the user switches
  // variants.
  useEffect(() => {
    const cache = variantCacheRef.current;
    return () => {
      for (const v of cache.values()) URL.revokeObjectURL(v.url);
      cache.clear();
    };
  }, []);

  // Keep the live mirror of the displayed URL in sync.
  useEffect(() => {
    currentDisplayedUrlRef.current = videoUrl;
  }, [videoUrl]);

  const reset = () => {
    // Invalidate any in-flight renders so their late-arriving completions
    // can't snap state back to a stale video.
    sessionRef.current++;
    // Revoke every cached blob URL on reset (full session restart)
    for (const v of variantCacheRef.current.values()) {
      URL.revokeObjectURL(v.url);
    }
    variantCacheRef.current.clear();
    preRenderStartedRef.current = false;
    firstUnmuteDoneRef.current = false;
    setVideoUrl(null);
    setStage("idle");
    setRenderPct(0);
    setError(null);
    setIsMuted(true);
    setIsUpdating(false);
    setHasAudio(true);
    setCurrentTemplate("gold-mosque");
    setCurrentTrack("mere-aaqa");
    setCurrentAspect("9:16");
    subjectRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const renderVideo = useCallback(
    async (
      templateId: TemplateId,
      trackId: TrackId,
      aspect: AspectRatio,
      subject: ImageBitmap,
    ) => {
      const sessionAtStart = sessionRef.current;
      const key = variantKey(templateId, trackId, aspect);
      const cache = variantCacheRef.current;

      // Cache hit → instant swap, no re-render. Refresh LRU position so the
      // currently-displayed variant won't be evicted next.
      const cached = cache.get(key);
      if (cached) {
        if (sessionAtStart !== sessionRef.current) return;
        cache.delete(key);
        cache.set(key, cached);
        setVideoUrl(cached.url);
        setVideoExt(cached.ext);
        setHasAudio(cached.hasAudio);
        return;
      }

      // Wait for any other render (foreground OR pre-render) to release the
      // encoder, then atomically claim it. Single-threaded JS means the
      // check-and-set across these two lines is safe.
      while (renderingRef.current) {
        await new Promise((r) => setTimeout(r, 100));
        if (sessionAtStart !== sessionRef.current) return;
      }
      renderingRef.current = true;
      setRenderPct(0);

      try {
        const { generateAuntieVideo } = await import("@/lib/renderVideo");
        const { blob, ext, hasAudio: ha } = await generateAuntieVideo(
          subject,
          templateId,
          trackId,
          aspect,
          (pct) => setRenderPct(pct),
        );
        // Session check before we commit anything to state or the cache —
        // if the user reset / re-uploaded mid-render, drop this result on
        // the floor.
        if (sessionAtStart !== sessionRef.current) return;

        const url = URL.createObjectURL(blob);
        cache.set(key, { url, ext, hasAudio: ha });
        // Use the live mirror so eviction protects the truly-displayed URL,
        // not a stale closure-captured one.
        evictOldest(cache, key, currentDisplayedUrlRef.current);

        setVideoUrl(url);
        setVideoExt(ext);
        setHasAudio(ha);
        setStage("done");
      } finally {
        renderingRef.current = false;
      }
    },
    [],
  );

  // Background pre-render queue: after the first render, silently produce the
  // variants the user is most likely to try next. Pre-rendered variants live
  // in the cache so swapping to them is instant.
  useEffect(() => {
    if (
      stage !== "done" ||
      !subjectRef.current ||
      preRenderStartedRef.current
    )
      return;
    preRenderStartedRef.current = true;

    // Two-layer cancellation:
    //   - `signal` (AbortController) flows into generateAuntieVideo so we can
    //     halt the encoder + audio mid-render when the user resets.
    //   - `sessionAtStart` is a belt-and-suspenders check that lets the queue
    //     bail at await boundaries even before the abort listener fires.
    const controller = new AbortController();
    const { signal } = controller;
    const sessionAtStart = sessionRef.current;

    async function preRenderQueue() {
      // Brief delay so the initial result has a moment to settle.
      await new Promise((r) => setTimeout(r, 1500));
      if (signal.aborted || sessionAtStart !== sessionRef.current) return;

      const subject = subjectRef.current;
      if (!subject) return;

      const initialT = currentTemplate;
      const initialK = currentTrack;
      const initialA = currentAspect;

      // Priority: other styles (most visually impactful and most-clicked) →
      // other aspects (platform-driven) → other music (audio-only swap).
      const queue: {
        template: TemplateId;
        track: TrackId;
        aspect: AspectRatio;
      }[] = [];
      for (const t of [
        "gold-mosque",
        "rose-garden",
        "starry-night",
      ] as TemplateId[]) {
        if (t !== initialT)
          queue.push({ template: t, track: initialK, aspect: initialA });
      }
      for (const a of ["9:16", "4:5", "1:1"] as AspectRatio[]) {
        if (a !== initialA)
          queue.push({ template: initialT, track: initialK, aspect: a });
      }
      for (const k of ["mere-aaqa", "mubarak-eid"] as TrackId[]) {
        if (k !== initialK)
          queue.push({ template: initialT, track: k, aspect: initialA });
      }

      const { generateAuntieVideo } = await import("@/lib/renderVideo");

      for (const item of queue) {
        if (signal.aborted || sessionAtStart !== sessionRef.current) return;
        // Yield to any foreground render — never compete for canvas/encoder
        // bandwidth at the same time, which is what causes glitchy output.
        while (renderingRef.current && !signal.aborted) {
          await new Promise((r) => setTimeout(r, 250));
          if (sessionAtStart !== sessionRef.current) return;
        }
        // Wait until the tab is visible before starting a new pre-render.
        // On iOS Safari, RAF throttles to ~0 while hidden, which makes the
        // encoder's wall-clock watchdog trip at 18s and emit a half-baked
        // variant into the cache. Far better to pause here.
        while (
          typeof document !== "undefined" &&
          document.visibilityState === "hidden" &&
          !signal.aborted
        ) {
          await new Promise((r) => setTimeout(r, 500));
          if (sessionAtStart !== sessionRef.current) return;
        }
        if (signal.aborted || sessionAtStart !== sessionRef.current) return;

        const key = variantKey(item.template, item.track, item.aspect);
        if (variantCacheRef.current.has(key)) continue;

        // Claim the encoder before any await so foreground clicks that
        // arrive while we're encoding will see the flag and wait.
        renderingRef.current = true;
        try {
          const { blob, ext, hasAudio: ha } = await generateAuntieVideo(
            subject,
            item.template,
            item.track,
            item.aspect,
            undefined,
            signal,
          );
          if (signal.aborted || sessionAtStart !== sessionRef.current) continue;
          const url = URL.createObjectURL(blob);
          variantCacheRef.current.set(key, { url, ext, hasAudio: ha });
          evictOldest(
            variantCacheRef.current,
            key,
            currentDisplayedUrlRef.current,
          );
        } catch (e) {
          if ((e as Error)?.name === "AbortError") return;
          console.warn("[auntifyeid] pre-render failed:", e);
        } finally {
          renderingRef.current = false;
        }
      }
    }

    preRenderQueue();

    return () => {
      // Aborts the in-flight pre-render (recorder + audio + frame loop) so
      // we don't keep grinding the encoder after the user resets, uploads a
      // new photo, or navigates away.
      controller.abort();
    };
    // We intentionally depend ONLY on `stage` so the queue isn't cancelled
    // when the user switches a setting mid-pre-render. The initial values are
    // captured inside preRenderQueue from the closure at first invocation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const handleFile = useCallback(
    async (file: File) => {
      // iPhone Safari reports HEIC as either image/heic or sometimes blank.
      // Accept both "image/*" and an empty type (Safari Files app quirk).
      const isImage =
        file.type === "" ||
        file.type.startsWith("image/") ||
        /\.(jpe?g|png|heic|heif|webp|gif)$/i.test(file.name);
      if (!isImage) {
        setError("Please upload an image (JPG, PNG, or HEIC).");
        return;
      }
      // 40 MB ceiling to accommodate iPhone HEIC (up to ~10MB) and large
      // ProRAW exports. We downscale before bg-removal so this is purely a
      // network/decode-time guard, not a memory one.
      if (file.size > 40 * 1024 * 1024) {
        setError("That image is too large. Try one under 40 MB.");
        return;
      }

      // Warm the AudioContext on this user gesture. iOS Safari requires a
      // live gesture to authorise audio; if we wait until later (after the
      // bg-removal awaits) iOS marks the context as untrusted and the
      // muxed audio track produces no samples — which on some iOS builds
      // makes MediaRecorder never emit a single chunk. SYNCHRONOUS call —
      // no awaits between this and the gesture or iOS may invalidate it.
      try { primeAudio(); } catch { /* non-fatal */ }

      // New upload = new session. Any prior in-flight render's result will
      // be discarded by its session check at commit time.
      sessionRef.current++;
      const sessionAtStart = sessionRef.current;
      setError(null);
      setRenderPct(0);
      setStage("removing");
      try {
        const { cutOutSubject } = await import("@/lib/removeBg");
        // No onProgress callback: the WorkingView shows an indeterminate
        // spinner for the entire "removing" stage, so the per-phase numbers
        // the library emits would just churn state for nothing.
        const subject = await cutOutSubject(file);
        if (sessionAtStart !== sessionRef.current) return;
        subjectRef.current = subject;
        setRenderPct(0);
        setStage("rendering");
        await renderVideo("gold-mosque", "mere-aaqa", "9:16", subject);
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return;
        if (sessionAtStart !== sessionRef.current) return;
        console.error(e);
        const msg =
          e instanceof Error
            ? e.message.toLowerCase().includes("decode") ||
              e.message.toLowerCase().includes("image")
              ? "Couldn't read that image. Try a JPG or PNG."
              : e.message
            : "Something went wrong. Try a different photo.";
        setError(msg);
        setStage("idle");
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [renderVideo],
  );

  const handleSwitch = useCallback(
    async (changes: {
      template?: TemplateId;
      track?: TrackId;
      aspect?: AspectRatio;
    }) => {
      if (!subjectRef.current || stage !== "done") return;
      const nextT = changes.template ?? currentTemplate;
      const nextK = changes.track ?? currentTrack;
      const nextA = changes.aspect ?? currentAspect;
      if (
        nextT === currentTemplate &&
        nextK === currentTrack &&
        nextA === currentAspect
      )
        return;

      // Resume the AudioContext inside this fresh chip-click gesture — iOS
      // can auto-suspend between renders and only a gesture lets us bring
      // it back. SYNCHRONOUS — no awaits between this and the click or iOS
      // may treat the gesture as stale.
      try { primeAudio(); } catch { /* non-fatal */ }

      // Capture pre-update selection so we can revert on failure.
      const prevT = currentTemplate;
      const prevK = currentTrack;
      const prevA = currentAspect;
      const sessionAtStart = sessionRef.current;

      // Immediately reflect the user's choice in the chip UI and disable
      // further clicks — the click should feel acted-on even before the
      // encoder starts work. Clear any stale error from a previous failure
      // since this is effectively a retry.
      setIsUpdating(true);
      setError(null);
      setCurrentTemplate(nextT);
      setCurrentTrack(nextK);
      setCurrentAspect(nextA);

      try {
        await renderVideo(nextT, nextK, nextA, subjectRef.current);
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return;
        if (sessionAtStart !== sessionRef.current) return;
        console.error(e);
        setCurrentTemplate(prevT);
        setCurrentTrack(prevK);
        setCurrentAspect(prevA);
        setError(
          e instanceof Error ? e.message : "Couldn't update. Try again.",
        );
      } finally {
        if (sessionAtStart === sessionRef.current) {
          setIsUpdating(false);
        }
      }
    },
    [stage, currentTemplate, currentTrack, currentAspect, renderVideo],
  );

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    const willBeMuted = !v.muted;
    v.muted = willBeMuted;
    // On the very first unmute of the session, rewind so the user hears the
    // music from the intro. On subsequent toggles, leave currentTime alone
    // so a mid-watch mute → unmute doesn't yank them back to the start.
    if (!willBeMuted && !firstUnmuteDoneRef.current) {
      firstUnmuteDoneRef.current = true;
      v.currentTime = 0;
      v.play().catch(() => {});
    }
    setIsMuted(willBeMuted);
  };

  return (
    <main className="relative min-h-dvh lg:h-dvh flex flex-col overflow-x-hidden">
      <header className="relative z-10 shrink-0 px-5 lg:px-10 pt-5 lg:pt-7 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CrescentMark />
          <span className="text-[13px] lg:text-sm tracking-[0.04em] text-[var(--ink-soft)] font-medium">
            auntifyeid
          </span>
        </div>
        {stage === "done" && (
          <button
            onClick={reset}
            className="text-[12px] lg:text-[13px] text-[var(--muted)] hover:text-[var(--ink)] transition-colors flex items-center gap-1.5"
          >
            <NewIcon />
            New photo
          </button>
        )}
      </header>

      <section className="relative z-10 flex-1 lg:min-h-0 flex items-center justify-center px-4 lg:px-10 py-4 lg:py-6">
        {stage === "idle" && (
          <IdleView
            dragOver={dragOver}
            setDragOver={setDragOver}
            fileInputRef={fileInputRef}
            onFile={handleFile}
            error={error}
          />
        )}

        {(stage === "removing" || (stage === "rendering" && !videoUrl)) && (
          <WorkingView stage={stage} renderPct={renderPct} />
        )}

        {stage === "done" && videoUrl && (
          <DoneView
            videoRef={videoRef}
            videoUrl={videoUrl}
            videoExt={videoExt}
            isMuted={isMuted}
            onToggleMute={toggleMute}
            isUpdating={isUpdating}
            renderPct={renderPct}
            hasAudio={hasAudio}
            currentTemplate={currentTemplate}
            currentTrack={currentTrack}
            currentAspect={currentAspect}
            onSwitch={handleSwitch}
            error={error}
          />
        )}
      </section>

      <footer className="relative z-10 shrink-0 px-5 lg:px-10 pb-3 lg:pb-5 text-center lg:text-left text-[10px] lg:text-[11px] text-[var(--muted)] tracking-[0.04em]">
        Auntify Eid © Zakaria Kortam
      </footer>
    </main>
  );
}

/* ---------- Idle ---------- */

function IdleView({
  dragOver,
  setDragOver,
  fileInputRef,
  onFile,
  error,
}: {
  dragOver: boolean;
  setDragOver: (v: boolean) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFile: (f: File) => void;
  error: string | null;
}) {
  return (
    <div className="w-full max-w-[520px] flex flex-col items-center text-center gap-8 lg:gap-12">
      <h1 className="text-[36px] sm:text-[44px] lg:text-[52px] leading-[1.04] tracking-[-0.02em] font-medium px-2">
        Make your
        <br />
        <span
          className="text-[var(--emerald)]"
          style={{
            fontFamily: "'Cinzel', Georgia, serif",
            fontStyle: "italic",
            fontWeight: 600,
            letterSpacing: "-0.005em",
          }}
        >
          auntie Eid video.
        </span>
      </h1>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files[0];
          if (f) onFile(f);
        }}
        className={`group relative w-full aspect-[5/3] rounded-[22px] border border-dashed transition-all cursor-pointer flex flex-col items-center justify-center gap-2.5 overflow-hidden ${
          dragOver
            ? "border-[var(--emerald)] bg-[var(--emerald)]/[0.05] scale-[1.005]"
            : "border-[var(--hair-strong)] hover:border-[var(--emerald)]/55 hover:bg-[var(--emerald)]/[0.022]"
        }`}
      >
        <div
          aria-hidden
          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 60% 60% at 50% 50%, rgba(197,165,114,0.10), transparent 70%)",
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          // Explicit HEIC/HEIF in the accept list — iPhone Safari otherwise
          // greys out HEIC photos in the picker on some iOS versions.
          accept="image/*,image/heic,image/heif,.heic,.heif"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
          }}
        />
        <UploadIcon />
        <span className="text-[15px] sm:text-base text-[var(--ink)] font-medium">
          Drop a photo of yourself
        </span>
        <span className="text-[13px] text-[var(--muted)]">
          or tap to upload
        </span>
      </label>

      {error && <p className="text-sm text-red-700 -mt-2">{error}</p>}
    </div>
  );
}

/* ---------- Working ---------- */

function WorkingView({
  stage,
  renderPct,
}: {
  stage: "removing" | "rendering";
  renderPct: number;
}) {
  // Background removal phase emits per-file/per-step progress that doesn't
  // map cleanly to a single bar — the model fetches multiple files in
  // parallel then runs four discrete compute steps, so any number we'd show
  // is more confusing than helpful. Force a clean spinner with no % for
  // "removing". Rendering still shows the determinate bar because the
  // encoder reports smooth wall-clock progress.
  const indeterminate = stage === "removing" || renderPct === 0;
  return (
    <div className="flex flex-col items-center text-center gap-7">
      <ProgressRing pct={renderPct} indeterminate={indeterminate} size={140} />
      <p className="text-[15px] sm:text-base text-[var(--ink)] font-medium">
        {stage === "removing" ? "Removing background" : "Generating your video"}
      </p>
    </div>
  );
}

/* ---------- Done (two-column on desktop, stacked on mobile) ---------- */

function DoneView({
  videoRef,
  videoUrl,
  videoExt,
  isMuted,
  onToggleMute,
  isUpdating,
  renderPct,
  hasAudio,
  currentTemplate,
  currentTrack,
  currentAspect,
  onSwitch,
  error,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoUrl: string;
  videoExt: "mp4" | "webm";
  isMuted: boolean;
  onToggleMute: () => void;
  isUpdating: boolean;
  renderPct: number;
  hasAudio: boolean;
  currentTemplate: TemplateId;
  currentTrack: TrackId;
  currentAspect: AspectRatio;
  onSwitch: (changes: {
    template?: TemplateId;
    track?: TrackId;
    aspect?: AspectRatio;
  }) => void;
  error: string | null;
}) {
  // When `key={videoUrl}` remounts the <video>, iOS Safari loses any "user
  // authorised audio" gesture state from a previous unmute. If we don't kick
  // the new element with an explicit play() inside the same React commit, the
  // user sees a still frame after every variant swap. Try unmuted first,
  // then fall back to muted+play so we always end up with motion on screen.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let cancelled = false;
    const attempt = async () => {
      try {
        await v.play();
      } catch {
        if (cancelled) return;
        // Unmuted autoplay blocked. Mute and try again — at least the
        // animation runs. The mute-toggle button stays available for the
        // user to bring audio back.
        try {
          v.muted = true;
          await v.play();
        } catch {
          /* give up silently — element will play on next user interaction */
        }
      }
    };
    attempt();
    return () => {
      cancelled = true;
    };
  }, [videoUrl, videoRef]);

  // Web Share API path. On iOS Safari the <a download> attribute is ignored —
  // tapping it just navigates to the blob URL, which opens the video inline
  // with no path to Save to Photos. navigator.share({ files }) hands the file
  // to the system share sheet, where "Save Video" is a one-tap save.
  const [sharing, setSharing] = useState(false);
  const [shareSupported, setShareSupported] = useState(false);
  useEffect(() => {
    // Post-mount capability detection: SSR can't see navigator and the share
    // button needs to re-render once we know whether files can be shared.
    // We compute first, then set once at the end; the functional-setter form
    // returns the existing value when nothing changed so React skips the
    // cascading re-render that the set-state-in-effect lint rule guards
    // against.
    let supported = false;
    if (typeof navigator !== "undefined") {
      const nav = navigator as NavigatorShareCapable;
      // typeof checks (not truthy) because lib.dom types navigator.share as a
      // required function even on browsers that don't actually expose it.
      if (
        typeof nav.share === "function" &&
        typeof nav.canShare === "function"
      ) {
        try {
          const probe = new File([new Blob([""])], `probe.${videoExt}`, {
            type: videoExt === "mp4" ? "video/mp4" : "video/webm",
          });
          supported = nav.canShare({ files: [probe] });
        } catch {
          supported = false;
        }
      }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot capability detection on mount; functional setter no-ops if value unchanged
    setShareSupported((prev) => (prev === supported ? prev : supported));
  }, [videoExt]);

  const handleShare = useCallback(async () => {
    if (isUpdating || sharing) return;
    const nav = navigator as NavigatorShareCapable;
    if (typeof nav.share !== "function") return;
    setSharing(true);
    try {
      const resp = await fetch(videoUrl);
      const blob = await resp.blob();
      const type = blob.type || (videoExt === "mp4" ? "video/mp4" : "video/webm");
      const file = new File([blob], `auntifyeid.${videoExt}`, { type });
      if (nav.canShare && !nav.canShare({ files: [file] })) {
        // share() would reject — fall back to triggering a download click.
        triggerDownload(videoUrl, `auntifyeid.${videoExt}`);
        return;
      }
      await nav.share({
        files: [file],
        title: "auntifyeid",
        text: "My auntie Eid video",
      });
    } catch (e) {
      // AbortError = user dismissed the sheet — that's fine, just stop.
      if ((e as Error)?.name !== "AbortError") {
        triggerDownload(videoUrl, `auntifyeid.${videoExt}`);
      }
    } finally {
      setSharing(false);
    }
  }, [videoUrl, videoExt, isUpdating, sharing]);

  return (
    <div className="w-full max-w-[1140px] h-full lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-10 lg:items-center flex flex-col gap-4">
      {/* video */}
      <div className="flex-1 min-h-0 flex items-center justify-center lg:justify-end w-full">
        <div className="relative inline-block max-h-full">
          <video
            ref={videoRef}
            key={videoUrl}
            src={videoUrl}
            autoPlay
            loop
            // Force-mute while the update overlay covers the video — without
            // this, an unmuted user keeps hearing audio over a blurred frame.
            muted={isMuted || isUpdating}
            playsInline
            className="block max-h-[min(62dvh,720px)] lg:max-h-[min(80dvh,900px)] max-w-full rounded-[18px] shadow-[0_24px_60px_-24px_rgba(0,0,0,0.45)]"
          />
          {hasAudio && (
            <button
              onClick={onToggleMute}
              aria-label={isMuted ? "Unmute" : "Mute"}
              className="absolute bottom-3 right-3 w-10 h-10 rounded-full bg-black/55 backdrop-blur-sm text-white flex items-center justify-center hover:bg-black/70 transition-colors"
            >
              {isMuted ? <MutedIcon /> : <UnmutedIcon />}
            </button>
          )}
          {hasAudio && isMuted && !isUpdating && (
            <button
              onClick={onToggleMute}
              aria-label="Tap to hear"
              className="absolute bottom-3 left-3 px-3 py-1.5 rounded-full bg-black/55 backdrop-blur-sm text-white text-[11px] tracking-wide animate-pulse-soft"
            >
              tap to hear
            </button>
          )}
          {!hasAudio && !isUpdating && (
            <div
              className="absolute bottom-3 left-3 px-3 py-1.5 rounded-full bg-black/55 backdrop-blur-sm text-white text-[11px] tracking-wide flex items-center gap-1.5"
              title="Music file couldn't be loaded — video is silent. See public/music/README.md for deploy options."
            >
              <MutedIcon />
              silent
            </div>
          )}
          {isUpdating && (
            <div className="absolute inset-0 rounded-[18px] bg-black/45 backdrop-blur-[3px] flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <ProgressRing
                  pct={renderPct}
                  indeterminate={false}
                  size={72}
                  light
                />
                <span className="text-white text-[12px] tracking-wide font-medium">
                  Updating · {Math.round(renderPct * 100)}%
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* controls */}
      <div className="w-full lg:max-w-[400px] flex flex-col gap-4 lg:gap-5 lg:py-6">
        <div className="hidden lg:block">
          <h2 className="text-[19px] font-medium tracking-[-0.01em] text-[var(--ink)]">
            Your auntie Eid video
          </h2>
          <p className="text-[13px] text-[var(--muted)] mt-1">
            Pick a shape, a vibe, a soundtrack.
          </p>
        </div>

        <PickerSection label="Shape">
          <div className="grid grid-cols-3 gap-2">
            {ASPECTS.map((a) => {
              const selected = a.id === currentAspect;
              return (
                <ControlChip
                  key={a.id}
                  selected={selected}
                  disabled={isUpdating}
                  onClick={() => onSwitch({ aspect: a.id })}
                >
                  <AspectFrame w={a.w} h={a.h} active={selected} />
                  <div className="flex flex-col items-center gap-0">
                    <span className="text-[12px] font-medium">{a.label}</span>
                    <span className="text-[10px] text-[var(--muted)]">
                      {a.sub}
                    </span>
                  </div>
                </ControlChip>
              );
            })}
          </div>
        </PickerSection>

        <PickerSection label="Style">
          <div className="grid grid-cols-3 gap-2">
            {TEMPLATES.map((tpl) => {
              const selected = tpl.id === currentTemplate;
              return (
                <ControlChip
                  key={tpl.id}
                  selected={selected}
                  disabled={isUpdating}
                  onClick={() => onSwitch({ template: tpl.id })}
                >
                  <div
                    className="w-9 h-9 rounded-full ring-1 ring-black/10"
                    style={{ background: tpl.gradient }}
                  />
                  <span className="text-[12px] font-medium">{tpl.label}</span>
                </ControlChip>
              );
            })}
          </div>
        </PickerSection>

        <PickerSection label="Music">
          <div className="grid grid-cols-2 gap-2">
            {TRACKS.map((tk) => {
              const selected = tk.id === currentTrack;
              return (
                <ControlChip
                  key={tk.id}
                  selected={selected}
                  disabled={isUpdating}
                  onClick={() => onSwitch({ track: tk.id })}
                  horizontal
                >
                  <NoteIcon
                    className={
                      selected
                        ? "text-[var(--emerald)]"
                        : "text-[var(--muted)]"
                    }
                  />
                  <span className="text-[13px] font-medium">{tk.label}</span>
                </ControlChip>
              );
            })}
          </div>
        </PickerSection>

        {error && (
          <p className="text-[12px] text-red-700">{error}</p>
        )}

        <div className="flex flex-col gap-2 pt-1">
          {shareSupported ? (
            <button
              type="button"
              onClick={handleShare}
              disabled={isUpdating || sharing}
              className={`text-center bg-[var(--emerald)] hover:bg-[var(--emerald-hover)] text-white font-medium py-3.5 rounded-xl transition-all flex items-center justify-center gap-2.5 shadow-[0_8px_24px_-8px_rgba(15,81,50,0.55)] ${
                isUpdating || sharing ? "opacity-60 cursor-not-allowed" : ""
              }`}
            >
              <DownloadIcon />
              <span>
                {sharing ? "Preparing…" : `Save ${videoExt.toUpperCase()}`}
              </span>
            </button>
          ) : (
            <a
              href={isUpdating ? undefined : videoUrl}
              download={`auntifyeid.${videoExt}`}
              aria-disabled={isUpdating}
              onClick={(e) => {
                if (isUpdating) e.preventDefault();
              }}
              className={`text-center bg-[var(--emerald)] hover:bg-[var(--emerald-hover)] text-white font-medium py-3.5 rounded-xl transition-all flex items-center justify-center gap-2.5 shadow-[0_8px_24px_-8px_rgba(15,81,50,0.55)] ${
                isUpdating ? "opacity-60 cursor-not-allowed" : ""
              }`}
            >
              <DownloadIcon />
              <span>Download {videoExt.toUpperCase()}</span>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- Picker primitives ---------- */

function PickerSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <span className="text-[10.5px] font-semibold tracking-[0.1em] uppercase text-[var(--muted)]">
          {label}
        </span>
      </div>
      {children}
    </div>
  );
}

function ControlChip({
  selected,
  disabled,
  onClick,
  horizontal,
  children,
}: {
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
  horizontal?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${
        horizontal
          ? "flex flex-row items-center justify-center gap-2 py-3"
          : "flex flex-col items-center justify-center gap-1.5 py-2.5"
      } px-2 rounded-[14px] border transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
        selected
          ? "border-[var(--emerald)] bg-[var(--emerald)]/[0.06] text-[var(--ink)]"
          : "border-[var(--hair)] hover:border-[var(--emerald)]/40 hover:bg-black/[0.015] text-[var(--ink-soft)] active:scale-[0.99]"
      }`}
    >
      {children}
    </button>
  );
}

function AspectFrame({
  w,
  h,
  active,
}: {
  w: number;
  h: number;
  active: boolean;
}) {
  return (
    <div className="h-7 flex items-center justify-center">
      <div
        className={`rounded-[3px] border-2 ${
          active ? "border-[var(--emerald)]" : "border-current/55"
        }`}
        style={{ width: `${w}px`, height: `${h}px` }}
      />
    </div>
  );
}

/* ---------- Progress ring ---------- */

function ProgressRing({
  pct,
  indeterminate,
  size = 140,
  light = false,
}: {
  pct: number;
  indeterminate: boolean;
  size?: number;
  light?: boolean;
}) {
  const STROKE = Math.max(4, Math.round(size * 0.058));
  const R = (size - STROKE) / 2;
  // pathLength={100} normalizes the circle to length 100, so dasharray
  // values are LITERALLY the percentage. "38 100" = 38% dash, 100% gap,
  // ring renders exactly 38% — no transcendental math, no transition lag.
  const portion = indeterminate ? 22 : Math.max(0.5, Math.min(100, pct * 100));
  const trackColor = light ? "rgba(255,255,255,0.25)" : "var(--hair-strong)";
  const arcColor = light ? "white" : "var(--emerald)";

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <div
        className={
          indeterminate
            ? "absolute inset-0 animate-spin [animation-duration:1.1s]"
            : "absolute inset-0"
        }
      >
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          aria-hidden
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={R}
            fill="none"
            stroke={trackColor}
            strokeWidth={STROKE}
            opacity={light ? 1 : 0.6}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={R}
            fill="none"
            stroke={arcColor}
            strokeWidth={STROKE}
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${portion} 100`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </svg>
      </div>
      {!indeterminate && size >= 80 && (
        <div
          className={`absolute inset-0 flex items-center justify-center font-medium tracking-[-0.01em] tabular-nums ${
            light ? "text-white" : "text-[var(--ink)]"
          }`}
          style={{ fontSize: size * 0.2, lineHeight: 1 }}
          aria-live="polite"
        >
          {Math.round(pct * 100)}%
        </div>
      )}
    </div>
  );
}

/* ---------- Icons ---------- */

function CrescentMark() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      className="text-[var(--gold)]"
      aria-hidden
    >
      <defs>
        <linearGradient id="cgrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFD86A" />
          <stop offset="100%" stopColor="#8B6914" />
        </linearGradient>
      </defs>
      <path
        d="M16.8 4.5 a8.5 8.5 0 1 0 0 15 6.5 6.5 0 1 1 0 -15 z"
        fill="url(#cgrad)"
      />
    </svg>
  );
}

function UploadIcon() {
  return (
    <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-[var(--cream-warm)] flex items-center justify-center mb-1 ring-1 ring-[var(--hair-strong)]">
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-[var(--ink-soft)]"
        aria-hidden
      >
        <path d="M12 16V4" />
        <path d="m7 9 5-5 5 5" />
        <path d="M20 16v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-3" />
      </svg>
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 4v12" />
      <path d="m7 11 5 5 5-5" />
      <path d="M20 20H4" />
    </svg>
  );
}

function NewIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function NoteIcon({ className }: { className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M9 18V5l12-2v13" />
      <circle cx="6" cy="18" r="3" />
      <circle cx="18" cy="16" r="3" />
    </svg>
  );
}

function MutedIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M11 5 6 9H2v6h4l5 4z" />
      <line x1="22" y1="9" x2="16" y2="15" />
      <line x1="16" y1="9" x2="22" y2="15" />
    </svg>
  );
}

function UnmutedIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M11 5 6 9H2v6h4l5 4z" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}
