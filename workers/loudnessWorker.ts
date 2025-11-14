/// <reference lib="webworker" />

import { computeLoudnessMetrics, type LoudnessWorkerPayload } from "@/lib/loudnessCore";
import { LoudnessMetrics } from "@/lib/loudnessTypes";

type AnalyzeMessage = {
  type: "analyze";
  id: number;
  payload: WorkerPayload;
};

interface WorkerPayload {
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

type WorkerResponse =
  | { type: "result"; id: number; result: LoudnessMetrics }
  | { type: "error"; id: number; error: string };

const handleAnalyze = (message: AnalyzeMessage): WorkerResponse => {
  const { payload, id } = message;

  const weightedChannels = payload.weightedBuffers.map(
    (buffer) => new Float32Array(buffer)
  );
  const originalChannels = payload.originalBuffers.map(
    (buffer) => new Float32Array(buffer)
  );

  const result = computeLoudnessMetrics({
    weightedChannels,
    originalChannels,
    channelWeights: payload.channelWeights,
    blockSize: payload.blockSize,
    stepSize: payload.stepSize,
    totalSamples: payload.totalSamples,
    originalLength: payload.originalLength,
    absoluteGate: payload.absoluteGate,
    relativeGateOffset: payload.relativeGateOffset,
    lufsOffset: payload.lufsOffset
  } satisfies LoudnessWorkerPayload);

  return { type: "result", id, result };
};

self.onmessage = (event: MessageEvent<AnalyzeMessage>) => {
  const data = event.data;
  if (!data || data.type !== "analyze") {
    return;
  }

  try {
    const response = handleAnalyze(data);
    self.postMessage(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const fallback: WorkerResponse = { type: "error", id: data.id, error: message };
    self.postMessage(fallback);
  }
};

export {};
