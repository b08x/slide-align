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
  AlertCircle
} from 'lucide-react';
import { SubtitleLine, SlideData, ProcessingState, FinalOutput, InputMode } from './types';
import { parseAssFile, inferTimeFromFilename } from './services/parserService';
import { analyzeSlideImage, generateFinalReport, transcribeAudio } from './services/geminiService';

const App: React.FC = () => {
  // State
  const [inputMode, setInputMode] = useState<InputMode>(InputMode.ASS_FILE);
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
  const handleSlidesUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newSlides: SlideData[] = Array.from(e.target.files).map((f: File) => ({
        id: Math.random().toString(36).substring(7),
        file: f,
        filename: f.name,
        startTime: inferTimeFromFilename(f.name),
        status: 'pending' as const
      })).sort((a, b) => (a.filename > b.filename ? 1 : -1)); // Simple sort
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

    if (inputMode === InputMode.ASS_FILE && !transcriptFile) {
        setError("Please upload a .ass transcript file.");
        return;
    }
    if (inputMode === InputMode.AUDIO_FILE && !audioFile) {
        setError("Please upload an audio file.");
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
      // 1. Process Transcript Source
      let transcriptLines: SubtitleLine[] = [];
      
      if (inputMode === InputMode.AUDIO_FILE && audioFile) {
        setProcessing(p => ({ ...p, step: 'transcribing_audio', statusMessage: 'Transcribing audio (Gemini Flash)...' }));
        transcriptLines = await transcribeAudio(audioFile, apiKey);
      } else if (inputMode === InputMode.ASS_FILE && transcriptFile) {
        setProcessing(p => ({ ...p, statusMessage: 'Parsing subtitle file...' }));
        transcriptLines = await parseAssFile(transcriptFile);
      }

      if (transcriptLines.length === 0) {
        throw new Error("No transcript data found. Check your input file.");
      }

      // 2. Process Slides (Parallel but batched to avoid rate limits if necessary, 
      // but pure parallel is usually fine for <15 RPM on free tier, paid tier higher)
      // We'll do simple parallel for now.
      setProcessing(p => ({ ...p, step: 'analyzing_slides', statusMessage: 'Analyzing slides with Vision...' }));
      
      const processedSlides = [...slides];
      let completed = 0;

      // Use a concurrency limit? Let's just do chunks of 3 for safety
      const chunkSize = 3;
      for (let i = 0; i < processedSlides.length; i += chunkSize) {
          const chunk = processedSlides.slice(i, i + chunkSize);
          await Promise.all(chunk.map(async (slide) => {
              try {
                  slide.status = 'processing';
                  // Force update UI for status
                  setSlides([...processedSlides]);
                  
                  const analysis = await analyzeSlideImage(slide, apiKey);
                  slide.analysis = analysis;
                  slide.status = 'done';
              } catch (e) {
                  console.error(e);
                  slide.status = 'error';
                  slide.analysis = "Error analyzing slide.";
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

      // 3. Final Alignment (Thinking Model)
      setProcessing(p => ({ ...p, step: 'generating_report', statusMessage: 'Aligning content with Gemini Pro Thinking Mode (this may take a minute)...' }));
      const report = await generateFinalReport(transcriptLines, processedSlides, apiKey);
      
      setFinalOutput(report);
      setProcessing(p => ({ ...p, step: 'complete', statusMessage: 'Done!' }));

    } catch (err: any) {
      console.error(err);
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
    a.download = 'slide_align_report.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Render Helpers
  const renderStepIcon = (step: ProcessingState['step']) => {
      switch(step) {
          case 'upload': return <Upload className="w-6 h-6 text-gray-400" />;
          case 'analyzing_slides': return <ImageIcon className="w-6 h-6 text-blue-500 animate-pulse" />;
          case 'transcribing_audio': return <FileAudio className="w-6 h-6 text-purple-500 animate-pulse" />;
          case 'generating_report': return <BrainCircuit className="w-6 h-6 text-amber-500 animate-spin" />;
          case 'complete': return <CheckCircle className="w-6 h-6 text-green-500" />;
      }
  };

  // Views
  if (finalOutput) {
      return (
          <div className="min-h-screen bg-slate-50 flex flex-col">
              <header className="bg-white border-b border-slate-200 px-6 py-4 sticky top-0 z-10 flex items-center justify-between shadow-sm">
                  <div className="flex items-center gap-3">
                      <div className="bg-indigo-600 p-2 rounded-lg">
                          <BrainCircuit className="w-6 h-6 text-white" />
                      </div>
                      <h1 className="text-xl font-bold text-slate-800">SlideAlign Report</h1>
                  </div>
                  <div className="flex gap-3">
                      <button onClick={() => window.location.reload()} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-900 font-medium">Start Over</button>
                      <button onClick={downloadReport} className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
                          <Download className="w-4 h-4" /> Export JSON
                      </button>
                  </div>
              </header>
              
              <main className="flex-1 max-w-7xl mx-auto w-full p-6 grid grid-cols-1 lg:grid-cols-4 gap-8">
                  {/* Sidebar Topics */}
                  <aside className="lg:col-span-1 space-y-6">
                      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm sticky top-24">
                          <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-4">Key Topics</h2>
                          <div className="space-y-3">
                              {finalOutput.topics.map(topic => (
                                  <div key={topic.id} className="group">
                                      <h3 className="font-semibold text-slate-800 group-hover:text-indigo-600 transition-colors">{topic.title}</h3>
                                      <p className="text-xs text-slate-500 line-clamp-2 mt-1">{topic.description}</p>
                                  </div>
                              ))}
                          </div>
                      </div>
                  </aside>

                  {/* Main Content */}
                  <div className="lg:col-span-3 space-y-12">
                      {finalOutput.composite.map((item, idx) => {
                          const slideInfo = finalOutput.slides[item.slide];
                          const originalSlide = slides.find(s => s.filename === item.slide);
                          
                          return (
                              <div key={idx} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col md:flex-row">
                                  {/* Visual Column */}
                                  <div className="md:w-1/3 bg-slate-100 p-4 flex flex-col items-center justify-center border-b md:border-b-0 md:border-r border-slate-200">
                                      {originalSlide ? (
                                          <img 
                                            src={URL.createObjectURL(originalSlide.file)} 
                                            alt={item.slide} 
                                            className="rounded-lg shadow-md max-h-48 object-contain"
                                          />
                                      ) : (
                                          <div className="w-full h-32 flex items-center justify-center text-slate-400 text-xs">Image missing</div>
                                      )}
                                      <span className="text-xs font-mono text-slate-500 mt-3 truncate max-w-full px-2">{item.slide}</span>
                                  </div>

                                  {/* Content Column */}
                                  <div className="flex-1 p-6 space-y-6">
                                      <div>
                                          <h4 className="text-xs font-bold text-indigo-600 uppercase tracking-wider mb-2">Speaker Notes</h4>
                                          <p className="text-slate-800 leading-relaxed text-sm md:text-base bg-indigo-50/50 p-3 rounded-lg border border-indigo-100">
                                              {slideInfo?.speaker_note || item.speaker_note}
                                          </p>
                                      </div>

                                      <div>
                                          <h4 className="text-xs font-bold text-emerald-600 uppercase tracking-wider mb-2">Transcript Excerpt</h4>
                                          <p className="text-slate-600 text-sm italic border-l-4 border-emerald-200 pl-3">
                                              "{slideInfo?.aligned_transcript || item.paraphrase}"
                                          </p>
                                      </div>

                                      {slideInfo?.broll && slideInfo.broll.length > 0 && (
                                          <div>
                                              <h4 className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-2">B-Roll Suggestions</h4>
                                              <div className="flex flex-wrap gap-2">
                                                  {slideInfo.broll.map((b, i) => (
                                                      <span key={i} className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                                                          {b}
                                                      </span>
                                                  ))}
                                              </div>
                                          </div>
                                      )}
                                  </div>
                              </div>
                          );
                      })}
                  </div>
              </main>
          </div>
      );
  }

  // Upload & Processing View
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50/30 flex items-center justify-center p-4">
      <div className="max-w-4xl w-full bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden flex flex-col md:flex-row min-h-[600px]">
        
        {/* Left Panel: Info & Status */}
        <div className="md:w-1/3 bg-slate-900 text-white p-8 flex flex-col justify-between relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
                <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                    <path d="M0 100 C 20 0 50 0 100 100 Z" fill="white" />
                </svg>
            </div>
            
            <div className="relative z-10">
                <div className="flex items-center gap-2 mb-6">
                    <div className="bg-indigo-500 p-2 rounded-lg">
                        <BrainCircuit className="w-6 h-6 text-white" />
                    </div>
                    <span className="text-lg font-bold tracking-tight">SlideAlign AI</span>
                </div>
                <h1 className="text-3xl font-light leading-tight mb-4">
                    Transform your <span className="font-bold text-indigo-400">Slides</span> & <span className="font-bold text-indigo-400">Audio</span> into study guides.
                </h1>
                <p className="text-slate-400 text-sm leading-relaxed">
                    Uses <strong>Gemini 2.5 Flash</strong> for rapid vision/audio analysis and <strong>Gemini 3 Pro</strong> (Thinking Mode) for deep alignment logic.
                </p>
            </div>

            <div className="relative z-10 space-y-6">
                 {/* Progress Indicator */}
                 <div className="space-y-2">
                    <div className="flex justify-between text-xs font-medium text-slate-400">
                        <span>STATUS</span>
                        <span>{processing.processedSlides}/{processing.totalSlides} SLIDES</span>
                    </div>
                    <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div 
                            className="h-full bg-indigo-500 transition-all duration-500 ease-out" 
                            style={{ width: `${processing.progress}%` }}
                        />
                    </div>
                    <div className="flex items-center gap-2 text-sm text-indigo-200 h-6">
                        {processing.step !== 'upload' && processing.step !== 'complete' && <Loader2 className="w-3 h-3 animate-spin" />}
                        <span className="truncate">{processing.statusMessage || "Waiting for input..."}</span>
                    </div>
                 </div>
            </div>
        </div>

        {/* Right Panel: Inputs */}
        <div className="md:w-2/3 p-8 flex flex-col space-y-8 overflow-y-auto">
            
            {/* Input Toggle */}
            <div className="bg-slate-100 p-1 rounded-xl inline-flex w-full">
                <button 
                    onClick={() => setInputMode(InputMode.ASS_FILE)}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all ${inputMode === InputMode.ASS_FILE ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    <FileText className="w-4 h-4" /> Transcript (.ass)
                </button>
                <button 
                    onClick={() => setInputMode(InputMode.AUDIO_FILE)}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all ${inputMode === InputMode.AUDIO_FILE ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    <FileAudio className="w-4 h-4" /> Audio File
                </button>
            </div>

            {/* File Inputs */}
            <div className="space-y-4">
                {inputMode === InputMode.ASS_FILE ? (
                    <div className="relative group">
                         <div className={`border-2 border-dashed border-slate-200 rounded-xl p-6 flex flex-col items-center justify-center text-center transition-colors hover:border-indigo-400 ${transcriptFile ? 'bg-indigo-50/30 border-indigo-200' : ''}`}>
                            <FileText className={`w-8 h-8 mb-2 ${transcriptFile ? 'text-indigo-500' : 'text-slate-300'}`} />
                            <p className="text-sm font-medium text-slate-700">{transcriptFile ? transcriptFile.name : "Drop .ass file here"}</p>
                            <p className="text-xs text-slate-400 mt-1">or click to browse</p>
                            <input type="file" accept=".ass" onChange={handleTranscriptUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                         </div>
                    </div>
                ) : (
                    <div className="relative group">
                         <div className={`border-2 border-dashed border-slate-200 rounded-xl p-6 flex flex-col items-center justify-center text-center transition-colors hover:border-indigo-400 ${audioFile ? 'bg-indigo-50/30 border-indigo-200' : ''}`}>
                            <FileAudio className={`w-8 h-8 mb-2 ${audioFile ? 'text-indigo-500' : 'text-slate-300'}`} />
                            <p className="text-sm font-medium text-slate-700">{audioFile ? audioFile.name : "Drop audio file here"}</p>
                            <p className="text-xs text-slate-400 mt-1">MP3, WAV, etc.</p>
                            <input type="file" accept="audio/*" onChange={handleAudioUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                         </div>
                    </div>
                )}

                <div className="relative group">
                     <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 flex flex-col items-center justify-center text-center transition-colors hover:border-indigo-400">
                        <ImageIcon className="w-8 h-8 mb-2 text-slate-300" />
                        <p className="text-sm font-medium text-slate-700">
                            {slides.length > 0 ? `${slides.length} slides selected` : "Upload Slides"}
                        </p>
                        <p className="text-xs text-slate-400 mt-1">PNG, JPG (Multiple)</p>
                        <input type="file" multiple accept="image/*" onChange={handleSlidesUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                     </div>
                </div>

                {/* Slides Preview Grid (Mini) */}
                {slides.length > 0 && (
                    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                        {slides.map(s => (
                            <div key={s.id} className="relative w-16 h-12 flex-shrink-0 bg-slate-100 rounded border border-slate-200 overflow-hidden">
                                <img src={URL.createObjectURL(s.file)} className="w-full h-full object-cover opacity-80" />
                                {s.status === 'done' && <div className="absolute inset-0 bg-green-500/20 flex items-center justify-center"><CheckCircle className="w-4 h-4 text-green-600" /></div>}
                                {s.status === 'processing' && <div className="absolute inset-0 bg-blue-500/20 flex items-center justify-center"><Loader2 className="w-4 h-4 text-blue-600 animate-spin" /></div>}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Error Message */}
            {error && (
                <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    {error}
                </div>
            )}

            {/* Action */}
            <div className="mt-auto">
                <button 
                    onClick={startProcessing}
                    disabled={processing.step !== 'upload' && processing.step !== 'complete'}
                    className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold py-4 rounded-xl shadow-lg shadow-indigo-200 transition-all flex items-center justify-center gap-2"
                >
                    {processing.step === 'upload' || processing.step === 'complete' ? (
                        <>
                            <Play className="w-5 h-5 fill-current" /> 
                            Generate Alignment
                        </>
                    ) : (
                        <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            Processing...
                        </>
                    )}
                </button>
            </div>
        </div>

      </div>
    </div>
  );
};

export default App;