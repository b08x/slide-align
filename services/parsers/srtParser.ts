import { SubtitleLine } from '../../types';
import { parseTime } from '../parserService';

const cleanSrtText = (text: string): string => {
  // Remove HTML tags like <i>, <b>, <font>
  return text.replace(/<[^>]*>/g, '').trim();
};

export const parseSrtFile = async (file: File): Promise<SubtitleLine[]> => {
  const text = await file.text();
  const lines: SubtitleLine[] = [];
  
  // Normalize line endings and split by double newline
  const blocks = text.replace(/\r\n/g, '\n').split(/\n\n+/);

  for (const block of blocks) {
    const linesInBlock = block.trim().split('\n');
    if (linesInBlock.length < 2) continue;

    // Line 1 is usually ID, Line 2 is Time, Line 3+ is Text
    // Sometimes ID is missing or merged, so check for arrow
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
        
        const textContent = linesInBlock.slice(timeLineIdx + 1).join(' ');
        
        if (startStr && endStr && textContent) {
            lines.push({
                start: parseTime(startStr),
                end: parseTime(endStr),
                speaker: 'Unknown', // SRT usually doesn't strictly define speakers
                text: cleanSrtText(textContent)
            });
        }
    }
  }

  return lines;
};