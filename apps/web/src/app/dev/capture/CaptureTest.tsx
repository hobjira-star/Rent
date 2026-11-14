"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Phase ก capture test (ARCHITECTURE.md section 8). Measures, on the real phone and browser:
 * option ก = getUserMedia + MediaRecorder at 720p ~2.5 Mbps, option ข = <input capture>.
 * Pass mark: 30 s <= 15 MB and 3 min <= 60 MB with option ก, uploaded over 4G.
 */

type Env = {
  ua: string;
  inApp: string;
  standalone: boolean;
  mediaDevices: boolean;
  mediaRecorder: boolean;
  mimeTypes: string[];
};

type Result = {
  option: "ก MediaRecorder" | "ข file input";
  targetSeconds?: number;
  seconds: number;
  bytes: number;
  mime: string;
  width?: number;
  height?: number;
  upload?: { ok: boolean; ms: number; serverBytes?: number; sha256?: string; error?: string };
};

const CANDIDATE_MIMES = [
  "video/mp4;codecs=avc1.42E01E",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

function detectInApp(ua: string): string {
  if (/Line\//i.test(ua)) return "LINE";
  if (/Instagram/i.test(ua)) return "Instagram";
  if (/FBAN|FBAV/i.test(ua)) return "Facebook";
  if (/musical_ly|TikTok|BytedanceWebview/i.test(ua)) return "TikTok";
  return "ไม่ใช่ (เบราว์เซอร์ปกติ)";
}

const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;

export default function CaptureTest() {
  const [env, setEnv] = useState<Env | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [status, setStatus] = useState("");
  const [recording, setRecording] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const recRef = useRef<MediaRecorder | null>(null);

  useEffect(() => {
    const ua = navigator.userAgent;
    const hasMR = typeof window.MediaRecorder !== "undefined";
    setEnv({
      ua,
      inApp: detectInApp(ua),
      standalone: window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true,
      mediaDevices: !!navigator.mediaDevices?.getUserMedia,
      mediaRecorder: hasMR,
      mimeTypes: hasMR ? CANDIDATE_MIMES.filter((m) => MediaRecorder.isTypeSupported(m)) : [],
    });
  }, []);

  async function upload(blob: Blob, ext: string): Promise<Result["upload"]> {
    const key = `cap-${Date.now()}.${ext}`;
    const t0 = performance.now();
    try {
      const res = await fetch(`/api/v1/dev/uploads/${key}`, { method: "PUT", body: blob, headers: { "content-type": blob.type || "application/octet-stream" } });
      const json = (await res.json()) as { bytes?: number; sha256?: string; error?: string };
      return { ok: res.ok, ms: Math.round(performance.now() - t0), serverBytes: json.bytes, sha256: json.sha256, error: json.error };
    } catch (e) {
      return { ok: false, ms: Math.round(performance.now() - t0), error: String(e) };
    }
  }

  async function addResult(r: Result) {
    setResults((prev) => [r, ...prev]);
    await fetch("/api/v1/dev/capture-reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ env, result: r }),
    }).catch(() => undefined);
  }

  async function recordWithMediaRecorder(targetSeconds: number) {
    if (!env?.mediaRecorder || !env.mediaDevices) return setStatus("เบราว์เซอร์นี้ไม่มี MediaRecorder หรือกล้อง — ใช้ทางเลือก ข");
    setStatus("ขอสิทธิ์กล้อง…");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        audio: false,
      });
    } catch (e) {
      return setStatus(`เปิดกล้องไม่ได้: ${String(e)}`);
    }
    const track = stream.getVideoTracks()[0];
    const settings = track?.getSettings() ?? {};
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play().catch(() => undefined);
    }
    const mime = env.mimeTypes[0] ?? "";
    const rec = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: 2_500_000 });
    recRef.current = rec;
    const chunks: BlobPart[] = [];
    rec.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
    const started = performance.now();
    const done = new Promise<void>((resolve) => (rec.onstop = () => resolve()));
    rec.start(1000);
    setRecording(targetSeconds);
    setStatus(`กำลังอัด ${targetSeconds} วินาที…`);
    const timer = setTimeout(() => rec.state !== "inactive" && rec.stop(), targetSeconds * 1000);
    await done;
    clearTimeout(timer);
    stream.getTracks().forEach((t) => t.stop());
    setRecording(null);
    const blob = new Blob(chunks, { type: rec.mimeType || mime || "video/webm" });
    const seconds = Math.round((performance.now() - started) / 100) / 10;
    setStatus(`อัดได้ ${mb(blob.size)} กำลังอัปโหลด…`);
    const up = await upload(blob, blob.type.includes("mp4") ? "mp4" : "webm");
    setStatus(up?.ok ? "อัปโหลดสำเร็จ" : `อัปโหลดไม่สำเร็จ: ${up?.error ?? ""}`);
    await addResult({
      option: "ก MediaRecorder",
      targetSeconds,
      seconds,
      bytes: blob.size,
      mime: blob.type,
      width: settings.width,
      height: settings.height,
      upload: up,
    });
  }

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const seconds = await new Promise<number>((resolve) => {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => resolve(Math.round(v.duration * 10) / 10);
      v.onerror = () => resolve(0);
      v.src = URL.createObjectURL(file);
    });
    setStatus(`ไฟล์ ${mb(file.size)} กำลังอัปโหลด…`);
    const up = await upload(file, file.name.split(".").pop() ?? "bin");
    setStatus(up?.ok ? "อัปโหลดสำเร็จ" : `อัปโหลดไม่สำเร็จ: ${up?.error ?? ""}`);
    await addResult({ option: "ข file input", seconds, bytes: file.size, mime: file.type, upload: up });
    e.target.value = "";
  }

  const verdict = (r: Result) => {
    if (r.option !== "ก MediaRecorder" || !r.targetSeconds) return "";
    const limit = r.targetSeconds <= 30 ? 15 : 60;
    if (r.seconds < r.targetSeconds * 0.9) return "หยุดก่อนครบเวลา — ไม่นับผล";
    return r.bytes <= limit * 1024 * 1024 && r.upload?.ok ? `ผ่าน (≤${limit} MB)` : `ไม่ผ่าน (เกณฑ์ ≤${limit} MB และอัปโหลดสำเร็จ)`;
  };

  const btn: React.CSSProperties = { minHeight: 48, padding: "0 16px", borderRadius: 12, border: 0, background: "#7A2E63", color: "#fff", fontSize: 16, fontWeight: 600 };

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
      <h1 style={{ fontSize: 22, margin: 0 }}>ทดสอบถ่ายและอัปโหลดวิดีโอ</h1>
      <p style={{ margin: 0, color: "#555A66", fontSize: 14 }}>
        เปิดหน้านี้ใน iPhone (Safari และแบบติดตั้งบนหน้าจอ) Android Chrome และในแชต LINE ทั้งสองระบบ ใช้เน็ตมือถือ 4G แล้วกดทดสอบทุกปุ่ม ผลจะถูกบันทึกให้ทีมพัฒนาอัตโนมัติ
      </p>

      {env && (
        <section style={{ background: "#F5F6F8", borderRadius: 12, padding: 12, fontSize: 13, display: "grid", gap: 4 }}>
          <div>เปิดในแอป: <b>{env.inApp}</b> · ติดตั้งบนหน้าจอ: <b>{env.standalone ? "ใช่" : "ไม่"}</b></div>
          <div>กล้องผ่านหน้าเว็บ: <b>{env.mediaDevices ? "มี" : "ไม่มี"}</b> · MediaRecorder: <b>{env.mediaRecorder ? "มี" : "ไม่มี"}</b></div>
          <div>รูปแบบไฟล์ที่อัดได้: <b>{env.mimeTypes.join(", ") || "—"}</b></div>
          <div style={{ color: "#555A66", wordBreak: "break-all" }}>{env.ua}</div>
        </section>
      )}

      <video ref={videoRef} muted playsInline style={{ width: "100%", borderRadius: 12, background: "#000", aspectRatio: "16 / 9" }} />

      <section style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" style={btn} disabled={recording !== null} onClick={() => recordWithMediaRecorder(30)}>ก: อัด 30 วินาที</button>
        <button type="button" style={btn} disabled={recording !== null} onClick={() => recordWithMediaRecorder(180)}>ก: อัด 3 นาที</button>
        {recording !== null && (
          <button type="button" style={{ ...btn, background: "#17181C" }} onClick={() => recRef.current?.stop()}>หยุด</button>
        )}
        <label style={{ ...btn, display: "inline-flex", alignItems: "center", background: "#FFFFFF", color: "#17181C", border: "1px solid #C9CDD6" }}>
          ข: ถ่ายด้วยแอปกล้อง
          <input type="file" accept="video/*" capture="environment" onChange={onFilePicked} style={{ display: "none" }} />
        </label>
      </section>

      {status && <p role="status" style={{ margin: 0, fontWeight: 600 }}>{status}</p>}

      <section style={{ display: "grid", gap: 8 }}>
        {results.map((r, i) => (
          <div key={i} style={{ border: "1px solid #E4E6EB", borderRadius: 12, padding: 12, fontSize: 14, display: "grid", gap: 2 }}>
            <b>{r.option}{r.targetSeconds ? ` · ${r.targetSeconds} วินาที` : ""} — {verdict(r)}</b>
            <span>ยาวจริง {r.seconds} วินาที · {mb(r.bytes)} · {r.mime || "ไม่ทราบชนิด"}{r.width ? ` · ${r.width}×${r.height}` : ""}</span>
            <span>
              อัปโหลด: {r.upload?.ok ? `สำเร็จ ${(r.upload.ms / 1000).toFixed(1)} วินาที` : `ล้มเหลว ${r.upload?.error ?? ""}`}
              {r.upload?.serverBytes !== undefined && r.upload.serverBytes !== r.bytes ? " · ขนาดที่เซิร์ฟเวอร์ได้ไม่ตรง!" : ""}
            </span>
            {r.upload?.sha256 && <span style={{ color: "#555A66", fontSize: 12, wordBreak: "break-all" }}>SHA-256 (เซิร์ฟเวอร์): {r.upload.sha256}</span>}
          </div>
        ))}
      </section>
    </main>
  );
}
