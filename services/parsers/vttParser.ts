import { SubtitleLine } from '../../types';
import { parseTime } from '../parserService';

const cleanVttText = (text: string): string => {
  // Remove tags like <v Speaker>, <b>, etc.
  return text.replace(/<[^>]*>/g, '').trim();
};

const extractSpeaker = (text: string): { speaker: string, text: string } => {
    // VTT voice spans: <v Speaker Name>Text
    const match = text.match(/^<v\s+([^>]+)>(.*)/);
    if (match) {
        return { speaker: match[1].trim(), text: match[2] };
    }
    // Simple "Speaker: Text" pattern check
    const simpleMatch = text.match(/^([^:]+):\s+(.*)/);
    if (simpleMatch) {
        return { speaker: simpleMatch[1].trim(), text: simpleMatch[2] };
    }
    return { speaker: 'Unknown', text };
};

export const parseVttFile = async (file: File): Promise<SubtitleLine[]> => {
  const text = await file.text();
  const lines: SubtitleLine[] = [];
  
  const blocks = text.replace(/\r\n/g, '\n').split(/\n\n+/);

  for (const block of blocks) {
    const linesInBlock = block.trim().split('\n');
    if (linesInBlock.length === 0) continue;
    if (linesInBlock[0].startsWith('WEBVTT')) continue;
    if (linesInBlock[0].startsWith('NOTE')) continue;

    let timeLineIdx = -1;
    for(let i=0; i<linesInBlock.length; i++) {
        if (linesInBlock[i].includes('-->')) {
            timeLineIdx = i;
            break;
        }
    }

    if (timeLineIdx !== -1) {
        const timeLine = linesInBlock[timeLineIdx];
        const [startStr, endStr] = timeLine.split('-->');
        
        // Remove settings from end string (e.g. align:start size:50%)
        const cleanEndStr = endStr.trim().split(' ')[0];

        const rawText = linesInBlock.slice(timeLineIdx + 1).join(' ');
        const cleanedText = cleanVttText(rawText);
        const { speaker, text: content } = extractSpeaker(cleanedText);

        if (startStr && cleanEndStr && content) {
            lines.push({
                start: parseTime(startStr),
                end: parseTime(cleanEndStr),
                speaker: speaker,
                text: content
            });
        }
    }
  }

  return lines;
};