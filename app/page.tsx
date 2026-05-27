"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TemplateId } from "@/lib/renderVideo";

type Stage = "idle" | "removing" | "rendering" | "done";

const TEMPLATES: { id: TemplateId; label: string; swatch: string[] }[] = [
  {
    id: "gold-mosque",
    label: "Gold Mosque",
    swatch: ["#0E3D2C", "#D4AF37", "#FFE38A"],
  },
  {
    id: "rose-garden",
    label: "Rose Garden",
    swatch: ["#5A1336", "#E73C7E", "#FFE2EC"],
  },
  {
    id: "starry-night",
    label: "Starry Night",
    swatch: ["#0A1A3A", "#9B8FE0", "#FFFFFF"],
  },
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
    subjectRef.current = null;
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const renderWithTemplate = useCallback(
    async (templateId: TemplateId, subject: ImageBitmap) => {
      setStage("rendering");
      setRenderPct(0);
      const { generateAuntieVideo } = await import("@/lib/renderVideo");
      const { blob, ext } = await generateAuntieVideo(
        subject,
        templateId,
        (pct) => setRenderPct(pct),
      );
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      const url = URL.createObjectURL(blob);
      setVideoUrl(url);
      setVideoExt(ext);
      setCurrentTemplate(templateId);
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
        await renderWithTemplate("gold-mosque", subject);
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
    [renderWithTemplate],
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
        await renderWithTemplate(templateId, subjectRef.current);
      } catch (e) {
        console.error(e);
        setError(
          e instanceof Error ? e.message : "Couldn't switch styles. Try again.",
        );
        setStage("done");
      }
    },
    [stage, currentTemplate, renderWithTemplate],
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
    <main className="min-h-dvh flex flex-col">
      <header className="px-8 pt-8">
        <span className="text-sm tracking-[0.02em] text-[var(--muted)]">
          auntifyeid
        </span>
      </header>

      <section className="flex-1 flex items-center justify-center px-6 pb-16">
        <div className="w-full max-w-[540px]">
          {stage === "idle" && (
            <div className="flex flex-col items-center text-center gap-12">
              <h1 className="text-[46px] leading-[1.04] tracking-[-0.02em] font-medium">
                Turn your photo into an
                <br />
                <span className="italic text-[var(--emerald)]">
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
                  if (f) handleFile(f);
                }}
                className={`group relative w-full aspect-[5/3] rounded-2xl border border-dashed transition-all cursor-pointer flex flex-col items-center justify-center gap-3 ${
                  dragOver
                    ? "border-[var(--emerald)] bg-[var(--emerald)]/[0.05] scale-[1.01]"
                    : "border-[var(--hair)] hover:border-[var(--emerald)]/60 hover:bg-[var(--emerald)]/[0.025]"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                  }}
                />
                <UploadIcon />
                <span className="text-base text-[var(--ink)]">
                  Drop a photo of yourself
                </span>
                <span className="text-sm text-[var(--muted)]">
                  or click to upload
                </span>
              </label>

              {error && <p className="text-sm text-red-700 -mt-6">{error}</p>}

              <p className="text-xs text-[var(--muted)] max-w-[380px]">
                Background removal runs in your browser. Nothing is uploaded.
              </p>
            </div>
          )}

          {(stage === "removing" || stage === "rendering") && (
            <div className="flex flex-col items-center text-center gap-8">
              <Spinner />
              <div className="space-y-2">
                <p className="text-base text-[var(--ink)]">
                  {stage === "removing"
                    ? "Removing background"
                    : "Generating your video"}
                </p>
                <p className="text-xs text-[var(--muted)]">
                  {stage === "removing"
                    ? "First run downloads a small model — about 15 seconds."
                    : `${Math.round(renderPct * 100)}%`}
                </p>
              </div>
              {stage === "rendering" && (
                <div className="w-full max-w-[320px] h-[3px] bg-[var(--hair)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[var(--emerald)] transition-[width] duration-100"
                    style={{ width: `${renderPct * 100}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {stage === "done" && videoUrl && (
            <div className="flex flex-col items-center gap-7">
              <div className="relative w-full">
                <video
                  ref={videoRef}
                  key={videoUrl}
                  src={videoUrl}
                  autoPlay
                  loop
                  muted={isMuted}
                  playsInline
                  className="w-full rounded-2xl shadow-[0_20px_60px_-20px_rgba(0,0,0,0.45)]"
                />
                <button
                  onClick={toggleMute}
                  aria-label={isMuted ? "Unmute" : "Mute"}
                  className="absolute bottom-3 right-3 w-10 h-10 rounded-full bg-black/55 backdrop-blur-sm text-white flex items-center justify-center hover:bg-black/70 transition-colors"
                >
                  {isMuted ? <MutedIcon /> : <UnmutedIcon />}
                </button>
                {isMuted && (
                  <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded-full bg-black/55 backdrop-blur-sm text-white text-[11px] tracking-wide">
                    tap to hear
                  </div>
                )}
              </div>

              <div className="flex items-center justify-center gap-2 w-full">
                {TEMPLATES.map((tpl) => {
                  const selected = tpl.id === currentTemplate;
                  return (
                    <button
                      key={tpl.id}
                      onClick={() => handleTemplateClick(tpl.id)}
                      className={`flex-1 group flex flex-col items-center gap-2 py-2 px-2 rounded-xl transition-all ${
                        selected
                          ? "ring-2 ring-[var(--emerald)] bg-[var(--emerald)]/[0.04]"
                          : "hover:bg-black/[0.03]"
                      }`}
                    >
                      <div className="flex gap-1">
                        {tpl.swatch.map((c, i) => (
                          <span
                            key={i}
                            className="w-3.5 h-3.5 rounded-full border border-black/10"
                            style={{ background: c }}
                          />
                        ))}
                      </div>
                      <span
                        className={`text-xs ${
                          selected
                            ? "text-[var(--ink)]"
                            : "text-[var(--muted)]"
                        }`}
                      >
                        {tpl.label}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-col items-center gap-3 w-full">
                <a
                  href={videoUrl}
                  download={`auntifyeid.${videoExt}`}
                  className="w-full text-center bg-[var(--emerald)] hover:bg-[var(--emerald-hover)] text-white font-medium py-3.5 rounded-xl transition-colors"
                >
                  Download {videoExt.toUpperCase()}
                </a>
                <button
                  onClick={reset}
                  className="text-sm text-[var(--muted)] hover:text-[var(--ink)] transition-colors"
                >
                  try another photo
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function Spinner() {
  return (
    <div className="relative w-9 h-9">
      <div className="absolute inset-0 rounded-full border-2 border-[var(--hair)]" />
      <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[var(--emerald)] animate-spin" />
    </div>
  );
}

function UploadIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-[var(--muted)] mb-1"
      aria-hidden
    >
      <path d="M12 16V4" />
      <path d="m7 9 5-5 5 5" />
      <path d="M20 16v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-3" />
    </svg>
  );
}

function MutedIcon() {
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
      <path d="M11 5 6 9H2v6h4l5 4z" />
      <line x1="22" y1="9" x2="16" y2="15" />
      <line x1="16" y1="9" x2="22" y2="15" />
    </svg>
  );
}

function UnmutedIcon() {
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
      <path d="M11 5 6 9H2v6h4l5 4z" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}
