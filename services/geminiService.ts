import { GoogleGenAI, Schema, Type } from "@google/genai";
import { SlideData, SubtitleLine, FinalOutput } from "../types";
import { secondsToHms } from "./parserService";

const fileToGenerativePart = async (file: File) => {
  const base64EncodedDataPromise = new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.readAsDataURL(file);
  });
  return {
    inlineData: {
      data: await base64EncodedDataPromise,
      mimeType: file.type,
    },
  };
};

export const transcribeAudio = async (audioFile: File, apiKey: string): Promise<SubtitleLine[]> => {
  if (!apiKey) throw new Error("API Key is required");
  const ai = new GoogleGenAI({ apiKey });
  
  // Use Flash for audio transcription
  const audioPart = await fileToGenerativePart(audioFile);
  
  const prompt = `
    You are an expert transcriber. 
    Transcribe the following audio file accurately. 
    Identify different speakers if possible.
    
    Output strictly in JSON format as a list of objects:
    [
      { "start": number (seconds), "end": number (seconds), "speaker": "string", "text": "string" }
    ]
    Do not wrap in markdown code blocks. Just the raw JSON.
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: {
        parts: [audioPart, { text: prompt }]
    },
    config: {
        responseMimeType: 'application/json'
    }
  });

  const text = response.text || "[]";
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error("Failed to parse audio transcription", e);
    return [];
  }
};

export const analyzeSlideImage = async (slide: SlideData, apiKey: string): Promise<string> => {
    if (!apiKey) throw new Error("API Key is required");
    const ai = new GoogleGenAI({ apiKey });

    const imagePart = await fileToGenerativePart(slide.file);
    const prompt = "Describe this presentation slide in detail. Transcribe all visible text exactly as it appears. Identify any charts, diagrams, or images.";

    // Use Flash for quick visual analysis
    const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: {
            parts: [imagePart, { text: prompt }]
        }
    });

    return response.text || "No analysis available.";
};

export const generateFinalReport = async (
    transcript: SubtitleLine[], 
    slides: SlideData[], 
    apiKey: string
): Promise<FinalOutput> => {
    if (!apiKey) throw new Error("API Key is required");
    const ai = new GoogleGenAI({ apiKey });

    // Prepare Transcript Text
    let transText = transcript.map(ln => 
        `${secondsToHms(ln.start)} --> ${secondsToHms(ln.end)} | ${ln.speaker} | ${ln.text}`
    ).join('\n');
    
    // Truncate if too massive
    if (transText.length > 80000) {
        transText = transText.substring(0, 80000) + "\n...[TRUNCATED]";
    }

    // Prepare Slides Text
    const slidesRepr = slides.map(s => {
        const timeStr = s.startTime !== undefined ? secondsToHms(s.startTime) : "unknown";
        return `Filename: ${s.filename} | Timestamp: ${timeStr}\nVisual Analysis & OCR:\n${s.analysis}\n---`;
    }).join('\n\n');

    const systemPrompt = `
You are an expert assistant for producing speaker notes and aligning transcripts to slides.

INPUTS:
TRANSCRIPT (timestamp | speaker | text):
${transText}

SLIDES INFO (filename, inferred time, visual analysis):
${slidesRepr}

TASKS:
1) Extract 3-10 key topics.
2) For each slide, produce:
   - aligned_segments: A list of 2-5 fine-grained transcript excerpts that directly relate to the content of this slide. Each segment MUST include its original timestamp from the transcript.
   - speaker_note: A short summary (1-2 sentences) of the context for this slide.
   - broll: 2-3 visual asset suggestions.
3) Ensure every slide is accounted for.

OUTPUT JSON FORMAT:
{
  "topics": [ { "id": "t1", "title": "...", "description": "...", "keywords": ["..."] } ],
  "slides": { 
     "filename_example.png": { 
        "speaker_note": "...", 
        "aligned_segments": [
           { "timestamp": "0:00:12.50", "text": "..." },
           { "timestamp": "0:00:15.20", "text": "..." }
        ],
        "broll": ["...", "..."], 
        "topics": ["t1"] 
     } 
  },
  "composite": [] 
}
`;

    const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: systemPrompt,
        config: {
            responseMimeType: 'application/json',
            thinkingConfig: {
                thinkingBudget: 32768
            }
        }
    });

    const text = response.text || "{}";
    try {
        return JSON.parse(text);
    } catch (e) {
        console.error("Failed to parse final report", e);
        throw new Error("Failed to generate valid JSON report.");
    }
};
