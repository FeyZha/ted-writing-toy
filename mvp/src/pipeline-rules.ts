/** Executable defaults for 产品设计/13-素材处理与练习接入规则.md. */
export const pipelineRules={
  version:'ted-caption-clips-v2',
  previousVersion:'ted-caption-clips-v1',
  groupingVersion:'min10seconds-v1',
  segmentationVersion:'caption-sentences-min10words-min10seconds-v2',
  minimumWords:10,
  minimumSeconds:10,
  maximumDuration:14400,
  clipDurationTolerance:.15,
  clipStartTolerance:.08,
} as const;
