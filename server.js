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
const PORT = process.env.PORT || 3095;

app.use(cors());
app.use(express.json());


app.use(express.static(path.join(__dirname, 'public')));
app.use('/outputs', express.static(path.join(__dirname, 'public', 'outputs')));


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


app.post('/api/plan-scenes', async (req, res) => {
  const { prompt, sceneCount, modelId } = req.body;
  if (!prompt || !sceneCount) {
    return res.status(400).json({ success: false, message: '프롬프트와 씬 개수를 지정해주세요.' });
  }

  const videoId = uuid.v4();
  console.log(`[Plan] Request received. VideoID: ${videoId}, Scenes: ${sceneCount}, Model: ${modelId}`);

  try {
    await dbHelper.createVideo(videoId, prompt, sceneCount);
    

    const plannedScenes = await geminiHelper.planScenes(prompt, sceneCount, modelId);
    

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


app.get('/api/stream-generation', async (req, res) => {
  const { videoId } = req.query;
  if (!videoId) {
    return res.status(400).write('data: {"error": "videoId가 필요합니다."}\n\n');
  }


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


    const firstScene = scenes.find(s => s.sceneNum === 1);
    let baseCharacterDetails = firstScene ? firstScene.characterDetails : '';

    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];


      const localImgPath = path.join(__dirname, 'public', scene.imageUrl || '');
      const localAudPath = path.join(__dirname, 'public', scene.audioUrl || '');
      
      if (scene.status === 'completed' && scene.imageUrl && scene.audioUrl && fs.existsSync(localImgPath) && fs.existsSync(localAudPath)) {
        console.log(`[Cache Hit] Scene ${scene.sceneNum} already generated. Skipping API call.`);
        res.write(`data: ${JSON.stringify({ type: 'progress', scene: scene })}\n\n`);
        continue;
      }


      await dbHelper.updateScene(videoId, scene.sceneNum, { status: 'generating' });
      res.write(`data: ${JSON.stringify({ type: 'status', sceneNum: scene.sceneNum, status: 'generating' })}\n\n`);


      if (scene.sceneNum > 1 && !baseCharacterDetails && firstScene) {

        const updatedFirstScene = await dbHelper.getScene(videoId, 1);
        if (updatedFirstScene) {
          baseCharacterDetails = updatedFirstScene.characterDetails;
        }
      }
      
      const currentCharacterDetails = baseCharacterDetails || scene.characterDetails;


      const imageUrl = await geminiHelper.generateImageForScene(
        scene.sceneNum,
        scene.visualDescription,
        currentCharacterDetails,
        videoId
      );


      const audioUrl = await ttsHelper.generateTTS(
        scene.sceneNum,
        scene.ttsText,
        videoId
      );


      const fullAudioPath = path.join(__dirname, 'public', audioUrl);
      const duration = await ffmpegHelper.getAudioDuration(fullAudioPath, scene.ttsText);


      await dbHelper.updateScene(videoId, scene.sceneNum, {
        imageUrl,
        audioUrl,
        duration,
        status: 'completed'
      });

      const updatedScene = await dbHelper.getScene(videoId, scene.sceneNum);
      

      res.write(`data: ${JSON.stringify({ type: 'progress', scene: updatedScene })}\n\n`);


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
              '-shortest'
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


    const mergedPath = path.join(outputDir, 'merged_temp.mp4');
    await ffmpegHelper.concatVideos(piecePaths, mergedPath);


    const subtitlePath = path.join(outputDir, 'video.srt');
    await ffmpegHelper.buildSRTAndBurn(mergedPath, scenes, finalVideoPath, subtitlePath);


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


function prepareDummyResources() {
  const publicDir = path.join(__dirname, 'public');
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true });
  }

  const dummyJpg = path.join(publicDir, 'dummy.jpg');
  if (!fs.existsSync(dummyJpg)) {

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
