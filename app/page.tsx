"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { TemplateId, TrackId, AspectRatio } from "@/lib/renderVideo";

type Stage = "idle" | "removing" | "rendering" | "done";

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
  const [canShare, setCanShare] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const subjectRef = useRef<ImageBitmap | null>(null);

  // Cache of previously rendered variants so back-and-forth switching is
  // instant. Keyed by `${template}|${track}|${aspect}`.
  const variantCacheRef = useRef<
    Map<string, { url: string; ext: "mp4" | "webm"; hasAudio: boolean }>
  >(new Map());
  const VARIANT_CACHE_MAX = 12;

  // Track whether we've kicked off the background pre-render queue. Reset on
  // upload of a new photo.
  const preRenderStartedRef = useRef(false);

  // Track whether the currently displayed variant has audio.
  const [hasAudio, setHasAudio] = useState(true);

  // Guard against rapid-fire clicks producing concurrent renders. A ref so
  // the check is synchronous and not subject to React's state batching.
  const renderingRef = useRef(false);

  const variantKey = (
    t: TemplateId,
    k: TrackId,
    a: AspectRatio,
  ) => `${t}|${k}|${a}`;

  useEffect(() => {
    // Detect Web Share API availability after mount to avoid hydration mismatch.
    if (typeof navigator !== "undefined" && "share" in navigator) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCanShare(true);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  const reset = () => {
    // Revoke every cached blob URL on reset (full session restart)
    for (const v of variantCacheRef.current.values()) {
      URL.revokeObjectURL(v.url);
    }
    variantCacheRef.current.clear();
    preRenderStartedRef.current = false;
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
      const key = variantKey(templateId, trackId, aspect);
      const cache = variantCacheRef.current;

      // Cache hit → instant swap, no re-render. Refresh LRU position so the
      // currently-displayed variant won't be evicted next.
      const cached = cache.get(key);
      if (cached && stage === "done") {
        cache.delete(key);
        cache.set(key, cached);
        setVideoUrl(cached.url);
        setVideoExt(cached.ext);
        setHasAudio(cached.hasAudio);
        setCurrentTemplate(templateId);
        setCurrentTrack(trackId);
        setCurrentAspect(aspect);
        // Do NOT reset isMuted — preserve the user's audio preference
        // across edits. They already unmuted once, keep it that way.
        setIsUpdating(false);
        return;
      }

      // Concurrent-render guard: only ONE foreground render at a time.
      if (renderingRef.current) return;
      renderingRef.current = true;

      const isInitial = !videoUrl;
      if (isInitial) setStage("rendering");
      else setIsUpdating(true);
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
        const url = URL.createObjectURL(blob);

        // Cache and evict oldest entry that is NOT the one we just added.
        cache.set(key, { url, ext, hasAudio: ha });
        if (cache.size > VARIANT_CACHE_MAX) {
          for (const oldest of cache.keys()) {
            if (oldest !== key) {
              const evicted = cache.get(oldest);
              if (evicted) URL.revokeObjectURL(evicted.url);
              cache.delete(oldest);
              break;
            }
          }
        }

        setVideoUrl(url);
        setVideoExt(ext);
        setHasAudio(ha);
        setCurrentTemplate(templateId);
        setCurrentTrack(trackId);
        setCurrentAspect(aspect);
        // First render of a session leaves isMuted at its default (true).
        // Subsequent renders inherit whatever the user has chosen.
        setStage("done");
      } finally {
        renderingRef.current = false;
        setIsUpdating(false);
      }
    },
    [stage, videoUrl],
  );

  // Background pre-render queue: after the first render, silently produce the
  // other two aspect ratios and the other music track using current style.
  // Most common switches become instant.
  useEffect(() => {
    if (
      stage !== "done" ||
      !subjectRef.current ||
      preRenderStartedRef.current
    )
      return;
    preRenderStartedRef.current = true;

    let cancelled = false;

    async function preRenderQueue() {
      // Brief delay so the initial result has a moment to settle.
      await new Promise((r) => setTimeout(r, 1500));
      if (cancelled) return;

      const subject = subjectRef.current;
      if (!subject) return;

      const initialT = currentTemplate;
      const initialK = currentTrack;
      const initialA = currentAspect;

      const queue: {
        template: TemplateId;
        track: TrackId;
        aspect: AspectRatio;
      }[] = [];

      // Priority: other aspects > other music > other styles.
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
        if (cancelled) return;
        // Yield to any foreground render — never compete for canvas/encoder
        // bandwidth at the same time, which is what causes glitchy output.
        while (renderingRef.current && !cancelled) {
          await new Promise((r) => setTimeout(r, 250));
        }
        if (cancelled) return;

        const key = variantKey(item.template, item.track, item.aspect);
        if (variantCacheRef.current.has(key)) continue;

        try {
          const { blob, ext, hasAudio: ha } = await generateAuntieVideo(
            subject,
            item.template,
            item.track,
            item.aspect,
          );
          if (cancelled) {
            // Discard if user navigated away
            continue;
          }
          const url = URL.createObjectURL(blob);
          variantCacheRef.current.set(key, { url, ext, hasAudio: ha });
          if (variantCacheRef.current.size > VARIANT_CACHE_MAX) {
            const oldest = variantCacheRef.current.keys().next().value;
            if (oldest && oldest !== key) {
              const evicted = variantCacheRef.current.get(oldest);
              if (evicted) URL.revokeObjectURL(evicted.url);
              variantCacheRef.current.delete(oldest);
            }
          }
        } catch (e) {
          console.warn("[auntifyeid] pre-render failed:", e);
        }
      }
    }

    preRenderQueue();

    return () => {
      cancelled = true;
    };
    // We intentionally depend ONLY on `stage` so the queue isn't cancelled
    // when the user switches a setting mid-pre-render. The initial values are
    // captured inside preRenderQueue from the closure at first invocation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        setError("Please upload an image (JPG, PNG, or HEIC).");
        return;
      }
      if (file.size > 25 * 1024 * 1024) {
        setError("That image is too large. Try one under 25 MB.");
        return;
      }
      setError(null);
      setRenderPct(0);
      setStage("removing");
      try {
        const { cutOutSubject } = await import("@/lib/removeBg");
        const subject = await cutOutSubject(file);
        subjectRef.current = subject;
        await renderVideo("gold-mosque", "mere-aaqa", "9:16", subject);
      } catch (e) {
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
      if (renderingRef.current) return;
      const nextT = changes.template ?? currentTemplate;
      const nextK = changes.track ?? currentTrack;
      const nextA = changes.aspect ?? currentAspect;
      if (
        nextT === currentTemplate &&
        nextK === currentTrack &&
        nextA === currentAspect
      )
        return;
      try {
        await renderVideo(nextT, nextK, nextA, subjectRef.current);
      } catch (e) {
        console.error(e);
        setError(
          e instanceof Error ? e.message : "Couldn't update. Try again.",
        );
      }
    },
    [stage, currentTemplate, currentTrack, currentAspect, renderVideo],
  );

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    if (!v.muted) {
      v.currentTime = 0;
      v.play().catch(() => {});
    }
    setIsMuted(v.muted);
  };

  const handleShare = async () => {
    if (!videoUrl) return;
    try {
      const blob = await fetch(videoUrl).then((r) => r.blob());
      const file = new File([blob], `auntifyeid.${videoExt}`, {
        type: blob.type,
      });
      if (
        typeof navigator !== "undefined" &&
        navigator.canShare &&
        navigator.canShare({ files: [file] })
      ) {
        await navigator.share({
          files: [file],
          title: "Eid Mubarak",
          text: "Eid Mubarak 🌙",
        });
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") console.error(e);
    }
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
            canShare={canShare}
            onShare={handleShare}
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
          accept="image/*"
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
  const indeterminate = stage === "removing";
  return (
    <div className="flex flex-col items-center text-center gap-7">
      <ProgressRing pct={renderPct} indeterminate={indeterminate} size={140} />
      <p className="text-[15px] sm:text-base text-[var(--ink)] font-medium">
        {indeterminate ? "Removing background" : "Generating your video"}
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
  canShare,
  onShare,
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
  canShare: boolean;
  onShare: () => void;
  error: string | null;
}) {
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
            muted={isMuted}
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
          {canShare ? (
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <button
                onClick={onShare}
                disabled={isUpdating}
                className="bg-[var(--emerald)] hover:bg-[var(--emerald-hover)] disabled:opacity-60 disabled:cursor-not-allowed text-white font-medium py-3.5 rounded-xl transition-all flex items-center justify-center gap-2.5 shadow-[0_8px_24px_-8px_rgba(15,81,50,0.55)]"
              >
                <ShareIcon />
                <span>Share</span>
              </button>
              <a
                href={isUpdating ? undefined : videoUrl}
                download={`auntifyeid.${videoExt}`}
                aria-disabled={isUpdating}
                onClick={(e) => {
                  if (isUpdating) e.preventDefault();
                }}
                className={`px-4 py-3.5 rounded-xl border border-[var(--hair-strong)] text-[var(--ink-soft)] font-medium flex items-center justify-center transition-all ${
                  isUpdating
                    ? "opacity-60 cursor-not-allowed"
                    : "hover:bg-black/[0.03]"
                }`}
                aria-label="Download"
              >
                <DownloadIcon />
              </a>
            </div>
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

function ShareIcon() {
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
      <path d="M12 3v13" />
      <path d="m7 8 5-5 5 5" />
      <path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
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
