// Reads audio file format info for the file source.

import { debugLog } from './util.js';

export function parseWavHeader(arrayBuffer) {
  try {
    const view = new DataView(arrayBuffer);
    // Check for "RIFF"
    if (view.getUint32(0, false) !== 0x52494646) return null; 
    // Check for "WAVE"
    if (view.getUint32(8, false) !== 0x57415645) return null; 
    
    // Search for "fmt " chunk
    let offset = 12;
    while (offset < view.byteLength) {
      const chunkId = view.getUint32(offset, false);
      const chunkSize = view.getUint32(offset + 4, true);
      
      if (chunkId === 0x666d7420) { // "fmt "
        const audioFormat = view.getUint16(offset + 8, true);
        const numChannels = view.getUint16(offset + 10, true);
        const sampleRate = view.getUint32(offset + 12, true);
        const byteRate = view.getUint32(offset + 16, true);
        const blockAlign = view.getUint16(offset + 20, true);
        const bitsPerSample = view.getUint16(offset + 22, true);
        
        let formatString = 'Unknown';
        switch (audioFormat) {
          case 1: formatString = 'PCM'; break;
          case 3: formatString = 'IEEE Float'; break;
          case 6: formatString = 'A-Law'; break;
          case 7: formatString = 'Mu-Law'; break;
          case 0xFFFE: formatString = 'Extensible'; break;
          default: formatString = `Format ${audioFormat}`;
        }

        return { 
          audioFormat: formatString,
          sampleRate, 
          numberOfChannels: numChannels, 
          byteRate,
          blockAlign,
          bitsPerSample 
        };
      }
      
      offset += 8 + chunkSize;
    }
  } catch (e) {
    console.error('Error parsing WAV header:', e);
  }
  return null;
}

export async function getAudioFileMetadata(source) {
  try {
    const response = await fetch(source);
    const arrayBuffer = await response.arrayBuffer();
    
    // Try to parse WAV header first for accurate sample rate
    const wavData = parseWavHeader(arrayBuffer);
    if (wavData) {
      debugLog('Got metadata from WAV header:', wavData);
      return wavData;
    }

    // Fallback to decodeAudioData (might be resampled)
    // Use OfflineAudioContext to decode without affecting main audio context
    const tempCtx = new OfflineAudioContext(1, 1, 44100);
    const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);
    return {
      sampleRate: audioBuffer.sampleRate + ' (resampled)',
      numberOfChannels: audioBuffer.numberOfChannels,
      bitsPerSample: 'Unknown (float32)'
    };
  } catch (e) {
    console.error('Error getting file metadata:', e);
    return null;
  }
}
