const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const uuid = require('uuid');

const dbHelper = require('./dbHelper');
const geminiHelper = require('./geminiHelper');
const ttsHelper = require('./ttsHelper');
const ffmpegHelper = require('./ffmpegHelper');

const app = express();
const PORT = 3095;

app.use(cors());
app.use(express.json());

// public 정적 서빙 및 outputs 정적 서빙
app.use(express.static(path.join(__dirname, 'public')));
app.use('/outputs', express.static(path.join(__dirname, 'public', 'outputs')));

// 1. 사용 가능한 AI 모델 조회
app.get('/api/models', (req, res) => {
  const configPath = 'c:\\home\\alopop\\config\\ai_models.json';
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      const models = JSON.parse(data);
      return res.json({ success: true, models });
    }
  } catch (e) {
    console.error('Failed to read ai_models.json:', e.message);
  }
  
  // 기본 폴백 모델 목록
  res.json({
    success: true,
    models: {
      gemini: [
        { id: "gemini-3.1-flash-lite-preview", name: "Gemini 3.1 Flash-Lite (Default)" },
        { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash" }
      ],
      openai: [
        { id: "gpt-5.4-nano", name: "GPT-5.4 Nano" }
      ]
    }
  });
});

// 2. 1단계: 시나리오 아웃라인 기획
app.post('/api/plan-scenes', async (req, res) => {
  const { prompt, sceneCount, modelId } = req.body;
  if (!prompt || !sceneCount) {
    return res.status(400).json({ success: false, message: '프롬프트와 씬 개수를 지정해주세요.' });
  }

  const videoId = uuid.v4();
  console.log(`[Plan] Request received. VideoID: ${videoId}, Scenes: ${sceneCount}, Model: ${modelId}`);

  try {
    await dbHelper.createVideo(videoId, prompt, sceneCount);
    
    // Gemini API 호출하여 시나리오 생성
    const plannedScenes = await geminiHelper.planScenes(prompt, sceneCount, modelId);
    
    // 생성된 기획안 DB 일괄 저장
    await dbHelper.savePlannedScenes(videoId, plannedScenes);
    await dbHelper.updateVideoStatus(videoId, 'planned');

    res.json({
      success: true,
      videoId,
      scenes: plannedScenes
    });
  } catch (error) {
    console.error('Failed to plan scenes:', error);
    res.status(500).json({ success: false, message: '시나리오 기획에 실패했습니다.' });
  }
});

// 3. 2/3단계: 비동기 루프 및 실시간 SSE 전송
app.get('/api/stream-generation', async (req, res) => {
  const { videoId } = req.query;
  if (!videoId) {
    return res.status(400).write('data: {"error": "videoId가 필요합니다."}\n\n');
  }

  // SSE 헤더 설정
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  console.log(`[Stream] Client connected to SSE for videoId: ${videoId}`);

  try {
    const video = await dbHelper.getVideo(videoId);
    if (!video) {
      res.write(`data: ${JSON.stringify({ error: '존재하지 않는 비디오 작업입니다.' })}\n\n`);
      return res.end();
    }

    await dbHelper.updateVideoStatus(videoId, 'generating');
    const scenes = await dbHelper.getScenes(videoId);

    // 1번 씬의 캐릭터 묘사를 미리 찾아봅니다 (일관성 보장용)
    const firstScene = scenes.find(s => s.sceneNum === 1);
    let baseCharacterDetails = firstScene ? firstScene.characterDetails : '';

    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];

      // SQLite 캐싱 확인: 이미 성공 완료(completed)이고 이미지/오디오 파일이 둘 다 실재하는지 확인
      const localImgPath = path.join(__dirname, 'public', scene.imageUrl || '');
      const localAudPath = path.join(__dirname, 'public', scene.audioUrl || '');
      
      if (scene.status === 'completed' && scene.imageUrl && scene.audioUrl && fs.existsSync(localImgPath) && fs.existsSync(localAudPath)) {
        console.log(`[Cache Hit] Scene ${scene.sceneNum} already generated. Skipping API call.`);
        res.write(`data: ${JSON.stringify({ type: 'progress', scene: scene })}\n\n`);
        continue;
      }

      // 생성 중 상태 알림
      await dbHelper.updateScene(videoId, scene.sceneNum, { status: 'generating' });
      res.write(`data: ${JSON.stringify({ type: 'status', sceneNum: scene.sceneNum, status: 'generating' })}\n\n`);

      // 1번 씬이 아닌 경우, 1번 씬의 인물 묘사를 바탕으로 일관성 유지
      if (scene.sceneNum > 1 && !baseCharacterDetails && firstScene) {
        // 만약 1번 씬이 방금 완료되었다면 해당 묘사를 확보
        const updatedFirstScene = await dbHelper.getScene(videoId, 1);
        if (updatedFirstScene) {
          baseCharacterDetails = updatedFirstScene.characterDetails;
        }
      }
      
      const currentCharacterDetails = baseCharacterDetails || scene.characterDetails;

      // 이미지 생성 진행 (visualDescription 활용)
      const imageUrl = await geminiHelper.generateImageForScene(
        scene.sceneNum,
        scene.visualDescription,
        currentCharacterDetails,
        videoId
      );

      // TTS 오디오 생성 진행 (실제 대사 ttsText 활용)
      const audioUrl = await ttsHelper.generateTTS(
        scene.sceneNum,
        scene.ttsText,
        videoId
      );

      // 오디오 시간 측정
      const fullAudioPath = path.join(__dirname, 'public', audioUrl);
      const duration = await ffmpegHelper.getAudioDuration(fullAudioPath, scene.ttsText);

      // DB 정보 업데이트
      await dbHelper.updateScene(videoId, scene.sceneNum, {
        imageUrl,
        audioUrl,
        duration,
        status: 'completed'
      });

      const updatedScene = await dbHelper.getScene(videoId, scene.sceneNum);
      
      // 클라이언트에 결과 전송
      res.write(`data: ${JSON.stringify({ type: 'progress', scene: updatedScene })}\n\n`);

      // API 속도 제한(Rate Limit) 방지를 위한 명상(1.5초)
      await delay(1500);
    }

    await dbHelper.updateVideoStatus(videoId, 'completed');
    res.write('data: [DONE]\n\n');
  } catch (error) {
    console.error('SSE loop failed:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
  } finally {
    res.end();
  }
});

// 4. 5단계: FFmpeg 믹싱 및 최종 영상 렌더링
app.post('/api/render-video', async (req, res) => {
  const { videoId } = req.body;
  if (!videoId) {
    return res.status(400).json({ success: false, message: 'videoId가 필요합니다.' });
  }

  const outputDir = path.join(__dirname, 'public', 'outputs', videoId);
  const finalVideoName = `final_${videoId}.mp4`;
  const finalVideoPath = path.join(outputDir, finalVideoName);
  const finalVideoUrl = `/outputs/${videoId}/${finalVideoName}`;

  try {
    const scenes = await dbHelper.getScenes(videoId);
    const pendingScenes = scenes.filter(s => s.status !== 'completed');
    if (pendingScenes.length > 0) {
      return res.status(400).json({ success: false, message: '아직 완료되지 않은 씬이 있습니다.' });
    }

    console.log(`[Render] Starting video compile for VideoID: ${videoId}`);
    
    // 개별 씬 비디오 조각 만들기 (Google Veo 모션 비디오 시도 후 FFmpeg 줌팬 폴백)
    const piecePaths = [];
    for (const scene of scenes) {
      const imgPath = path.join(__dirname, 'public', scene.imageUrl);
      const audPath = path.join(__dirname, 'public', scene.audioUrl);
      const piecePath = path.join(outputDir, `scene_${scene.sceneNum}_piece.mp4`);
      
      console.log(`[Render] Attempting Image-to-Video motion generation for scene ${scene.sceneNum}...`);
      const motionVideoUrl = await geminiHelper.generateVideoForScene(
        scene.sceneNum,
        scene.imageUrl,
        scene.visualDescription,
        videoId
      );

      if (motionVideoUrl) {
        console.log(`[Render] Successfully generated Veo motion video for scene ${scene.sceneNum}. Merging with audio...`);
        const fullMotionVideoPath = path.join(__dirname, 'public', motionVideoUrl);
        
        // 생성된 모션 비디오(무음)에 씬 오디오(TTS)를 믹싱하여 조각 비디오로 활용
        await new Promise((resolve, reject) => {
          const ffmpeg = require('fluent-ffmpeg');
          const installer = require('@ffmpeg-installer/ffmpeg');
          ffmpeg.setFfmpegPath(installer.path);
          ffmpeg()
            .input(fullMotionVideoPath)
            .input(audPath)
            .outputOptions([
              '-c:v copy',
              '-c:a aac',
              '-b:a 192k',
              '-shortest' // 더 짧은 스트림 길이에 맞춤 (비디오와 오디오 싱크 일치)
            ])
            .save(piecePath)
            .on('end', resolve)
            .on('error', (err) => {
              console.error(`❌ [Render] Failed to merge audio to motion video ${scene.sceneNum}:`, err.message);
              reject(err);
            });
        });
      } else {
        console.log(`[Render] Creating still-image scene piece with cinematic zoompan for scene ${scene.sceneNum}...`);
        await ffmpegHelper.createSceneVideo(imgPath, audPath, piecePath, scene.duration || 3.0);
      }
      
      piecePaths.push(piecePath);
    }

    // 비디오 조각들 합치기
    const mergedPath = path.join(outputDir, 'merged_temp.mp4');
    await ffmpegHelper.concatVideos(piecePaths, mergedPath);

    // 자막(SRT) 파일 경로 지정 및 생성 후 오버레이 자막 입히기
    const subtitlePath = path.join(outputDir, 'video.srt');
    await ffmpegHelper.buildSRTAndBurn(mergedPath, scenes, finalVideoPath, subtitlePath);

    // 임시 파일 청소 (디스크 용량 최적화)
    try {
      fs.unlinkSync(mergedPath);
      piecePaths.forEach(p => fs.unlinkSync(p));
      console.log('[Render] Cleaned up temporary video pieces.');
    } catch (e) {
      console.warn('[Render] Failed to clean up some temporary files:', e.message);
    }

    res.json({
      success: true,
      videoUrl: finalVideoUrl,
      srtUrl: `/outputs/${videoId}/video.srt`
    });
  } catch (error) {
    console.error('Failed to render final video:', error);
    res.status(500).json({ success: false, message: `비디오 컴파일 중 에러가 발생했습니다: ${error.message}` });
  }
});

// 폴백 및 더미 리소스 준비 (서버 구동 시 생성)
function prepareDummyResources() {
  const publicDir = path.join(__dirname, 'public');
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  const dummyJpg = path.join(publicDir, 'dummy.jpg');
  if (!fs.existsSync(dummyJpg)) {
    // 1x1 투명 또는 검정 JPEG 바이너리 생성해두기
    const dummyJpgBytes = Buffer.from(
      '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 
      'base64'
    );
    fs.writeFileSync(dummyJpg, dummyJpgBytes);
  }

  const dummyMp3 = path.join(publicDir, 'dummy.mp3');
  if (!fs.existsSync(dummyMp3)) {
    const dummyMp3Bytes = Buffer.from(
      'SUQzBAAAAAAAAFRYWFgAAAASAAADbWFqb3JfYnJhbmQAbXA0MgBUWFhYAAAAEQAAA21pbm9yX3ZlcnNpb24AMABUWFhYAAAAHAAAAGNvbXBhdGlibGVfYnJhbmRzAG1wNDJpc29tAFRFTkMAAAAQAADbTGFtZTMuMTAwA//uQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 
      'base64'
    );
    fs.writeFileSync(dummyMp3, dummyMp3Bytes);
  }
}

async function start() {
  prepareDummyResources();
  await dbHelper.initDB();
  
  app.listen(PORT, () => {
    console.log(`==================================================================`);
    console.log(`🔥 Video Agent Backend server started successfully at http://localhost:${PORT}`);
    console.log(`==================================================================`);
  });
}

start();
