export interface ChunkDraftPartial {
  seq: number;
  text: string;
  section: string;
}

export interface ChunkerPort {
  chunk(text: string): ChunkDraftPartial[];
}
