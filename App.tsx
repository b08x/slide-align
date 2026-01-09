import React, { useState, useCallback, useRef } from 'react';
import { 
  Upload, 
  FileAudio, 
  FileText, 
  Image as ImageIcon, 
  CheckCircle, 
  Loader2, 
  Play, 
  Download,
  BrainCircuit,
  AlertCircle,
  FileType,
  Mic,
  Clock,
  ExternalLink,
  ChevronRight,
  Info,
  Layers
} from 'lucide-react';
import { SubtitleLine, SlideData, ProcessingState, FinalOutput, InputMode } from './types';
import { inferTimeFromFilename, secondsToHms } from './services/parserService';
import { parseAssFile } from './services/parsers/assParser';
import { parseSrtFile } from './services/parsers/srtParser';
import { parseVttFile } from './services/parsers/vttParser';
import { parseTextFile } from './services/parsers/textParser';
import { analyzeSlideImage, generateFinalReport, transcribeAudio } from './services/geminiService';

const App: React.FC = () => {
  // State
  const [inputMode, setInputMode] = useState<InputMode>(InputMode.ASS);
  const [transcriptFile, setTranscriptFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [slides, setSlides] = useState<SlideData[]>([]);
  
  const [processing, setProcessing] = useState<ProcessingState>({
    step: 'upload',
    progress: 0,
    totalSlides: 0,
    processedSlides: 0,
    statusMessage: ''
  });
  
  const [finalOutput, setFinalOutput] = useState<FinalOutput | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Handlers
  const handleStartOver = () => {
    setTranscriptFile(null);
    setAudioFile(null);
    setSlides([]);
    setProcessing({
        step: 'upload',
        progress: 0,
        totalSlides: 0,
        processedSlides: 0,
        statusMessage: ''
    });
    setFinalOutput(null);
    setError(null);
    setInputMode(InputMode.ASS);
  };

  const handleSlidesUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newSlides: SlideData[] = Array.from(e.target.files).map((f: File) => ({
        id: Math.random().toString(36).substring(7),
        file: f,
        filename: f.name,
        startTime: inferTimeFromFilename(f.name),
        status: 'pending' as const
      })).sort((a, b) => (a.filename > b.filename ? 1 : -1)); 
      setSlides(prev => [...prev, ...newSlides]);
    }
  };

  const handleTranscriptUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setTranscriptFile(e.target.files[0]);
    }
  };

  const handleAudioUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setAudioFile(e.target.files[0]);
    }
  };

  const startProcessing = async () => {
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
      setError("Google Gemini API Key is not configured in environment variables.");
      return;
    }
    
    if (slides.length === 0) {
      setError("Please upload at least one slide.");
      return;
    }

    if (inputMode === InputMode.AUDIO_FILE && !audioFile) {
        setError("Please upload an audio file.");
        return;
    }
    if (inputMode !== InputMode.AUDIO_FILE && !transcriptFile) {
        setError("Please upload a transcript file.");
        return;
    }

    setError(null);
    setProcessing({
      step: 'analyzing_slides',
      progress: 0,
      totalSlides: slides.length,
      processedSlides: 0,
      statusMessage: 'Starting pipeline...'
    });

    try {
      let transcriptLines: SubtitleLine[] = [];
      
      if (inputMode === InputMode.AUDIO_FILE && audioFile) {
        setProcessing(p => ({ ...p, step: 'transcribing_audio', statusMessage: 'Transcribing audio...' }));
        transcriptLines = await transcribeAudio(audioFile, apiKey);
      } else if (transcriptFile) {
        setProcessing(p => ({ ...p, statusMessage: `Parsing ${inputMode} file...` }));
        switch (inputMode) {
            case InputMode.ASS:
                transcriptLines = await parseAssFile(transcriptFile);
                break;
            case InputMode.SRT:
                transcriptLines = await parseSrtFile(transcriptFile);
                break;
            case InputMode.VTT:
                transcriptLines = await parseVttFile(transcriptFile);
                break;
            case InputMode.TEXT:
                transcriptLines = await parseTextFile(transcriptFile);
                break;
            default:
                throw new Error("Unsupported input mode");
        }
      }

      if (transcriptLines.length === 0) {
        throw new Error("No transcript data found.");
      }

      setProcessing(p => ({ ...p, step: 'analyzing_slides', statusMessage: 'Analyzing slides...' }));
      const processedSlides = [...slides];
      let completed = 0;
      const chunkSize = 3;
      for (let i = 0; i < processedSlides.length; i += chunkSize) {
          const chunk = processedSlides.slice(i, i + chunkSize);
          await Promise.all(chunk.map(async (slide) => {
              try {
                  slide.status = 'processing';
                  setSlides([...processedSlides]);
                  slide.analysis = await analyzeSlideImage(slide, apiKey);
                  slide.status = 'done';
              } catch (e) {
                  slide.status = 'error';
                  slide.analysis = "Error.";
              } finally {
                  completed++;
                  setProcessing(p => ({ 
                      ...p, 
                      processedSlides: completed, 
                      progress: (completed / p.totalSlides) * 100 
                  }));
                  setSlides([...processedSlides]);
              }
          }));
      }

      setProcessing(p => ({ ...p, step: 'generating_report', statusMessage: 'Aligning content (Thinking Mode)...' }));
      const report = await generateFinalReport(transcriptLines, processedSlides, apiKey);
      setFinalOutput(report);
      setProcessing(p => ({ ...p, step: 'complete', statusMessage: 'Done!' }));
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.");
      setProcessing(p => ({ ...p, step: 'upload', statusMessage: 'Failed.' }));
    }
  };

  const downloadReport = () => {
    if (!finalOutput) return;
    const blob = new Blob([JSON.stringify(finalOutput, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'alignment_report.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const getAcceptAttribute = () => {
      switch(inputMode) {
          case InputMode.ASS: return ".ass";
          case InputMode.SRT: return ".srt";
          case InputMode.VTT: return ".vtt";
          case InputMode.TEXT: return ".txt,.md";
          case InputMode.AUDIO_FILE: return "audio/*";
          default: return "*";
      }
  };

  // Views
  if (finalOutput) {
      return (
          <div className="min-h-screen bg-white flex flex-col">
              <header className="bg-slate-900 text-white px-6 py-4 sticky top-0 z-20 flex items-center justify-between shadow-xl">
                  <div className="flex items-center gap-3">
                      <div className="bg-indigo-500 p-2 rounded-lg">
                          <BrainCircuit className="w-6 h-6 text-white" />
                      </div>
                      <h1 className="text-xl font-bold tracking-tight">SlideAlign <span className="text-indigo-400">Pro</span></h1>
                  </div>
                  <div className="flex gap-4">
                      <button onClick={handleStartOver} className="px-4 py-2 text-sm text-slate-300 hover:text-white font-medium transition-colors">Start Over</button>
                      <button onClick={downloadReport} className="flex items-center gap-2 bg-white text-slate-900 hover:bg-slate-100 px-4 py-2 rounded-lg text-sm font-bold transition-all transform active:scale-95 shadow-lg">
                          <Download className="w-4 h-4" /> Export Report
                      </button>
                  </div>
              </header>
              
              <main className="flex-1 max-w-6xl mx-auto w-full p-8 flex flex-col gap-16">
                  {/* Topics Bar */}
                  <section className="bg-slate-50 border border-slate-200 rounded-2xl p-6">
                      <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                          <Layers className="w-4 h-4" /> Conceptual Framework
                      </h2>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                          {finalOutput.topics.map(topic => (
                              <div key={topic.id} className="group cursor-default">
                                  <h3 className="font-bold text-slate-800 flex items-center gap-1">
                                      <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                                      {topic.title}
                                  </h3>
                                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">{topic.description}</p>
                              </div>
                          ))}
                      </div>
                  </section>

                  {/* Main Alignment Stream */}
                  <div className="space-y-24">
                      {slides.map((slide, idx) => {
                          const slideInfo = finalOutput.slides[slide.filename];
                          if (!slideInfo) return null;
                          
                          return (
                              <article key={slide.id} className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
                                  {/* Left: Slide Visual & Timestamp */}
                                  <div className="lg:col-span-5 sticky top-24 space-y-4">
                                      <div className="relative group">
                                          <div className="absolute -top-3 -left-3 bg-indigo-600 text-white px-3 py-1 rounded-full text-xs font-mono font-bold shadow-lg z-10 flex items-center gap-2">
                                              <Clock className="w-3 h-3" />
                                              {slide.startTime !== undefined ? secondsToHms(slide.startTime) : "Manual Sync"}
                                          </div>
                                          <img 
                                            src={URL.createObjectURL(slide.file)} 
                                            alt={slide.filename} 
                                            className="w-full rounded-2xl shadow-2xl border border-slate-100 hover:scale-[1.02] transition-transform duration-500"
                                          />
                                          <div className="mt-4 flex items-center justify-between text-[10px] font-mono text-slate-400 px-2">
                                              <span>{slide.filename}</span>
                                              <span>Slide {idx + 1}</span>
                                          </div>
                                      </div>

                                      {/* Secondary Info: Speaker Notes (Subtle) */}
                                      <div className="bg-slate-50 border border-slate-100 rounded-xl p-4">
                                          <h4 className="text-[10px] font-bold text-slate-400 uppercase mb-2 flex items-center gap-1.5">
                                              <Info className="w-3 h-3" /> Context Note
                                          </h4>
                                          <p className="text-slate-600 text-xs leading-relaxed italic">
                                              {slideInfo.speaker_note}
                                          </p>
                                      </div>

                                      {/* Secondary Info: Assets (Subtle) */}
                                      {slideInfo.broll && (
                                          <div className="flex flex-wrap gap-2">
                                              {slideInfo.broll.map((asset, i) => (
                                                  <span key={i} className="text-[10px] bg-slate-100 text-slate-500 px-2 py-1 rounded-md border border-slate-200">
                                                      {asset}
                                                  </span>
                                              ))}
                                          </div>
                                      )}
                                  </div>

                                  {/* Right: Fine-grained Transcript Segments */}
                                  <div className="lg:col-span-7 space-y-6 pt-2">
                                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                          <ChevronRight className="w-4 h-4 text-indigo-400" /> Precise Transcript Alignment
                                      </h4>
                                      <div className="space-y-8">
                                          {slideInfo.aligned_segments.map((seg, sIdx) => (
                                              <div key={sIdx} className="group flex gap-6">
                                                  <div className="flex-shrink-0 w-24">
                                                      <span className="text-sm font-mono font-bold text-indigo-500 bg-indigo-50 px-2 py-1 rounded border border-indigo-100 block text-center">
                                                          {seg.timestamp}
                                                      </span>
                                                  </div>
                                                  <div className="flex-1 border-l-2 border-slate-100 pl-6 group-hover:border-indigo-200 transition-colors">
                                                      <p className="text-lg text-slate-800 leading-snug font-medium">
                                                          {seg.text}
                                                      </p>
                                                  </div>
                                              </div>
                                          ))}
                                      </div>
                                  </div>
                              </article>
                          );
                      })}
                  </div>
              </main>

              <footer className="bg-slate-50 border-t border-slate-200 py-12 px-8 mt-24">
                  <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-8">
                      <div className="flex items-center gap-2 opacity-50">
                          <BrainCircuit className="w-5 h-5" />
                          <span className="font-bold text-sm">SlideAlign AI</span>
                      </div>
                      <p className="text-xs text-slate-400 text-center md:text-right leading-relaxed max-w-sm">
                          Engineered with Gemini 3 Pro Thinking Mode. Precise visual-to-audio temporal alignment pipeline.
                      </p>
                  </div>
              </footer>
          </div>
      );
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-6">
      <div className="max-w-4xl w-full grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
        
        <div className="space-y-8">
            <div className="inline-flex items-center gap-2 bg-indigo-50 text-indigo-600 px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest">
                <BrainCircuit className="w-4 h-4" /> Multi-Modal Alignment
            </div>
            <h1 className="text-5xl font-extrabold text-slate-900 tracking-tight leading-none">
                SlideAlign <span className="text-indigo-600">AI</span>
            </h1>
            <p className="text-xl text-slate-500 leading-relaxed max-w-md">
                Generate high-fidelity speaker notes and study guides by aligning your presentation slides with transcripts using Gemini 3.
            </p>
            
            <div className="space-y-4 pt-4">
                <div className="flex items-center gap-3 text-sm text-slate-600">
                    <CheckCircle className="w-5 h-5 text-emerald-500" />
                    <span>Visual OCR & Slide Content Analysis</span>
                </div>
                <div className="flex items-center gap-3 text-sm text-slate-600">
                    <CheckCircle className="w-5 h-5 text-emerald-500" />
                    <span>Temporal Transcript Mapping</span>
                </div>
                <div className="flex items-center gap-3 text-sm text-slate-600">
                    <CheckCircle className="w-5 h-5 text-emerald-500" />
                    <span>AI-Generated Conceptual Frameworks</span>
                </div>
            </div>
        </div>

        <div className="bg-slate-50 border border-slate-200 rounded-3xl p-8 shadow-2xl space-y-8">
            <div className="space-y-6">
                <div className="flex flex-wrap gap-2">
                    {[InputMode.AUDIO_FILE, InputMode.ASS, InputMode.SRT, InputMode.VTT, InputMode.TEXT].map(mode => (
                        <button 
                            key={mode}
                            onClick={() => setInputMode(mode)}
                            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${inputMode === mode ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' : 'bg-white text-slate-500 border-slate-200 hover:border-indigo-300'}`}
                        >
                            {mode}
                        </button>
                    ))}
                </div>

                <div className="space-y-4">
                    <div className="relative group">
                        <div className={`border-2 border-dashed rounded-2xl p-6 flex flex-col items-center justify-center text-center transition-all ${transcriptFile || audioFile ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-slate-200 hover:border-indigo-400'}`}>
                            {inputMode === InputMode.AUDIO_FILE ? <Mic className="w-8 h-8 text-indigo-500 mb-2" /> : <FileText className="w-8 h-8 text-indigo-500 mb-2" />}
                            <span className="text-sm font-bold text-slate-800">
                                {inputMode === InputMode.AUDIO_FILE ? (audioFile ? audioFile.name : "Select Audio File") : (transcriptFile ? transcriptFile.name : `Select ${inputMode} File`)}
                            </span>
                            <input type="file" accept={getAcceptAttribute()} onChange={inputMode === InputMode.AUDIO_FILE ? handleAudioUpload : handleTranscriptUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                        </div>
                    </div>

                    <div className="relative group">
                        <div className={`border-2 border-dashed rounded-2xl p-6 flex flex-col items-center justify-center text-center transition-all ${slides.length > 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-slate-200 hover:border-emerald-400'}`}>
                            <ImageIcon className="w-8 h-8 text-emerald-500 mb-2" />
                            <span className="text-sm font-bold text-slate-800">
                                {slides.length > 0 ? `${slides.length} Slides Uploaded` : "Select Slides (PNG/JPG)"}
                            </span>
                            <input type="file" multiple accept="image/*" onChange={handleSlidesUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                        </div>
                    </div>
                </div>
            </div>

            {error && <div className="p-3 bg-red-50 text-red-600 rounded-xl text-xs flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {error}</div>}

            <button 
                onClick={startProcessing}
                disabled={processing.step !== 'upload'}
                className="w-full bg-slate-900 text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-3 hover:bg-black transition-all disabled:opacity-50 disabled:cursor-not-allowed group shadow-xl"
            >
                {processing.step === 'upload' ? (
                    <>Process Pipeline <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" /></>
                ) : (
                    <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        <span className="text-sm">{processing.statusMessage}</span>
                    </>
                )}
            </button>

            {processing.step !== 'upload' && (
                <div className="space-y-2">
                    <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
                        <span>{processing.step.replace('_', ' ')}</span>
                        <span>{Math.round(processing.progress)}%</span>
                    </div>
                    <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-500 transition-all duration-500" style={{ width: `${processing.progress}%` }} />
                    </div>
                </div>
            )}
        </div>
      </div>
    </div>
  );
};

export default App;
