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
  ChevronRight,
  Info,
  Layers,
  Sparkles,
  Search
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
      setError("Gemini API Key missing.");
      return;
    }
    
    if (slides.length === 0) {
      setError("Upload at least one slide.");
      return;
    }

    setError(null);
    setProcessing({
      step: 'analyzing_slides',
      progress: 0,
      totalSlides: slides.length,
      processedSlides: 0,
      statusMessage: 'Initializing pipeline...'
    });

    try {
      let transcriptLines: SubtitleLine[] = [];
      
      if (inputMode === InputMode.AUDIO_FILE && audioFile) {
        setProcessing(p => ({ ...p, step: 'transcribing_audio', statusMessage: 'Transcribing audio...' }));
        transcriptLines = await transcribeAudio(audioFile, apiKey);
      } else if (transcriptFile) {
        setProcessing(p => ({ ...p, statusMessage: `Parsing ${inputMode}...` }));
        switch (inputMode) {
            case InputMode.ASS: transcriptLines = await parseAssFile(transcriptFile); break;
            case InputMode.SRT: transcriptLines = await parseSrtFile(transcriptFile); break;
            case InputMode.VTT: transcriptLines = await parseVttFile(transcriptFile); break;
            case InputMode.TEXT: transcriptLines = await parseTextFile(transcriptFile); break;
        }
      }

      setProcessing(p => ({ ...p, step: 'analyzing_slides', statusMessage: 'Vision Analysis...' }));
      const processedSlides = [...slides];
      let completed = 0;
      for (const slide of processedSlides) {
          slide.status = 'processing';
          setSlides([...processedSlides]);
          slide.analysis = await analyzeSlideImage(slide, apiKey);
          slide.status = 'done';
          completed++;
          setProcessing(p => ({ 
              ...p, 
              processedSlides: completed, 
              progress: (completed / p.totalSlides) * 100 
          }));
      }

      setProcessing(p => ({ ...p, step: 'generating_report', statusMessage: 'Timeline Alignment...' }));
      const report = await generateFinalReport(transcriptLines, processedSlides, apiKey);
      setFinalOutput(report);
      setProcessing(p => ({ ...p, step: 'complete', statusMessage: 'Success' }));
    } catch (err: any) {
      setError(err.message || "Pipeline error.");
      setProcessing(p => ({ ...p, step: 'upload', statusMessage: 'Failed' }));
    }
  };

  // Views
  if (finalOutput) {
      return (
          <div className="min-h-screen bg-white flex flex-col text-slate-900">
              <header className="bg-slate-950 text-white px-8 py-5 sticky top-0 z-30 flex items-center justify-between border-b border-white/10 shadow-2xl">
                  <div className="flex items-center gap-4">
                      <div className="bg-indigo-600 p-2 rounded-xl shadow-indigo-500/20 shadow-lg">
                          <BrainCircuit className="w-6 h-6" />
                      </div>
                      <div>
                        <h1 className="text-xl font-black tracking-tighter">SlideAlign <span className="text-indigo-400 italic">Timeline</span></h1>
                        <p className="text-[10px] text-slate-400 uppercase font-bold tracking-widest leading-none mt-1">AI-Powered Temporal Alignment</p>
                      </div>
                  </div>
                  <div className="flex gap-4">
                      <button onClick={handleStartOver} className="px-5 py-2 text-xs font-bold text-slate-400 hover:text-white transition-all uppercase tracking-widest">Start Over</button>
                      <button onClick={() => window.print()} className="bg-white text-slate-950 hover:bg-slate-100 px-6 py-2.5 rounded-full text-xs font-black uppercase tracking-widest transition-all shadow-xl active:scale-95">
                          Download PDF
                      </button>
                  </div>
              </header>
              
              <main className="flex-1 max-w-5xl mx-auto w-full p-12 space-y-32">
                  {/* Executive Summary / Topics */}
                  <section className="bg-slate-50 border border-slate-200/60 rounded-3xl p-8 relative overflow-hidden group">
                      <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:scale-110 transition-transform">
                          <Layers className="w-32 h-32" />
                      </div>
                      <h2 className="text-[10px] font-black text-indigo-600 uppercase tracking-widest mb-6 flex items-center gap-2">
                         <Sparkles className="w-4 h-4" /> The Conceptual Framework
                      </h2>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 relative z-10">
                          {finalOutput.topics.map(topic => (
                              <div key={topic.id} className="space-y-1">
                                  <h3 className="font-bold text-slate-900 text-lg tracking-tight">{topic.title}</h3>
                                  <p className="text-sm text-slate-500 leading-relaxed">{topic.description}</p>
                              </div>
                          ))}
                      </div>
                  </section>

                  {/* Linear Timeline Stream */}
                  <div className="space-y-32 relative">
                      {/* Decorative Line */}
                      <div className="absolute left-[20%] top-0 bottom-0 w-px bg-slate-100 hidden lg:block -z-10" />

                      {finalOutput.timeline.map((entry, idx) => {
                          const originalSlide = slides.find(s => s.filename === entry.slide);
                          if (!originalSlide) return null;
                          
                          return (
                              <article key={idx} className="grid grid-cols-1 lg:grid-cols-5 gap-16 items-start">
                                  {/* Visual Side */}
                                  <div className="lg:col-span-2 space-y-6">
                                      <div className="relative group">
                                          <div className="absolute -top-4 -left-4 bg-slate-950 text-white w-10 h-10 flex items-center justify-center rounded-2xl text-xs font-black shadow-2xl z-20 group-hover:bg-indigo-600 transition-colors">
                                              {idx + 1}
                                          </div>
                                          <div className="rounded-2xl overflow-hidden shadow-[0_32px_64px_-16px_rgba(0,0,0,0.15)] border border-slate-100 group-hover:translate-y-[-4px] transition-transform duration-500">
                                            <img 
                                              src={URL.createObjectURL(originalSlide.file)} 
                                              alt={entry.slide} 
                                              className="w-full"
                                            />
                                          </div>
                                          <div className="mt-4 flex justify-between px-2">
                                              <span className="text-[10px] font-mono text-slate-300 uppercase tracking-tighter">{entry.slide}</span>
                                              <div className="flex gap-1">
                                                {entry.topics.map(tid => <div key={tid} className="w-2 h-2 rounded-full bg-slate-200" title={tid} />)}
                                              </div>
                                          </div>
                                      </div>

                                      {/* De-emphasized metadata */}
                                      <div className="space-y-4 px-2 opacity-60 hover:opacity-100 transition-opacity">
                                          <div className="space-y-1">
                                              <h4 className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Speaker Notes</h4>
                                              <p className="text-xs text-slate-600 leading-relaxed">{entry.speaker_note}</p>
                                          </div>
                                          <div className="flex flex-wrap gap-2">
                                              {entry.broll.map((tag, i) => (
                                                  <span key={i} className="text-[9px] font-bold text-slate-400 bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded uppercase tracking-tighter">
                                                      {tag}
                                                  </span>
                                              ))}
                                          </div>
                                      </div>
                                  </div>

                                  {/* Transcript Side */}
                                  <div className="lg:col-span-3 space-y-10 pt-4">
                                      <h4 className="text-[10px] font-black text-slate-300 uppercase tracking-widest flex items-center gap-3">
                                          <div className="h-px bg-slate-100 flex-1" />
                                          Linear Transcript Alignment
                                          <div className="h-px bg-slate-100 flex-1" />
                                      </h4>
                                      <div className="space-y-12">
                                          {entry.aligned_segments.map((seg, sIdx) => (
                                              <div key={sIdx} className="group relative">
                                                  <div className="flex flex-col gap-3">
                                                      <div className="inline-flex items-center gap-2 bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-xl border border-indigo-100/50 w-fit">
                                                          <Clock className="w-3.5 h-3.5" />
                                                          <span className="text-xs font-black tracking-tighter tabular-nums">{seg.timestamp}</span>
                                                      </div>
                                                      <p className="text-xl md:text-2xl text-slate-800 leading-snug font-medium group-hover:text-black transition-colors">
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

              <footer className="bg-slate-50 border-t border-slate-100 py-20 px-8">
                  <div className="max-w-5xl mx-auto flex flex-col items-center text-center gap-6">
                      <BrainCircuit className="w-8 h-8 text-slate-200" />
                      <p className="text-xs text-slate-400 font-bold uppercase tracking-widest max-w-sm leading-relaxed">
                          Synchronized visual-temporal analysis pipeline generated via Gemini 3.0 Ultra-Pro Reasoning.
                      </p>
                  </div>
              </footer>
          </div>
      );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="max-w-4xl w-full bg-white rounded-[40px] shadow-[0_64px_128px_-32px_rgba(0,0,0,0.1)] border border-slate-100 overflow-hidden flex flex-col md:flex-row min-h-[640px]">
        
        {/* Brand Side */}
        <div className="md:w-2/5 bg-slate-950 p-12 flex flex-col justify-between text-white relative">
            <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-600/20 blur-[100px] -mr-32 -mt-32 rounded-full" />
            <div className="relative z-10 space-y-8">
                <div className="flex items-center gap-3">
                    <div className="bg-indigo-600 p-2.5 rounded-2xl">
                        <BrainCircuit className="w-7 h-7" />
                    </div>
                    <span className="text-xl font-black tracking-tighter">SlideAlign <span className="text-indigo-400 italic">Timeline</span></span>
                </div>
                <h2 className="text-4xl font-bold leading-[1.1] tracking-tight">
                    Synchronize your <span className="text-indigo-500">voice</span> with your <span className="text-indigo-500">vision</span>.
                </h2>
                <p className="text-slate-400 text-sm leading-relaxed">
                    A deep-learning pipeline that maps slide images to transcript timestamps for high-fidelity alignment.
                </p>
            </div>

            <div className="relative z-10 space-y-6">
                 <div className="space-y-2">
                    <div className="flex justify-between text-[10px] font-black text-slate-500 uppercase tracking-widest">
                        <span>Pipeline Status</span>
                        <span>{Math.round(processing.progress)}%</span>
                    </div>
                    <div className="h-1 bg-white/10 rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-500 transition-all duration-700 shadow-[0_0_12px_rgba(99,102,241,0.5)]" style={{ width: `${processing.progress}%` }} />
                    </div>
                    <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest animate-pulse min-h-[1em]">
                        {processing.step !== 'upload' ? processing.statusMessage : ''}
                    </p>
                 </div>
            </div>
        </div>

        {/* Input Side */}
        <div className="md:w-3/5 p-12 flex flex-col gap-10">
            <div className="space-y-4">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Select Input Source</label>
                <div className="flex flex-wrap gap-2">
                    {[InputMode.AUDIO_FILE, InputMode.ASS, InputMode.SRT, InputMode.VTT, InputMode.TEXT].map(mode => (
                        <button 
                            key={mode}
                            onClick={() => setInputMode(mode)}
                            className={`px-4 py-2 rounded-xl text-[10px] font-black tracking-widest uppercase transition-all border ${inputMode === mode ? 'bg-indigo-600 text-white border-indigo-600 shadow-xl' : 'bg-white text-slate-500 border-slate-100 hover:border-slate-300'}`}
                        >
                            {mode.replace('_', ' ')}
                        </button>
                    ))}
                </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
                <div className="relative group">
                    <div className={`border-2 border-dashed rounded-3xl p-8 flex flex-col items-center justify-center text-center transition-all ${transcriptFile || audioFile ? 'bg-indigo-50 border-indigo-200' : 'bg-slate-50 border-slate-100 hover:border-indigo-400 group-hover:scale-[1.01]'}`}>
                        <div className="p-4 bg-white rounded-2xl shadow-sm mb-4">
                            {inputMode === InputMode.AUDIO_FILE ? <Mic className="w-6 h-6 text-indigo-500" /> : <FileText className="w-6 h-6 text-indigo-500" />}
                        </div>
                        <span className="text-sm font-bold text-slate-900 leading-none">
                            {inputMode === InputMode.AUDIO_FILE ? (audioFile ? audioFile.name : "Audio Source") : (transcriptFile ? transcriptFile.name : `${inputMode} Source`)}
                        </span>
                        <p className="text-[10px] text-slate-400 mt-2 font-bold uppercase tracking-widest">Click to Upload</p>
                        <input type="file" onChange={inputMode === InputMode.AUDIO_FILE ? handleAudioUpload : handleTranscriptUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                    </div>
                </div>

                <div className="relative group">
                    <div className={`border-2 border-dashed rounded-3xl p-8 flex flex-col items-center justify-center text-center transition-all ${slides.length > 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-100 hover:border-emerald-400 group-hover:scale-[1.01]'}`}>
                        <div className="p-4 bg-white rounded-2xl shadow-sm mb-4">
                            <ImageIcon className="w-6 h-6 text-emerald-500" />
                        </div>
                        <span className="text-sm font-bold text-slate-900 leading-none">
                            {slides.length > 0 ? `${slides.length} Slides Uploaded` : "Presentation Images"}
                        </span>
                        <p className="text-[10px] text-slate-400 mt-2 font-bold uppercase tracking-widest">PNG, JPG, JPEG</p>
                        <input type="file" multiple accept="image/*" onChange={handleSlidesUpload} className="absolute inset-0 opacity-0 cursor-pointer" />
                    </div>
                </div>
            </div>

            {error && <div className="p-4 bg-red-50 text-red-600 rounded-2xl text-[10px] font-bold uppercase tracking-widest flex items-center gap-3"><AlertCircle className="w-4 h-4" /> {error}</div>}

            <button 
                onClick={startProcessing}
                disabled={processing.step !== 'upload'}
                className="w-full bg-slate-950 text-white font-black py-5 rounded-3xl flex items-center justify-center gap-4 hover:bg-black transition-all disabled:opacity-30 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.3)] active:scale-95 group mt-auto"
            >
                {processing.step === 'upload' ? (
                    <><span className="uppercase tracking-widest text-xs">Run Alignment Pipeline</span> <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" /></>
                ) : (
                    <Loader2 className="w-6 h-6 animate-spin" />
                )}
            </button>
        </div>
      </div>
    </div>
  );
};

export default App;
