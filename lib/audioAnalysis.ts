import { computeLoudnessMetrics, type LoudnessWorkerPayload } from "./loudnessCore";
import { LoudnessMetrics } from "./loudnessTypes";

const ABSOLUTE_GATE_LUFS = -70;
const RELATIVE_GATE_OFFSET = 10;
const BLOCK_DURATION_SECONDS = 0.4;
const STEP_DURATION_SECONDS = 0.1;
const LUFS_OFFSET = -0.691;
const K_WEIGHT_SAMPLE_RATE = 48000;
const TRUE_PEAK_SAMPLE_RATE = 192000;

const HEAD_FILTER_FEEDFORWARD = new Float32Array([
  1.53512485958697,
  -2.69169618940638,
  1.19839281085285,
]);
const HEAD_FILTER_FEEDBACK = new Float32Array([
  1,
  -1.69065929318241,
  0.73248077421585,
]);
const RLB_FILTER_FEEDFORWARD = new Float32Array([1, -2, 1]);
const RLB_FILTER_FEEDBACK = new Float32Array([1, -1.99004745483398, 0.99007225036621]);

const computeSamplePeakDb = (buffer: AudioBuffer): number | null => {
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < buffer.length; i += 1) {
      const abs = Math.abs(data[i]);
      if (abs > peak) {
        peak = abs;
      }
    }
  }
  return peak > 0 ? Math.min(20 * Math.log10(peak), 0) : null;
};

const computeTruePeakDb = async (buffer: AudioBuffer): Promise<number | null> => {
  if (typeof OfflineAudioContext === "undefined") {
    return computeSamplePeakDb(buffer);
  }

  try {
    const oversampleRate = Math.min(TRUE_PEAK_SAMPLE_RATE, buffer.sampleRate * 4);
    const frameCount = Math.max(1, Math.ceil(buffer.duration * oversampleRate));
    const offlineContext = new OfflineAudioContext(buffer.numberOfChannels, frameCount, oversampleRate);
    const source = offlineContext.createBufferSource();
    source.buffer = buffer;
    source.connect(offlineContext.destination);
    source.start(0);
    const rendered = await offlineContext.startRendering();

    let peak = 0;
    for (let channel = 0; channel < rendered.numberOfChannels; channel += 1) {
      const data = rendered.getChannelData(channel);
      for (let i = 0; i < rendered.length; i += 1) {
        const abs = Math.abs(data[i]);
        if (abs > peak) {
          peak = abs;
        }
      }
    }

    return peak > 0 ? Math.min(20 * Math.log10(peak), 0) : null;
  } catch (error) {
    console.warn("True-peak analysis failed; falling back to sample peak", error);
    return computeSamplePeakDb(buffer);
  }
};

type WorkerResultMessage =
  | { type: "result"; id: number; result: LoudnessMetrics }
  | { type: "error"; id: number; error: string };

interface WorkerRequest {
  resolve: (value: LoudnessMetrics) => void;
  reject: (reason?: unknown) => void;
}

interface SerializedWorkerPayload {
  weightedBuffers: ArrayBuffer[];
  originalBuffers: ArrayBuffer[];
  channelWeights: number[];
  blockSize: number;
  stepSize: number;
  totalSamples: number;
  originalLength: number;
  absoluteGate: number;
  relativeGateOffset: number;
  lufsOffset: number;
}

let loudnessWorker: Worker | null = null;
const pendingWorkerRequests = new Map<number, WorkerRequest>();
let workerMessageId = 0;

const rejectAllPending = (reason: unknown) => {
  pendingWorkerRequests.forEach(({ reject }) => reject(reason));
  pendingWorkerRequests.clear();
};

const handleWorkerMessage = (event: MessageEvent<WorkerResultMessage>) => {
  const data = event.data;
  if (!data || typeof data !== "object") {
    return;
  }

  const pending = pendingWorkerRequests.get(data.id);
  if (!pending) {
    return;
  }

  pendingWorkerRequests.delete(data.id);

  if (data.type === "result") {
    pending.resolve(data.result);
  } else {
    pending.reject(new Error(data.error));
  }
};

const handleWorkerError = (event: ErrorEvent) => {
  console.error("Loudness worker error", event.message);
  rejectAllPending(event.error ?? new Error(event.message));
  teardownWorker();
};

const teardownWorker = () => {
  if (!loudnessWorker) {
    return;
  }

  loudnessWorker.removeEventListener("message", handleWorkerMessage as EventListener);
  loudnessWorker.removeEventListener("error", handleWorkerError as EventListener);
  loudnessWorker.terminate();
  loudnessWorker = null;
};

const ensureWorker = (): Worker | null => {
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    return null;
  }

  if (loudnessWorker) {
    return loudnessWorker;
  }

  try {
    loudnessWorker = new Worker(new URL("../workers/loudnessWorker.ts", import.meta.url), {
      type: "module"
    });
    loudnessWorker.addEventListener("message", handleWorkerMessage as EventListener);
    loudnessWorker.addEventListener("error", handleWorkerError as EventListener);
    return loudnessWorker;
  } catch (error) {
    console.warn("Unable to initialize loudness worker", error);
    loudnessWorker = null;
    return null;
  }
};

const serializeForWorker = (payload: LoudnessWorkerPayload): SerializedWorkerPayload => ({
  weightedBuffers: payload.weightedChannels.map((channel) => channel.buffer),
  originalBuffers: payload.originalChannels.map((channel) => channel.buffer),
  channelWeights: payload.channelWeights.slice(),
  blockSize: payload.blockSize,
  stepSize: payload.stepSize,
  totalSamples: payload.totalSamples,
  originalLength: payload.originalLength,
  absoluteGate: payload.absoluteGate,
  relativeGateOffset: payload.relativeGateOffset,
  lufsOffset: payload.lufsOffset
});

const postToWorker = (worker: Worker, payload: LoudnessWorkerPayload): Promise<LoudnessMetrics> => {
  const serialized = serializeForWorker(payload);
  const transferables = serialized.weightedBuffers.concat(serialized.originalBuffers);

  return new Promise((resolve, reject) => {
    const id = workerMessageId;
    workerMessageId += 1;
    pendingWorkerRequests.set(id, { resolve, reject });
    worker.postMessage(
      {
        type: "analyze",
        id,
        payload: serialized
      },
      transferables
    );
  });
};

const cloneChannels = (buffer: AudioBuffer, desiredChannels: number): Float32Array[] => {
  const cloned: Float32Array[] = [];
  for (let channel = 0; channel < desiredChannels; channel += 1) {
    const sourceChannel =
      channel < buffer.numberOfChannels
        ? buffer.getChannelData(channel)
        : null;
    const copy = new Float32Array(buffer.length);
    if (sourceChannel) {
      copy.set(sourceChannel);
    }
    cloned.push(copy);
  }
  return cloned;
};

const analyzeWithWorker = async (
  payloadFactory: () => LoudnessWorkerPayload
): Promise<LoudnessMetrics | null> => {
  const worker = ensureWorker();
  if (!worker) {
    return null;
  }

  try {
    const payload = payloadFactory();
    return await postToWorker(worker, payload);
  } catch (error) {
    console.warn("Falling back to main-thread loudness analysis", error);
    rejectAllPending(error);
    teardownWorker();
    return null;
  }
};

const applyKWeighting = async (buffer: AudioBuffer): Promise<AudioBuffer> => {
  if (typeof OfflineAudioContext === "undefined") {
    return buffer;
  }

  try {
    const renderLength = Math.max(1, Math.ceil(buffer.duration * K_WEIGHT_SAMPLE_RATE));
    const offlineContext = new OfflineAudioContext(
      buffer.numberOfChannels,
      renderLength,
      K_WEIGHT_SAMPLE_RATE
    );

    const source = offlineContext.createBufferSource();
    source.buffer = buffer;

    if (typeof offlineContext.createIIRFilter === "function") {
      // Use the official BS.1770 cascade (spherical head shelf + RLB high-pass)
      const headFilter = offlineContext.createIIRFilter(
        HEAD_FILTER_FEEDFORWARD,
        HEAD_FILTER_FEEDBACK
      );
      const rlbFilter = offlineContext.createIIRFilter(
        RLB_FILTER_FEEDFORWARD,
        RLB_FILTER_FEEDBACK
      );
      source.connect(headFilter);
      headFilter.connect(rlbFilter);
      rlbFilter.connect(offlineContext.destination);
    } else {
      // Older browsers without IIR support fall back to a close approximation.
      const highpass = offlineContext.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = 60;
      highpass.Q.value = Math.SQRT1_2;

      const highshelf = offlineContext.createBiquadFilter();
      highshelf.type = "highshelf";
      highshelf.frequency.value = 4000;
      highshelf.gain.value = 4;
      highshelf.Q.value = Math.SQRT1_2;

      source.connect(highpass);
      highpass.connect(highshelf);
      highshelf.connect(offlineContext.destination);
    }

    source.start(0);

    const rendered = await offlineContext.startRendering();
    return rendered;
  } catch (error) {
    console.warn("K-weighting failed, falling back to unweighted audio", error);
    return buffer;
  }
};

export async function analyzeLoudness(buffer: AudioBuffer): Promise<LoudnessMetrics> {
  const channelCount = buffer.numberOfChannels;
  if (channelCount === 0) {
    return { lufsIntegrated: null, peakDb: null };
  }

  const weightedBuffer = await applyKWeighting(buffer);
  const channelWeights = new Array(channelCount).fill(1);
  if (channelCount === 6) {
    // L, R, C, LFE, Ls, Rs — LFE excluded from loudness
    channelWeights[3] = 0;
  }

  const weightedSampleRate = weightedBuffer.sampleRate;
  const blockSize = Math.max(1, Math.round(BLOCK_DURATION_SECONDS * weightedSampleRate));
  const stepSize = Math.max(1, Math.round(STEP_DURATION_SECONDS * weightedSampleRate));
  const totalSamples = weightedBuffer.length;
  const originalLength = buffer.length;

  const buildPayload = (): LoudnessWorkerPayload => ({
    weightedChannels: cloneChannels(weightedBuffer, channelCount),
    originalChannels: cloneChannels(buffer, channelCount),
    channelWeights,
    blockSize,
    stepSize,
    totalSamples,
    originalLength,
    absoluteGate: ABSOLUTE_GATE_LUFS,
    relativeGateOffset: RELATIVE_GATE_OFFSET,
    lufsOffset: LUFS_OFFSET
  });

  const peakDb = await computeTruePeakDb(buffer);

  const workerResult = await analyzeWithWorker(buildPayload);
  if (workerResult) {
    return { ...workerResult, peakDb };
  }

  const fallbackResult = computeLoudnessMetrics(buildPayload());
  return { ...fallbackResult, peakDb };
}
