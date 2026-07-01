const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');

// .env 로드 (API 키 참조용)
require('dotenv').config({ override: true });

// 시스템 환경 변수 GEMINI_API_KEY 로드
const apiKey = process.env.GEMINI_API_KEY;
let ai = null;

if (apiKey) {
  ai = new GoogleGenAI({ apiKey });
} else {
  console.warn('⚠️ WARNING: GEMINI_API_KEY is not defined. The app will run in fallback mock mode.');
}

// 1. 1단계: 씬 아웃라인 기획
async function planScenes(prompt, sceneCount, modelId = 'gemini-3.1-flash-lite-preview') {
  if (!ai) {
    return generateMockScenes(prompt, sceneCount);
  }

  const systemInstruction = `너는 전문 비디오 시나리오 기획 에이전트다. 사용자가 제공한 스토리를 바탕으로 전체 비디오를 ${sceneCount}개의 상세한 장면(scenes)의 JSON 배열로 기획해라. 
  각 장면은 순서대로 다음 필드를 가져야 한다:
  1. sceneNum (1부터 시작하는 정수)
  2. visualDescription (이 장면에 대한 구체적인 시각적 미술 상황 묘사 - 이미지/비디오 생성 프롬프트로 사용됨)
  3. ttsText (성우가 읽을 실제 인물 대사 혹은 해설 나레이션 - 오디오 생성 및 자막 파일로 사용됨)
  4. characterDetails (주인공 및 등장인물의 머리색, 옷 스타일 등 세부 외모 특징 - 매 씬마다 일관되게 묘사되어야 함)
  
  주의: visualDescription에는 '장면 1에서...' 같은 설명조 문구를 쓰지 말고 순수한 물리적 카메라 뷰 및 배경 상황만 영어 또는 한국어로 풍부하게 적어라.
  ttsText에는 지문을 쓰지 말고, 인물이 직접 하는 대사(예: "모두 전투 준비를 해라!") 또는 해설자 나레이션 문구만 정갈하게 적어라.`;

  const jsonSchema = {
    type: "ARRAY",
    items: {
      type: "OBJECT",
      properties: {
        sceneNum: { type: "INTEGER" },
        visualDescription: { type: "STRING" },
        ttsText: { type: "STRING" },
        characterDetails: { type: "STRING" }
      },
      required: ["sceneNum", "visualDescription", "ttsText", "characterDetails"]
    }
  };

  try {
    const response = await ai.models.generateContent({
      model: modelId,
      contents: [
        { role: 'user', parts: [{ text: `사용자 스토리: ${prompt}` }] }
      ],
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: jsonSchema,
      }
    });

    const text = response.text;
    console.log('Plan Scenes Output:', text);
    return JSON.parse(text);
  } catch (error) {
    console.error('❌ Failed to plan scenes via Gemini API:', error);
    console.log('💡 Falling back to Mock Scene Generator...');
    return generateMockScenes(prompt, sceneCount);
  }
}

// 2/3단계: 씬별 이미지 생성 (캐릭터 및 화풍 일관성 적용)
async function generateImageForScene(sceneNum, sceneDescription, baseCharacterDetails, videoId) {
  const outputDir = path.join(__dirname, 'public', 'outputs', videoId);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const outputPath = path.join(outputDir, `scene_${sceneNum}.jpg`);
  const relativePath = `/outputs/${videoId}/scene_${sceneNum}.jpg`;

  if (!ai) {
    await saveMockImage(outputPath, sceneNum);
    return relativePath;
  }

  // 1번 씬의 캐릭터 묘사를 공유하여 얼굴 일관성 유지하고 시네마틱 3D 애니메이션 아트 스타일 적용
  const artStyle = "Cinematic 3D animation, Unreal Engine 5 render, highly detailed, octane render, 8k resolution, volumetric lighting, colorful lighting, 16:9 aspect ratio";
  const prompt = `Prompt: ${sceneDescription}. Character Reference Details: ${baseCharacterDetails}. Theme Style: ${artStyle}`;

  try {
    console.log(`[Scene ${sceneNum}] Generating Image via Imagen 3...`);
    const response = await ai.models.generateImages({
      model: 'imagen-3.0-generate-002',
      prompt: prompt,
      config: {
        numberOfImages: 1,
        outputMimeType: 'image/jpeg',
        aspectRatio: '16:9',
      },
    });

    if (response && response.generatedImages && response.generatedImages[0]) {
      const base64Data = response.generatedImages[0].image.imageBytes;
      fs.writeFileSync(outputPath, Buffer.from(base64Data, 'base64'));
      console.log(`[Scene ${sceneNum}] Image Generated: ${outputPath}`);
      return relativePath;
    } else {
      throw new Error('No image bytes returned from Imagen API');
    }
  } catch (error) {
    console.error(`❌ [Scene ${sceneNum}] Imagen generation failed:`, error.message);
    console.log('💡 Generating fallback AI image from Pollinations...');
    const success = await saveFallbackAIImage(outputPath, sceneDescription);
    if (!success) {
      console.log('💡 Fallback to copying local mock image...');
      await saveMockImage(outputPath, sceneNum);
    }
    return relativePath;
  }
}

// Pollinations AI를 통한 무료 이미지 생성 폴백
async function saveFallbackAIImage(filePath, prompt) {
  try {
    const artStyle = "Cinematic 3D animation, Unreal Engine 5 render, highly detailed, octane render, 8k resolution, volumetric lighting, colorful lighting, 16:9 aspect ratio";
    const fullPrompt = `${prompt}. Theme Style: ${artStyle}`;
    const encodedPrompt = encodeURIComponent(fullPrompt);
    const url = `https://image.pollinations.ai/p/${encodedPrompt}?width=1280&height=720&seed=${Math.floor(Math.random() * 1000000)}&nologo=true`;
    console.log(`[Fallback AI Image] Requesting from Pollinations: ${url}`);
    
    const response = await fetch(url);
    if (response.ok) {
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      fs.writeFileSync(filePath, buffer);
      console.log(`[Fallback AI Image] Successfully created and saved: ${filePath}`);
      return true;
    } else {
      console.warn(`[Fallback AI Image] Pollinations returned status: ${response.status}`);
    }
  } catch (e) {
    console.error(`[Fallback AI Image] Failed to fetch fallback image:`, e.message);
  }
  return false;
}
// 2.5단계: Google Veo / Imagen Video API를 사용한 Image-to-Video 생성
async function generateVideoForScene(sceneNum, imageRelativePath, sceneDescription, videoId) {
  const outputDir = path.join(__dirname, 'public', 'outputs', videoId);
  const inputImagePath = path.join(__dirname, 'public', imageRelativePath);
  const outputPath = path.join(outputDir, `scene_${sceneNum}_motion.mp4`);
  const relativePath = `/outputs/${videoId}/scene_${sceneNum}_motion.mp4`;

  if (!ai) {
    console.log(`[Scene ${sceneNum}] Fallback: No AI key. Using static image.`);
    return null; // 백엔드에서 null을 감지하면 FFmpeg zoompan으로 대체
  }

  try {
    console.log(`[Scene ${sceneNum}] Calling Google Veo (Image-to-Video) API...`);
    const imgBuffer = fs.readFileSync(inputImagePath);
    const imgBase64 = imgBuffer.toString('base64');

    // 최신 Google GenAI Veo API 호출 형식
    // 일부 계정은 veo-2.0-generate-001 모델 접근이 가능하며, 
    // 실패 시 404/403 에러 핸들러가 FFmpeg 무빙으로 즉시 롤백을 제어합니다.
    const response = await ai.models.generateVideos({
      model: 'veo-2.0-generate-001',
      prompt: `A beautiful cinematic panning motion video of: ${sceneDescription}. Keep characters consistent. Smooth motion.`,
      config: {
        durationSeconds: 5,
        aspectRatio: '16:9',
        inputImage: {
          imageBytes: imgBase64,
          mimeType: 'image/jpeg'
        }
      }
    });

    if (response && response.generatedVideos && response.generatedVideos[0]) {
      const videoBytes = response.generatedVideos[0].video.videoBytes;
      fs.writeFileSync(outputPath, Buffer.from(videoBytes, 'base64'));
      console.log(`[Scene ${sceneNum}] Veo Video generated: ${outputPath}`);
      return relativePath;
    } else {
      throw new Error('No video bytes returned from Veo API');
    }
  } catch (error) {
    console.warn(`⚠️ [Scene ${sceneNum}] Veo Image-to-Video API is not accessible or failed:`, error.message);
    console.log(`💡 [Scene ${sceneNum}] Switching to FFmpeg Ken Burns zoompan simulation.`);
    return null; // 에러 시 null을 리턴하여 백엔드가 FFmpeg 줌인으로 연출하게 유도
  }
}

// 가상 씬 기획 생성기 (Fallback)
function generateMockScenes(prompt, sceneCount) {
  const scenes = [];
  const sceneDrafts = [
    "저 멀리 어두운 우주 공간에서, 수상한 외계 전함들이 편대를 이루며 지구를 향해 다가옵니다.",
    "예상치 못한 적의 포격 소리에 조종실 경보등이 빨갛게 깜빡이며 긴박함이 감돕니다.",
    "주인공은 비장한 결의를 품고 탈출 포드의 전원 장치를 켜며 마지막 탈출 루트를 확보합니다.",
    "탈출선이 엔진 화염을 힘차게 뿜어내며 모선을 뒤로 한 채 지구 대기권을 향해 날아갑니다.",
    "성공적으로 대기권을 가로지른 우주선이 맑고 푸른 지구의 상공에 유유히 떠 있습니다.",
    "착륙 기지 문이 열리며 기다리던 동료 대원들이 일제히 영웅의 귀환을 향해 환호합니다.",
    "승리의 미소를 머금은 주인공은 밝게 비추는 태양빛을 받으며 기지 광장을 당당히 걸어 나옵니다."
  ];
  const mainCharacterDetails = "은발 머리에 푸른 눈을 가진 20대 청년 전사, 짙은 블루 톤의 우주 비행 수트 장착";

  for (let i = 1; i <= sceneCount; i++) {
    const draftIndex = (i - 1) % sceneDrafts.length;
    scenes.push({
      sceneNum: i,
      description: `[장면 ${i}] ${sceneDrafts[draftIndex]}`,
      characterDetails: mainCharacterDetails
    });
  }
  return scenes;
}

// 가상 그라데이션 SVG 이미지 파일 쓰기 (Fallback)
async function saveMockImage(filePath, sceneNum) {
  const dummyIndex = ((sceneNum - 1) % 3) + 1; // 1, 2, 3 로테이션
  const dummySrc = path.join(__dirname, 'public', `dummy_${dummyIndex}.png`);
  if (fs.existsSync(dummySrc)) {
    fs.copyFileSync(dummySrc, filePath);
  } else {
    // 만약 파일이 없으면, Base64로 된 간단한 1픽셀 JPEG를 생성합니다.
    const onePixelJpg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
    fs.writeFileSync(filePath, onePixelJpg);
  }
  
  // 0.5초 지연
  await new Promise(resolve => setTimeout(resolve, 500));
}

module.exports = {
  planScenes,
  generateImageForScene,
  generateVideoForScene
};
