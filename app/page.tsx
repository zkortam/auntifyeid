"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TemplateId, TrackId } from "@/lib/renderVideo";

type Stage = "idle" | "removing" | "rendering" | "done";

const TEMPLATES: {
  id: TemplateId;
  label: string;
  gradient: string;
}[] = [
  {
    id: "gold-mosque",
    label: "Gold Mosque",
    gradient: "linear-gradient(90deg, #0E3D2C 0%, #D4AF37 55%, #FFE38A 100%)",
  },
  {
    id: "rose-garden",
    label: "Rose Garden",
    gradient: "linear-gradient(90deg, #5A1336 0%, #E73C7E 55%, #FFE2EC 100%)",
  },
  {
    id: "starry-night",
    label: "Starry Night",
    gradient: "linear-gradient(90deg, #0A1A3A 0%, #9B8FE0 55%, #FFFFFF 100%)",
  },
];

const TRACKS: { id: TrackId; label: string }[] = [
  { id: "mere-aaqa", label: "Mere Aaqa" },
  { id: "mubarak-eid", label: "Mubarak Eid" },
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
  const [isMuted, setIsMuted] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const subjectRef = useRef<ImageBitmap | null>(null);

  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
    };
  }, [videoUrl]);

  const reset = () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    setVideoUrl(null);
    setStage("idle");
    setRenderPct(0);
    setError(null);
    setIsMuted(true);
    setCurrentTemplate("gold-mosque");
    setCurrentTrack("mere-aaqa");
    subjectRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const renderVideo = useCallback(
    async (
      templateId: TemplateId,
      trackId: TrackId,
      subject: ImageBitmap,
    ) => {
      setStage("rendering");
      setRenderPct(0);
      const { generateAuntieVideo } = await import("@/lib/renderVideo");
      const { blob, ext } = await generateAuntieVideo(
        subject,
        templateId,
        trackId,
        (pct) => setRenderPct(pct),
      );
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      const url = URL.createObjectURL(blob);
      setVideoUrl(url);
      setVideoExt(ext);
      setCurrentTemplate(templateId);
      setCurrentTrack(trackId);
      setIsMuted(true);
      setStage("done");
    },
    [videoUrl],
  );

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
        await renderVideo("gold-mosque", "mere-aaqa", subject);
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

  const handleTemplateClick = useCallback(
    async (templateId: TemplateId) => {
      if (
        !subjectRef.current ||
        stage !== "done" ||
        templateId === currentTemplate
      )
        return;
      try {
        await renderVideo(templateId, currentTrack, subjectRef.current);
      } catch (e) {
        console.error(e);
        setError(
          e instanceof Error ? e.message : "Couldn't switch styles. Try again.",
        );
        setStage("done");
      }
    },
    [stage, currentTemplate, currentTrack, renderVideo],
  );

  const handleTrackClick = useCallback(
    async (trackId: TrackId) => {
      if (
        !subjectRef.current ||
        stage !== "done" ||
        trackId === currentTrack
      )
        return;
      try {
        await renderVideo(currentTemplate, trackId, subjectRef.current);
      } catch (e) {
        console.error(e);
        setError(
          e instanceof Error ? e.message : "Couldn't switch track. Try again.",
        );
        setStage("done");
      }
    },
    [stage, currentTrack, currentTemplate, renderVideo],
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

  return (
    <main className="relative h-dvh flex flex-col overflow-hidden">
      <header className="relative z-10 shrink-0 px-5 sm:px-8 pt-5 sm:pt-6 flex items-center">
        <div className="flex items-center gap-2">
          <CrescentMark />
          <span className="text-[13px] sm:text-sm tracking-[0.04em] text-[var(--ink-soft)] font-medium">
            auntifyeid
          </span>
        </div>
      </header>

      <section className="relative z-10 flex-1 min-h-0 flex flex-col items-center px-5 sm:px-6 py-3 sm:py-4">
        {stage === "idle" && (
          <IdleView
            dragOver={dragOver}
            setDragOver={setDragOver}
            fileInputRef={fileInputRef}
            onFile={handleFile}
            error={error}
          />
        )}

        {(stage === "removing" || stage === "rendering") && (
          <WorkingView stage={stage} renderPct={renderPct} />
        )}

        {stage === "done" && videoUrl && (
          <DoneView
            videoRef={videoRef}
            videoUrl={videoUrl}
            videoExt={videoExt}
            isMuted={isMuted}
            onToggleMute={toggleMute}
            currentTemplate={currentTemplate}
            onTemplate={handleTemplateClick}
            currentTrack={currentTrack}
            onTrack={handleTrackClick}
            onReset={reset}
          />
        )}
      </section>

      <footer className="relative z-10 shrink-0 px-5 sm:px-8 pb-3 sm:pb-4 text-center sm:text-left text-[10px] sm:text-[11px] text-[var(--muted)] tracking-[0.04em]">
        Auntify Eid © Zakaria Kortam
      </footer>
    </main>
  );
}

/* ---------- Views ---------- */

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
    <div className="w-full max-w-[520px] h-full flex flex-col justify-center items-center text-center gap-7 sm:gap-10">
      <h1 className="text-[34px] sm:text-[46px] leading-[1.04] tracking-[-0.02em] font-medium px-2">
        Turn your photo into an
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
        className={`group relative w-full aspect-[5/3] rounded-[20px] border border-dashed transition-all cursor-pointer flex flex-col items-center justify-center gap-2 overflow-hidden ${
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

function WorkingView({
  stage,
  renderPct,
}: {
  stage: "removing" | "rendering";
  renderPct: number;
}) {
  const indeterminate = stage === "removing";
  return (
    <div className="w-full h-full flex flex-col justify-center items-center text-center gap-7">
      <ProgressRing pct={renderPct} indeterminate={indeterminate} />
      <p className="text-[15px] sm:text-base text-[var(--ink)] font-medium">
        {indeterminate ? "Removing background" : "Generating your video"}
      </p>
    </div>
  );
}

function DoneView({
  videoRef,
  videoUrl,
  videoExt,
  isMuted,
  onToggleMute,
  currentTemplate,
  onTemplate,
  currentTrack,
  onTrack,
  onReset,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  videoUrl: string;
  videoExt: "mp4" | "webm";
  isMuted: boolean;
  onToggleMute: () => void;
  currentTemplate: TemplateId;
  onTemplate: (id: TemplateId) => void;
  currentTrack: TrackId;
  onTrack: (id: TrackId) => void;
  onReset: () => void;
}) {
  return (
    <div className="w-full max-w-[540px] h-full flex flex-col gap-3 sm:gap-4">
      <div className="flex-1 min-h-0 flex items-center justify-center w-full">
        <div className="relative max-h-full max-w-full">
          <video
            ref={videoRef}
            key={videoUrl}
            src={videoUrl}
            autoPlay
            loop
            muted={isMuted}
            playsInline
            className="block max-h-full max-w-full rounded-[18px] shadow-[0_24px_60px_-24px_rgba(0,0,0,0.45)]"
          />
          <button
            onClick={onToggleMute}
            aria-label={isMuted ? "Unmute" : "Mute"}
            className="absolute bottom-3 right-3 w-9 h-9 rounded-full bg-black/55 backdrop-blur-sm text-white flex items-center justify-center hover:bg-black/70 transition-colors"
          >
            {isMuted ? <MutedIcon /> : <UnmutedIcon />}
          </button>
          {isMuted && (
            <button
              onClick={onToggleMute}
              aria-label="Tap to hear"
              className="absolute bottom-3 left-3 px-2.5 py-1 rounded-full bg-black/55 backdrop-blur-sm text-white text-[11px] tracking-wide animate-pulse-soft"
            >
              tap to hear
            </button>
          )}
        </div>
      </div>

      <div className="shrink-0 w-full space-y-2.5">
        <PickerRow
          label="Style"
          options={TEMPLATES}
          currentId={currentTemplate}
          onSelect={(id) => onTemplate(id as TemplateId)}
          renderPreview={(opt) => (
            <div
              className="w-full h-[8px] rounded-full ring-1 ring-black/5"
              style={{
                background: (opt as (typeof TEMPLATES)[number]).gradient,
              }}
            />
          )}
        />
        <PickerRow
          label="Music"
          options={TRACKS}
          currentId={currentTrack}
          onSelect={(id) => onTrack(id as TrackId)}
          renderPreview={() => <NoteIcon className="text-current" />}
          compact
        />

        <div className="flex flex-col items-center gap-1.5 pt-1">
          <a
            href={videoUrl}
            download={`auntifyeid.${videoExt}`}
            className="w-full text-center bg-[var(--emerald)] hover:bg-[var(--emerald-hover)] active:bg-[var(--emerald-hover)] text-white font-medium py-3 sm:py-3.5 rounded-xl transition-colors flex items-center justify-center gap-2.5 shadow-[0_8px_24px_-8px_rgba(15,81,50,0.55)]"
          >
            <DownloadIcon />
            <span>Download {videoExt.toUpperCase()}</span>
          </a>
          <button
            onClick={onReset}
            className="text-[13px] text-[var(--muted)] hover:text-[var(--ink)] transition-colors py-0.5"
          >
            try another photo
          </button>
        </div>
      </div>
    </div>
  );
}

function PickerRow<T extends { id: string; label: string }>({
  label,
  options,
  currentId,
  onSelect,
  renderPreview,
  compact,
}: {
  label: string;
  options: T[];
  currentId: string;
  onSelect: (id: string) => void;
  renderPreview: (opt: T) => React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div>
      <div className="px-1 pb-1">
        <span className="text-[10px] tracking-[0.08em] uppercase text-[var(--muted)]">
          {label}
        </span>
      </div>
      <div className="flex items-stretch justify-center gap-2 w-full">
        {options.map((opt) => {
          const selected = opt.id === currentId;
          return (
            <button
              key={opt.id}
              onClick={() => onSelect(opt.id)}
              className={`flex-1 flex ${
                compact
                  ? "items-center justify-center gap-2 py-2 px-3"
                  : "flex-col items-center gap-1.5 py-2 px-2"
              } rounded-xl border transition-all ${
                selected
                  ? "border-[var(--emerald)]/30 bg-[var(--emerald)]/[0.04]"
                  : "border-transparent hover:bg-black/[0.022]"
              }`}
            >
              <span
                className={
                  compact
                    ? selected
                      ? "text-[var(--emerald)]"
                      : "text-[var(--muted)]"
                    : "w-full"
                }
              >
                {renderPreview(opt)}
              </span>
              <span
                className={`text-[11px] sm:text-xs tracking-[0.01em] ${
                  selected
                    ? "text-[var(--ink)] font-medium"
                    : "text-[var(--muted)]"
                }`}
              >
                {opt.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Loader ---------- */

function ProgressRing({
  pct,
  indeterminate,
}: {
  pct: number;
  indeterminate: boolean;
}) {
  const SIZE = 140;
  const STROKE = 8;
  const R = (SIZE - STROKE) / 2;
  const C = 2 * Math.PI * R;
  const portion = indeterminate ? 0.22 : Math.max(0.018, pct);
  const offset = C * (1 - portion);

  return (
    <div className="relative" style={{ width: SIZE, height: SIZE }}>
      <div
        className={
          indeterminate
            ? "absolute inset-0 animate-spin [animation-duration:1.1s]"
            : "absolute inset-0"
        }
      >
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          aria-hidden
        >
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke="var(--hair-strong)"
            strokeWidth={STROKE}
            opacity={0.55}
          />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={R}
            fill="none"
            stroke="var(--emerald)"
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
            style={{
              transition: indeterminate
                ? "none"
                : "stroke-dashoffset 120ms linear",
            }}
          />
        </svg>
      </div>
      {!indeterminate && (
        <div
          className="absolute inset-0 flex items-center justify-center text-[18px] font-medium tracking-[-0.01em] text-[var(--ink)] tabular-nums"
          aria-live="polite"
        >
          {Math.round(pct * 100)}
          <span className="text-[var(--muted)] text-[12px] ml-0.5 mb-0.5 self-end">
            %
          </span>
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
