export interface LoudnessMetrics {
  lufsIntegrated: number | null;
  peakDb: number | null;
}

const ABSOLUTE_GATE_LUFS = -70;
const RELATIVE_GATE_OFFSET = 10;
const BLOCK_DURATION_SECONDS = 0.4;
const STEP_DURATION_SECONDS = 0.1;
const LUFS_OFFSET = -0.691;

const applyKWeighting = async (buffer: AudioBuffer): Promise<AudioBuffer> => {
  if (typeof OfflineAudioContext === "undefined") {
    return buffer;
  }

  try {
    const offlineContext = new OfflineAudioContext(
      buffer.numberOfChannels,
      buffer.length,
      buffer.sampleRate
    );

    const source = offlineContext.createBufferSource();
    source.buffer = buffer;

    const highpass = offlineContext.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 40;
    highpass.Q.value = Math.SQRT1_2;

    const highshelf = offlineContext.createBiquadFilter();
    highshelf.type = "highshelf";
    highshelf.frequency.value = 4000;
    highshelf.gain.value = 4;
    highshelf.Q.value = Math.SQRT1_2;

    source.connect(highpass);
    highpass.connect(highshelf);
    highshelf.connect(offlineContext.destination);

    source.start(0);

    const rendered = await offlineContext.startRendering();
    return rendered;
  } catch (error) {
    console.warn("K-weighting failed, falling back to unweighted audio", error);
    return buffer;
  }
};

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

export async function analyzeLoudness(buffer: AudioBuffer): Promise<LoudnessMetrics> {
  const channelCount = buffer.numberOfChannels;
  if (channelCount === 0) {
    return { lufsIntegrated: null, peakDb: null };
  }

  const weightedBuffer = await applyKWeighting(buffer);
  const weightedChannels = Array.from({ length: channelCount }, (_, index) =>
    weightedBuffer.getChannelData(Math.min(index, weightedBuffer.numberOfChannels - 1))
  );

  const originalChannels = Array.from({ length: channelCount }, (_, index) =>
    buffer.getChannelData(index)
  );

  const channelWeights = new Array(channelCount).fill(1);
  if (channelCount >= 6) {
    // Basic 5.1 weighting: L, R, C, LFE, Ls, Rs (LFE excluded)
    channelWeights[3] = 0;
  }

  const blockSize = Math.max(1, Math.round(BLOCK_DURATION_SECONDS * buffer.sampleRate));
  const stepSize = Math.max(1, Math.round(STEP_DURATION_SECONDS * buffer.sampleRate));
  const totalSamples = buffer.length;

  let absolutePeak = 0;
  for (let channel = 0; channel < channelCount; channel += 1) {
    const data = originalChannels[channel];
    for (let i = 0; i < totalSamples; i += 1) {
      const abs = Math.abs(data[i]);
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
    let blockSquareSum = 0;

    for (let i = 0; i < actualBlockSize; i += 1) {
      let combined = 0;
      for (let channel = 0; channel < channelCount; channel += 1) {
        const sample = weightedChannels[channel][blockStart + i] ?? 0;
        combined += channelWeights[channel] * sample;
      }
      blockSquareSum += combined * combined;
    }

    const meanSquare = blockSquareSum / actualBlockSize;
    meanSquares.push(meanSquare);
    lufsPerBlock.push(toLUFS(meanSquare));
  }

  const peakDb = absolutePeak > 0 ? Math.min(20 * Math.log10(absolutePeak), 0) : null;

  if (meanSquares.length === 0) {
    return { lufsIntegrated: null, peakDb };
  }

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
