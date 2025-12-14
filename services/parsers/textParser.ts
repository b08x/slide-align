import { SubtitleLine } from '../../types';

export const parseTextFile = async (file: File): Promise<SubtitleLine[]> => {
  const text = await file.text();
  const lines: SubtitleLine[] = [];
  
  // Split by double newlines to denote paragraphs
  const paragraphs = text.replace(/\r\n/g, '\n').split(/\n\n+/);

  paragraphs.forEach((para) => {
    const trimmed = para.trim();
    if (trimmed) {
        // Plain text has no timestamps. 
        // We set 0 so the model relies on the text content for alignment logic.
        lines.push({
            start: 0,
            end: 0, 
            speaker: 'Unknown',
            text: trimmed
        });
    }
  });

  return lines;
};