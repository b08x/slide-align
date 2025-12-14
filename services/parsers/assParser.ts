import { SubtitleLine } from '../../types';
import { parseTime } from '../parserService';

const cleanAssText = (text: string): string => {
  return text.replace(/\{.*?\}/g, '').replace(/\\N/g, ' ').trim();
};

export const parseAssFile = async (file: File): Promise<SubtitleLine[]> => {
  const text = await file.text();
  const lines: SubtitleLine[] = [];
  const content = text.split(/\r?\n/);
  
  let eventsSection = false;
  let formatIdx: Record<string, number> | null = null;

  for (let ln of content) {
    ln = ln.trim();
    if (ln.toLowerCase().startsWith('[events]')) {
      eventsSection = true;
      continue;
    }
    if (!eventsSection) continue;

    if (ln.toLowerCase().startsWith('format:')) {
      const fields = ln.substring(7).split(',').map(f => f.trim().toLowerCase());
      formatIdx = {};
      fields.forEach((field, index) => {
        if (formatIdx) formatIdx[field] = index;
      });
      continue;
    }

    if (ln.toLowerCase().startsWith('dialogue:')) {
      const payload = ln.substring(9).trimLeft();
      
      if (!formatIdx) {
        // Fallback assumption
        const parts = payload.split(',');
        if (parts.length >= 9) { // Standard ASS often has 9+ fields
             try {
                lines.push({
                    start: parseTime(parts[1]),
                    end: parseTime(parts[2]),
                    speaker: parts[4]?.trim() || 'Unknown',
                    text: cleanAssText(parts.slice(9).join(','))
                });
             } catch (e) { console.warn("Failed to parse line", ln); }
        }
      } else {
        // Precise parsing
        // The last field (Text) might contain commas, so we split by the number of fields - 1
        const parts = payload.split(',');
        // Re-join the text part if it was split
        const textIdx = formatIdx['text'];
        const numFields = Object.keys(formatIdx).length;
        
        // If split resulted in more parts than defined formats, merge the end
        let actualParts = parts;
        if (parts.length > numFields) {
           const infoParts = parts.slice(0, numFields - 1);
           const textPart = parts.slice(numFields - 1).join(',');
           actualParts = [...infoParts, textPart];
        }

        try {
          const start = parseTime(actualParts[formatIdx['start']].trim());
          const end = parseTime(actualParts[formatIdx['end']].trim());
          const speaker = actualParts[formatIdx['name'] || formatIdx['actor'] || 4]?.trim() || 'Unknown';
          const rawText = actualParts[textIdx] || "";
          
          lines.push({
            start,
            end,
            speaker,
            text: cleanAssText(rawText)
          });
        } catch (e) {
             console.warn("Failed to parse dynamic line", ln);
        }
      }
    }
  }
  
  return lines;
};