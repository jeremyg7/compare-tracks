export interface LoudnessMetrics {
  lufsIntegrated: number | null;
  peakDb: number | null;
}

const ABSOLUTE_GATE_LUFS = -70;
const RELATIVE_GATE_OFFSET = 10;
const BLOCK_DURATION_SECONDS = 0.4;
const LUFS_OFFSET = -0.691;

const toLUFS = (meanSquare: number): number => {
  if (meanSquare <= 0) {
    return Number.NEGATIVE_INFINITY;
  }
  return LUFS_OFFSET + 10 * Math.log10(meanSquare);
};

const integrateBlocks = (meanSquares: number[]): number | null => {
  if (meanSquares.length === 0) {
    return null;
  }
  const energy = meanSquares.reduce((sum, value) => sum + value, 0) / meanSquares.length;
  if (energy <= 0) {
    return null;
  }
  return LUFS_OFFSET + 10 * Math.log10(energy);
};

export function analyzeLoudness(buffer: AudioBuffer): LoudnessMetrics {
  const channelCount = buffer.numberOfChannels;
  if (channelCount === 0) {
    return { lufsIntegrated: null, peakDb: null };
  }

  const channelData = Array.from({ length: channelCount }, (_, index) =>
    buffer.getChannelData(index)
  );

  const blockSize = Math.max(1, Math.round(BLOCK_DURATION_SECONDS * buffer.sampleRate));
  const totalSamples = buffer.length;

  let absolutePeak = 0;
  const meanSquares: number[] = [];
  const lufsPerBlock: number[] = [];

  for (let blockStart = 0; blockStart < totalSamples; blockStart += blockSize) {
    const blockSamples = Math.min(blockSize, totalSamples - blockStart);
    if (blockSamples === 0) {
      continue;
    }

    let blockSquareSum = 0;

    for (let channel = 0; channel < channelCount; channel += 1) {
      const data = channelData[channel];
      for (let i = 0; i < blockSamples; i += 1) {
        const sample = data[blockStart + i];
        const abs = Math.abs(sample);
        if (abs > absolutePeak) {
          absolutePeak = abs;
        }
        blockSquareSum += sample * sample;
      }
    }

    const meanSquare = blockSquareSum / (blockSamples * channelCount);
    meanSquares.push(meanSquare);
    lufsPerBlock.push(toLUFS(meanSquare));
  }

  const peakDb = absolutePeak > 0 ? 20 * Math.log10(absolutePeak) : null;

  const aboveAbsoluteGate: number[] = [];
  const aboveAbsoluteGateLufs: number[] = [];

  for (let i = 0; i < meanSquares.length; i += 1) {
    if (lufsPerBlock[i] > ABSOLUTE_GATE_LUFS) {
      aboveAbsoluteGate.push(meanSquares[i]);
      aboveAbsoluteGateLufs.push(lufsPerBlock[i]);
    }
  }

  if (aboveAbsoluteGate.length === 0) {
    return { lufsIntegrated: null, peakDb };
  }

  const preliminaryLufs = integrateBlocks(aboveAbsoluteGate);
  if (preliminaryLufs === null) {
    return { lufsIntegrated: null, peakDb };
  }

  const relativeGateThreshold = preliminaryLufs - RELATIVE_GATE_OFFSET;

  const aboveRelativeGate: number[] = [];
  for (let i = 0; i < aboveAbsoluteGate.length; i += 1) {
    if (aboveAbsoluteGateLufs[i] >= relativeGateThreshold) {
      aboveRelativeGate.push(aboveAbsoluteGate[i]);
    }
  }

  const finalLufs = integrateBlocks(aboveRelativeGate.length ? aboveRelativeGate : aboveAbsoluteGate);

  return { lufsIntegrated: finalLufs, peakDb };
}
