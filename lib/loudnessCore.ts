import { LoudnessMetrics } from "./loudnessTypes";

export interface LoudnessWorkerPayload {
  weightedChannels: Float32Array[];
  originalChannels: Float32Array[];
  channelWeights: number[];
  blockSize: number;
  stepSize: number;
  totalSamples: number;
  originalLength: number;
  absoluteGate: number;
  relativeGateOffset: number;
  lufsOffset: number;
}

const toLUFS = (meanSquare: number, lufsOffset: number): number => {
  if (meanSquare <= 0) {
    return Number.NEGATIVE_INFINITY;
  }
  return lufsOffset + 10 * Math.log10(meanSquare);
};

const integrateBlocks = (meanSquares: number[], lufsOffset: number): number | null => {
  if (meanSquares.length === 0) {
    return null;
  }

  const energy = meanSquares.reduce((sum, value) => sum + value, 0) / meanSquares.length;
  if (energy <= 0) {
    return null;
  }
  return lufsOffset + 10 * Math.log10(energy);
};

export function computeLoudnessMetrics(payload: LoudnessWorkerPayload): LoudnessMetrics {
  const {
    weightedChannels,
    originalChannels,
    channelWeights,
    blockSize,
    stepSize,
    totalSamples,
    originalLength,
    absoluteGate,
    relativeGateOffset,
    lufsOffset
  } = payload;

  if (!weightedChannels.length || !originalChannels.length) {
    return { lufsIntegrated: null, peakDb: null };
  }

  let absolutePeak = 0;
  for (let channel = 0; channel < originalChannels.length; channel += 1) {
    const data = originalChannels[channel];
    for (let i = 0; i < originalLength; i += 1) {
      const abs = Math.abs(data[i] ?? 0);
      if (abs > absolutePeak) {
        absolutePeak = abs;
      }
    }
  }

  const meanSquares: number[] = [];
  const lufsPerBlock: number[] = [];

  for (let blockStart = 0; blockStart < totalSamples; blockStart += stepSize) {
    const actualBlockSize = Math.min(blockSize, totalSamples - blockStart);
    if (actualBlockSize <= 0) {
      continue;
    }

    let blockEnergy = 0;

    for (let channel = 0; channel < weightedChannels.length; channel += 1) {
      const data = weightedChannels[channel];
      let channelEnergy = 0;
      for (let i = 0; i < actualBlockSize; i += 1) {
        const sample = data[blockStart + i] ?? 0;
        channelEnergy += sample * sample;
      }
      blockEnergy += (channelWeights[channel] ?? 1) * (channelEnergy / actualBlockSize);
    }

    const meanSquare = blockEnergy;
    meanSquares.push(meanSquare);
    lufsPerBlock.push(toLUFS(meanSquare, lufsOffset));
  }

  const peakDb = absolutePeak > 0 ? Math.min(20 * Math.log10(absolutePeak), 0) : null;

  if (meanSquares.length === 0) {
    return { lufsIntegrated: null, peakDb };
  }

  const aboveAbsoluteGate: number[] = [];
  const aboveAbsoluteGateLufs: number[] = [];

  for (let i = 0; i < meanSquares.length; i += 1) {
    if (lufsPerBlock[i] > absoluteGate) {
      aboveAbsoluteGate.push(meanSquares[i]);
      aboveAbsoluteGateLufs.push(lufsPerBlock[i]);
    }
  }

  if (aboveAbsoluteGate.length === 0) {
    return { lufsIntegrated: null, peakDb };
  }

  const preliminaryLufs = integrateBlocks(aboveAbsoluteGate, lufsOffset);
  if (preliminaryLufs === null) {
    return { lufsIntegrated: null, peakDb };
  }

  const relativeGateThreshold = preliminaryLufs - relativeGateOffset;

  const aboveRelativeGate: number[] = [];
  for (let i = 0; i < aboveAbsoluteGate.length; i += 1) {
    if (aboveAbsoluteGateLufs[i] >= relativeGateThreshold) {
      aboveRelativeGate.push(aboveAbsoluteGate[i]);
    }
  }

  const finalLufs = integrateBlocks(
    aboveRelativeGate.length ? aboveRelativeGate : aboveAbsoluteGate,
    lufsOffset
  );

  return { lufsIntegrated: finalLufs, peakDb };
}
