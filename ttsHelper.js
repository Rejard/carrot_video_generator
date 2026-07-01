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
    
    // 한국어 텍스트 TTS 요청 (최대 200자 제한 우려를 방지하기 위해 텍스트 길이 자르거나 처리)
    const cleanText = text.substring(0, 180); // google-tts-api 단일 요청 제한 200자 준수
    
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
    
    // 폴백: 1초 가량의 무음 혹은 더미 MP3 파일 제공
    const dummySrc = path.join(__dirname, 'public', 'dummy.mp3');
    if (fs.existsSync(dummySrc)) {
      fs.copyFileSync(dummySrc, outputPath);
    } else {
      // 1초 무음 MP3의 유효한 바이너리
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
