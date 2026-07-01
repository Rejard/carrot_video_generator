const googleTTS = require('google-tts-api');
const fs = require('fs');
const path = require('path');

async function generateTTS(sceneNum, text, videoId) {
  const outputDir = path.join(__dirname, 'public', 'outputs', videoId);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, `scene_${sceneNum}.mp3`);
  const relativePath = `/outputs/${videoId}/scene_${sceneNum}.mp3`;

  try {
    console.log(`[Scene ${sceneNum}] Generating TTS for text: "${text.substring(0, 20)}..."`);
    

    const cleanText = text.substring(0, 180);
    
    const base64 = await googleTTS.getAudioBase64(cleanText, {
      lang: 'ko',
      slow: false,
      host: 'https://translate.google.com',
      timeout: 10000,
    });

    fs.writeFileSync(outputPath, Buffer.from(base64, 'base64'));
    console.log(`[Scene ${sceneNum}] TTS Generated: ${outputPath}`);
    return relativePath;
  } catch (error) {
    console.error(`❌ [Scene ${sceneNum}] TTS generation failed:`, error.message);
    console.log('💡 Generating fallback (silent) audio...');
    

    const dummySrc = path.join(__dirname, 'public', 'dummy.mp3');
    if (fs.existsSync(dummySrc)) {
      fs.copyFileSync(dummySrc, outputPath);
    } else {

      const silentMp3 = Buffer.from(
        'SUQzBAAAAAAAAFRYWFgAAAASAAADbWFqb3JfYnJhbmQAbXA0MgBUWFhYAAAAEQAAA21pbm9yX3ZlcnNpb24AMABUWFhYAAAAHAAAAGNvbXBhdGlibGVfYnJhbmRzAG1wNDJpc29tAFRFTkMAAAAQAADbTGFtZTMuMTAwA//uQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 
        'base64'
      );
      fs.writeFileSync(outputPath, silentMp3);
    }
    return relativePath;
  }
}

module.exports = {
  generateTTS
};
