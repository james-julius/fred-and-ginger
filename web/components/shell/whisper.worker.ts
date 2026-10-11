// Whisper, running in the browser off the main thread, so the page stays smooth while it downloads
// and writes down what you said. The audio never leaves your device.

// transformers.js loads from jsDelivr the first time you talk, not from our bundle: bundling it brings
// ONNX's 26MB .wasm into the build, over Cloudflare's 25MiB limit per file.
const TRANSFORMERS = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js";
// English-only base model, 8-bit: about 77MB from Hugging Face, downloaded once and then kept in the browser's cache.
const MODEL = "onnx-community/whisper-base.en";

export type ToWhisper = { kind: "load" } | { kind: "transcribe"; id: number; audio: Float32Array };
export type FromWhisper =
  | { kind: "loading"; progress: number }
  | { kind: "ready" }
  | { kind: "text"; id: number; text: string }
  | { kind: "error"; id?: number };

// The part of transformers.js we use.
type Transcribe = (audio: Float32Array, options: { chunk_length_s: number }) => Promise<{ text: string }>;
type Transformers = {
  pipeline(
    task: "automatic-speech-recognition",
    model: string,
    options: { dtype: "q8"; device: "wasm"; progress_callback: (p: { status: string; progress?: number }) => void },
  ): Promise<Transcribe>;
};

const post = (message: FromWhisper) => self.postMessage(message);

let model: Promise<Transcribe> | null = null;
const load = () =>
  (model ??= (import(/* turbopackIgnore: true */ /* webpackIgnore: true */ TRANSFORMERS) as Promise<Transformers>)
    .then(({ pipeline }) =>
      pipeline("automatic-speech-recognition", MODEL, {
        dtype: "q8",
        device: "wasm",
        progress_callback: (p) => p.status === "progress_total" && post({ kind: "loading", progress: p.progress ?? 0 }),
      }),
    )
    .then((m) => {
      post({ kind: "ready" });
      return m;
    }));

self.onmessage = async ({ data }: MessageEvent<ToWhisper>) => {
  const id = data.kind === "transcribe" ? data.id : undefined;
  try {
    const transcribe = await load();
    if (data.kind !== "transcribe") return;
    const out = await transcribe(data.audio, { chunk_length_s: 30 });
    // Whisper marks silence and noises in brackets, like [BLANK_AUDIO] or (wind blowing).
    const text = out.text.replace(/\[[^\]]*\]|\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
    post({ kind: "text", id: data.id, text });
  } catch (e) {
    console.error("[whisper]", e);
    model = null; // try the download again next time
    post({ kind: "error", id });
  }
};
