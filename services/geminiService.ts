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
  const audioPart = await fileToGenerativePart(audioFile);
  
  const prompt = `
    You are an expert transcriber. 
    Transcribe the following audio file accurately. 
    Identify different speakers if possible.
    
    Output strictly in JSON format as a list of objects:
    [
      { "start": number (seconds), "end": number (seconds), "speaker": "string", "text": "string" }
    ]
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

  try {
    return JSON.parse(response.text || "[]");
  } catch (e) {
    return [];
  }
};

export const analyzeSlideImage = async (slide: SlideData, apiKey: string): Promise<string> => {
    if (!apiKey) throw new Error("API Key is required");
    const ai = new GoogleGenAI({ apiKey });
    const imagePart = await fileToGenerativePart(slide.file);
    const prompt = "Analyze this presentation slide. Extract text and summarize the key visual components and purpose.";

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

    const transText = transcript.map(ln => 
        `[${secondsToHms(ln.start)}] ${ln.speaker}: ${ln.text}`
    ).join('\n');
    
    const slidesRepr = slides.map(s => {
        const timeStr = s.startTime !== undefined ? secondsToHms(s.startTime) : "unknown";
        return `Filename: ${s.filename} | Base Timestamp: ${timeStr}\nContent:\n${s.analysis}\n---`;
    }).join('\n\n');

    const systemPrompt = `
You are an expert alignment engine. You produce a CHRONOLOGICAL TIMELINE of a presentation based on audio transcripts and slide visuals.

INPUTS:
TRANSCRIPT:
${transText}

SLIDES DATA:
${slidesRepr}

INSTRUCTIONS:
1. Create a "timeline" which is an array of entries.
2. Each entry corresponds to a slide being presented at a specific point in time.
3. IMPORTANT: A slide (filename) may appear MULTIPLE TIMES in the timeline if the speaker returns to it later or if the slide covers separate disconnected segments of audio.
4. For each timeline entry, provide:
   - slide: The filename.
   - aligned_segments: 1-4 specific lines from the transcript that match this occurrence. Include their exact timestamps.
   - speaker_note: A high-level context note.
   - broll: Visual asset keywords.
   - topics: Array of IDs from the "topics" section.
5. Create a "topics" list of 3-6 main concepts discussed.

OUTPUT JSON FORMAT:
{
  "topics": [ { "id": "t1", "title": "...", "description": "..." } ],
  "timeline": [
     {
        "slide": "filename.png",
        "speaker_note": "...",
        "aligned_segments": [ { "timestamp": "0:00:10", "text": "..." } ],
        "broll": ["image of X"],
        "topics": ["t1"]
     }
  ]
}
`;

    const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: systemPrompt,
        config: {
            responseMimeType: 'application/json',
            thinkingConfig: { thinkingBudget: 32768 }
        }
    });

    try {
        return JSON.parse(response.text || "{}");
    } catch (e) {
        throw new Error("Alignment engine produced invalid response.");
    }
};
