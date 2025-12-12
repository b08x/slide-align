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
    model: 'gemini-2.5-flash',
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
        model: 'gemini-2.5-flash',
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
    
    // Truncate if too massive (though Gemini Pro context is large, good practice)
    if (transText.length > 50000) {
        transText = transText.substring(0, 50000) + "\n...[TRUNCATED]";
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
1) Extract key topics (3-10).
2) Map transcript segments and slides to topics.
3) For each slide, produce:
   - Speaker note (2-3 sentences summary of what is being said related to this slide)
   - Aligned transcript excerpt (paraphrased or direct quote that best matches this slide)
   - 2 B-roll suggestions
4) Produce a composite list for the final report.

IMPORTANT: Ensure every slide provided in the input is represented in the 'slides' object and 'composite' list.

OUTPUT JSON FORMAT:
{
  "topics": [ { "id": "t1", "title": "...", "description": "...", "keywords": ["..."] } ],
  "slides": { 
     "filename_example.png": { 
        "speaker_note": "...", 
        "aligned_transcript": "...", 
        "broll": ["...", "..."], 
        "topics": ["t1"] 
     } 
  },
  "composite": [ 
     { "slide": "filename_example.png", "speaker_note": "...", "paraphrase": "..." } 
  ]
}
`;

    // Use Gemini 3 Pro with Thinking for complex alignment reasoning
    const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: systemPrompt,
        config: {
            responseMimeType: 'application/json',
            thinkingConfig: {
                thinkingBudget: 32768 // Max thinking for complex alignment
            }
        }
    });

    const text = response.text || "{}";
    console.log("Raw Model Response:", text);

    try {
        return JSON.parse(text);
    } catch (e) {
        console.error("Failed to parse final report", e);
        throw new Error("Failed to generate valid JSON report.");
    }
};
