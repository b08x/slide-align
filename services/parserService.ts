export const parseTime = (timeStr: string): number => {
  // Replace comma with dot for SRT format compatibility (00:00:20,000)
  const normalized = timeStr.trim().replace(',', '.');
  const parts = normalized.split(':');
  
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return parseInt(h, 10) * 3600 + parseInt(m, 10) * 60 + parseFloat(s);
  } else if (parts.length === 2) {
    const [m, s] = parts;
    return parseInt(m, 10) * 60 + parseFloat(s);
  }
  return 0;
};

export const secondsToHms = (seconds?: number): string => {
  if (seconds === undefined || seconds === null) return "unknown";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${m.toString().padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
};

export const inferTimeFromFilename = (filename: string): number | undefined => {
  // Matches patterns like slide_00_10_05.png or 10-05.png
  const m = filename.match(/(\d+)[-_:](\d+)[-_:](\d+)/);
  if (m) {
    const [_, h, m2, s] = m;
    return parseInt(h) * 3600 + parseInt(m2) * 60 + parseInt(s);
  }
  const m2 = filename.match(/(\d+)[-_:](\d+)/);
  if (m2) {
     const [_, m, s] = m2;
     return parseInt(m) * 60 + parseInt(s);
  }
  return undefined;
};