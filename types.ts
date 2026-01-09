export interface SubtitleLine {
  start: number;
  end: number;
  speaker: string;
  text: string;
}

export interface SlideData {
  id: string;
  file: File;
  filename: string;
  startTime?: number; // Inferred from filename
  analysis?: string; // From Gemini Vision
  status: 'pending' | 'processing' | 'done' | 'error';
}

export interface ProcessingState {
  step: 'upload' | 'analyzing_slides' | 'transcribing_audio' | 'generating_report' | 'complete';
  progress: number;
  totalSlides: number;
  processedSlides: number;
  statusMessage: string;
}

export interface Topic {
  id: string;
  title: string;
  description: string;
  keywords: string[];
}

export interface TranscriptSegment {
  timestamp: string;
  text: string;
}

export interface TimelineEntry {
  slide: string; // filename
  speaker_note: string;
  aligned_segments: TranscriptSegment[];
  broll: string[];
  topics: string[];
}

export interface FinalOutput {
  topics: Topic[];
  timeline: TimelineEntry[];
}

export enum InputMode {
  AUDIO_FILE = 'AUDIO_FILE',
  ASS = 'ASS',
  SRT = 'SRT',
  VTT = 'VTT',
  TEXT = 'TEXT'
}
