let currentVideoId = null;
let eventSource = null;

const btnStart = document.getElementById('btn-start');
const btnResume = document.getElementById('btn-resume');
const btnRender = document.getElementById('btn-render');

const promptInput = document.getElementById('prompt');
const sceneCountSelect = document.getElementById('scene-count');
const modelSelect = document.getElementById('model-select');

const scenesContainer = document.getElementById('scenes-container');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');

const step1 = document.getElementById('step-1');
const step2 = document.getElementById('step-2');
const step3 = document.getElementById('step-3');

const renderPanel = document.getElementById('render-panel');
const renderStatus = document.getElementById('render-status');
const videoOutputArea = document.getElementById('video-output-area');
const finalVideo = document.getElementById('final-video');
const downloadVideo = document.getElementById('download-video');
const downloadSrt = document.getElementById('download-srt');

// 1. AI 모델 목록 가져오기 및 바인딩
async function loadModels() {
  try {
    const res = await fetch('/api/models');
    const data = await res.json();
    if (data.success && data.models) {
      modelSelect.innerHTML = '';
      
      // Gemini 모델 추가
      if (data.models.gemini) {
        data.models.gemini.forEach(m => {
          const opt = document.createElement('option');
          opt.value = m.id;
          opt.innerText = `${m.name} (Gemini)`;
          if (m.id === 'gemini-3.1-flash-lite-preview') opt.selected = true;
          modelSelect.appendChild(opt);
        });
      }
      // OpenAI 모델 추가
      if (data.models.openai) {
        data.models.openai.forEach(m => {
          const opt = document.createElement('option');
          opt.value = m.id;
          opt.innerText = `${m.name} (OpenAI)`;
          modelSelect.appendChild(opt);
        });
      }
    }
  } catch (e) {
    console.warn('Failed to load dynamic model list. Using static presets.', e.message);
  }
}

// 초기화
loadModels();

// 2. 비디오 자동 제작 시작 버튼 이벤트
btnStart.addEventListener('click', async () => {
  const prompt = promptInput.value.trim();
  const sceneCount = parseInt(sceneCountSelect.value);
  const modelId = modelSelect.value;

  if (!prompt) {
    alert('스토리 프롬프트를 입력해주세요!');
    return;
  }

  // UI 초기화
  btnStart.disabled = true;
  btnStart.innerHTML = `<span>⏳ 시나리오 기획 중...</span>`;
  btnResume.style.display = 'none';
  renderPanel.style.display = 'none';
  videoOutputArea.style.display = 'none';
  scenesContainer.innerHTML = '';
  progressBar.style.width = '0%';
  progressText.innerText = '0%';
  
  resetSteps();
  highlightStep(step1);

  try {
    // 1단계: 시나리오 아웃라인 기획
    const planRes = await fetch('/api/plan-scenes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, sceneCount, modelId })
    });
    
    const planData = await planRes.json();
    if (!planData.success) {
      throw new Error(planData.message || '시나리오 기획에 실패했습니다.');
    }

    currentVideoId = planData.videoId;
    completeStep(step1);
    
    // 빈 상태 메시지 제거
    const emptyState = document.getElementById('empty-state');
    if (emptyState) emptyState.remove();

    // 씬 카드 목록 선 그리기
    planData.scenes.forEach(s => {
      const card = createSceneCard(s.sceneNum, s.visualDescription, s.ttsText);
      scenesContainer.appendChild(card);
    });

    // 2/3단계: 실시간 순차 루프 스트리밍 개시
    startStreaming(currentVideoId, sceneCount);

  } catch (err) {
    alert(`오류 발생: ${err.message}`);
    btnStart.disabled = false;
    btnStart.innerHTML = `<span>🚀 자동화 영상 제작 시작</span>`;
  }
});

// 3. SSE 스트리밍 개시
function startStreaming(videoId, totalScenes) {
  highlightStep(step2);
  highlightStep(step3);
  btnStart.innerHTML = `<span>⚡ 에이전트 루프 작동 중...</span>`;

  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource(`/api/stream-generation?videoId=${videoId}`);

  eventSource.onmessage = (event) => {
    if (event.data === '[DONE]') {
      console.log('Streaming complete.');
      eventSource.close();
      completeStep(step2);
      completeStep(step3);
      
      btnStart.disabled = false;
      btnStart.innerHTML = `<span>🚀 자동화 영상 제작 시작</span>`;
      btnResume.style.display = 'none';

      // 렌더링 영역 활성화
      renderPanel.style.display = 'block';
      renderPanel.scrollIntoView({ behavior: 'smooth' });
      return;
    }

    try {
      const data = JSON.parse(event.data);
      
      if (data.type === 'status') {
        // 씬 생성 중 상태 변경
        updateSceneCardStatus(data.sceneNum, 'generating', '생성 진행 중...');
      } else if (data.type === 'progress') {
        const scene = data.scene;
        // 씬 생성 완료 및 이미지/지문/대사 바인딩
        updateSceneCardDone(scene.sceneNum, scene.imageUrl, scene.visualDescription, scene.ttsText);
        
        // 진행률 갱신
        const completedCount = document.querySelectorAll('.scene-card.completed-card').length;
        const pct = Math.round((completedCount / totalScenes) * 100);
        progressBar.style.width = `${pct}%`;
        progressText.innerText = `${pct}%`;
      } else if (data.type === 'error') {
        throw new Error(data.message);
      }
    } catch (err) {
      console.error('SSE data parse error:', err);
      handleStreamError();
    }
  };

  eventSource.onerror = (err) => {
    console.error('EventSource connection error:', err);
    handleStreamError();
  };
}

// 스트리밍 실패 시 복구(Resume) 제어
function handleStreamError() {
  if (eventSource) {
    eventSource.close();
  }
  
  btnStart.disabled = false;
  btnStart.innerHTML = `<span>🚀 새 스토리로 다시 제작</span>`;
  btnResume.style.display = 'block'; // 이어하기 버튼 노출
  
  // 파이프라인 시각 상태 멈춤
  resetSteps();
  step2.classList.add('active'); // 루프 에러 표시 느낌
  alert('⚠️ 일부 이미지 혹은 오디오 생성 중 통신 지연이 발생하여 일시 중단되었습니다. [이어하기] 버튼을 누르면 비용 소모 없이 실패한 지점부터 재개됩니다!');
}

// 4. 이어하기(Resume) 버튼 이벤트
btnResume.addEventListener('click', () => {
  if (!currentVideoId) return;
  
  btnResume.style.display = 'none';
  btnStart.disabled = true;
  btnStart.innerHTML = `<span>⚡ 에이전트 루프 작동 중...</span>`;

  const totalScenes = parseInt(sceneCountSelect.value);
  startStreaming(currentVideoId, totalScenes);
});

// 5. 5단계: FFmpeg 최종 영상 컴파일 렌더링 요청
btnRender.addEventListener('click', async () => {
  if (!currentVideoId) return;

  btnRender.disabled = true;
  btnRender.innerHTML = `<span>⏳ FFmpeg 믹싱 중...</span>`;
  renderStatus.innerText = '⚙️ 백엔드 컴파일러 구동 중 (약 30~60초 소요)...';
  videoOutputArea.style.display = 'none';

  try {
    const res = await fetch('/api/render-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId: currentVideoId })
    });
    
    const data = await res.json();
    if (!data.success) {
      throw new Error(data.message || '렌더링에 실패했습니다.');
    }

    renderStatus.innerHTML = '✅ 비디오 컴파일 완료!';
    btnRender.innerHTML = `<span>🎞️ FFmpeg 영상 컴파일 & 자막 인코딩</span>`;
    btnRender.disabled = false;

    // 최종 결과물 노출
    finalVideo.src = data.videoUrl;
    downloadVideo.href = data.videoUrl;
    downloadSrt.href = data.srtUrl;
    videoOutputArea.style.display = 'block';
    videoOutputArea.scrollIntoView({ behavior: 'smooth' });

  } catch (err) {
    alert(`렌더링 실패: ${err.message}`);
    btnRender.disabled = false;
    btnRender.innerHTML = `<span>🎞️ FFmpeg 영상 컴파일 & 자막 인코딩</span>`;
    renderStatus.innerText = '❌ 컴파일 오류 발생';
  }
});

// UI 유틸리티 함수들
function resetSteps() {
  [step1, step2, step3].forEach(step => {
    step.className = 'step-item';
  });
}

function highlightStep(stepEl) {
  stepEl.classList.add('active');
}

function completeStep(stepEl) {
  stepEl.classList.remove('active');
  stepEl.classList.add('completed');
}

function createSceneCard(sceneNum, visualDescription, ttsText) {
  const card = document.createElement('div');
  card.className = 'scene-card';
  card.id = `scene-card-${sceneNum}`;
  
  card.innerHTML = `
    <div class="scene-image-placeholder" id="img-holder-${sceneNum}">
      <span>씬 ${sceneNum} 대기 중...</span>
    </div>
    <div class="scene-info">
      <div>
        <span class="scene-badge">SCENE ${sceneNum.toString().padStart(2, '0')}</span>
        <div style="font-size: 0.72rem; color: var(--text-muted); margin-bottom: 8px; line-height: 1.4;">
          🎬 지문: <span id="visual-holder-${sceneNum}">${visualDescription}</span>
        </div>
        <div style="font-size: 0.85rem; color: #818CF8; font-weight: 700; background: rgba(99, 102, 241, 0.08); padding: 8px; border-radius: 8px; border-left: 3px solid var(--primary); line-height: 1.4; word-break: keep-all;">
          🗣️ 대사: <span id="tts-holder-${sceneNum}">"${ttsText}"</span>
        </div>
      </div>
      <div class="scene-status-tag" id="status-holder-${sceneNum}">
        <span class="dot"></span>
        <span class="status-txt">대기 중</span>
      </div>
    </div>
  `;
  return card;
}

function updateSceneCardStatus(sceneNum, status, statusText) {
  const card = document.getElementById(`scene-card-${sceneNum}`);
  if (!card) return;

  const imgHolder = document.getElementById(`img-holder-${sceneNum}`);
  const statusHolder = document.getElementById(`status-holder-${sceneNum}`);

  if (status === 'generating') {
    imgHolder.className = 'scene-image-placeholder generating';
    imgHolder.innerHTML = `<span>씬 ${sceneNum} 이미지 생성 중...</span>`;
    statusHolder.innerHTML = `
      <span class="dot running"></span>
      <span class="status-txt" style="color: var(--primary);">${statusText}</span>
    `;
  }
}

function updateSceneCardDone(sceneNum, imageUrl, visualDescription, ttsText) {
  const card = document.getElementById(`scene-card-${sceneNum}`);
  if (!card) return;

  card.classList.add('completed-card');

  const imgHolder = document.getElementById(`img-holder-${sceneNum}`);
  const visualHolder = document.getElementById(`visual-holder-${sceneNum}`);
  const ttsHolder = document.getElementById(`tts-holder-${sceneNum}`);
  const statusHolder = document.getElementById(`status-holder-${sceneNum}`);

  imgHolder.className = 'scene-image-placeholder';
  imgHolder.style.backgroundImage = `url('${imageUrl}')`;
  imgHolder.innerHTML = ''; // 안내 텍스트 삭제

  if (visualHolder) visualHolder.innerText = visualDescription;
  if (ttsHolder) ttsHolder.innerText = `"${ttsText}"`;
  
  statusHolder.innerHTML = `
    <span class="dot completed"></span>
    <span class="status-txt" style="color: var(--accent);">생성 완료</span>
  `;
}
