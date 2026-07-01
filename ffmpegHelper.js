const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const fs = require('fs');
const path = require('path');

// FFmpeg 경로 명시적 지정
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// ffprobe가 필요한 경우를 위해 ffprobe 경로도 동일하게 잡아줍니다.
// @ffmpeg-installer/ffmpeg 패키지 내부나 시스템에 ffprobe가 없을 수 있으므로 
// 오디오 길이를 구하는 부분은 ffprobe와 텍스트 기반 휴리스틱(글자수 비례)을 상호 보완적으로 사용합니다.
const ffprobePath = ffmpegInstaller.path.replace('ffmpeg.exe', 'ffprobe.exe').replace('ffmpeg', 'ffprobe');
if (fs.existsSync(ffprobePath)) {
  ffmpeg.setFfprobePath(ffprobePath);
}

// 오디오 파일의 정확한(또는 추정된) 재생 시간 구하기
function getAudioDuration(audioPath, text) {
  return new Promise((resolve) => {
    if (!fs.existsSync(ffprobePath)) {
      // ffprobe가 없으면 글자수 비례 휴리스틱 적용 (한글 기준 1글자당 약 0.25초 + 여유 1초)
      const sec = Math.max(3.0, (text || "").length * 0.25 + 1.0);
      return resolve(sec);
    }

    ffmpeg.ffprobe(audioPath, (err, metadata) => {
      if (err || !metadata || !metadata.format || !metadata.format.duration) {
        // 에러 시 폴백
        const sec = Math.max(3.0, (text || "").length * 0.25 + 1.0);
        return resolve(sec);
      }
      resolve(parseFloat(metadata.format.duration));
    });
  });
}

// 1. 단일 씬 비디오 생성 (이미지 + 오디오 + 시네마틱 효과 적용)
function createSceneVideo(imagePath, audioPath, outputPath, duration) {
  return new Promise((resolve, reject) => {
    // 윈도우 경로 백슬래시 이스케이프 처리
    const safeImg = imagePath.replace(/\\/g, '/');
    const safeAud = audioPath.replace(/\\/g, '/');
    const safeOut = outputPath.replace(/\\/g, '/');

    // 25fps 기준 총 프레임 수 계산
    const frames = Math.ceil(duration * 25);

    ffmpeg()
      .input(safeImg)
      .loop(duration) // 이미지 지정 시간만큼 루프
      .input(safeAud)
      .outputOptions([
        '-c:v libx264',
        // 서서히 다가가며 커지는 시네마틱 zoompan 효과 및 디졸브 페이드 인/아웃(0.5초) 효과 부여
        '-vf', `zoompan=z='min(zoom+0.001,1.3)':x='iw/2-(iw/zoom)/2':y='ih/2-(ih/zoom)/2':d=${frames}:s=1280x720,fade=t=in:st=0:d=0.5,fade=t=out:st=${duration - 0.5}:d=0.5`,
        '-c:a aac',
        '-b:a 192k',
        '-pix_fmt yuv420p',
        '-t', duration.toString() // 지정 시간 동안만 비디오 출력
      ])
      .save(safeOut)
      .on('start', (cmd) => {
        console.log(`[FFmpeg Cmd] Running: ${cmd}`);
      })
      .on('end', () => {
        console.log(`[FFmpeg] Scene video created: ${outputPath}`);
        resolve();
      })
      .on('error', (err) => {
        console.error(`❌ [FFmpeg] Scene video creation error:`, err.message);
        reject(err);
      });
  });
}

// 2. 여러 비디오 조각들을 합치기
function concatVideos(videoPaths, outputPath) {
  return new Promise((resolve, reject) => {
    const listPath = path.join(path.dirname(outputPath), 'concat_list.txt');
    // FFmpeg concat demuxer 양식에 맞게 텍스트 작성
    const content = videoPaths.map(p => `file '${p.replace(/\\/g, '/')}'`).join('\n');
    fs.writeFileSync(listPath, content);

    console.log(`[FFmpeg] Merging ${videoPaths.length} videos...`);
    
    ffmpeg()
      .input(listPath)
      .inputOptions(['-f concat', '-safe 0'])
      .outputOptions(['-c copy'])
      .save(outputPath.replace(/\\/g, '/'))
      .on('end', () => {
        console.log(`[FFmpeg] Successfully merged to: ${outputPath}`);
        // 임시 리스트 파일 삭제
        try {
          fs.unlinkSync(listPath);
        } catch (e) {}
        resolve();
      })
      .on('error', (err) => {
        console.error(`❌ [FFmpeg] Merging error:`, err.message);
        try {
          fs.unlinkSync(listPath);
        } catch (e) {}
        reject(err);
      });
  });
}

// 3. 자막 파일 생성 및 자막 입히기
// SRT 시간 포맷팅 헬퍼 (00:00:00,000)
function formatSRTTime(seconds) {
  const date = new Date(0);
  date.setSeconds(seconds);
  const ms = Math.floor((seconds % 1) * 1000).toString().padStart(3, '0');
  const timeStr = date.toISOString().substr(11, 8); // "HH:MM:SS"
  return `${timeStr},${ms}`;
}

async function buildSRTAndBurn(videoPath, scenes, outputPath, subtitlePath) {
  // 1. SRT 파일 쓰기
  let srtContent = '';
  let currentTime = 0;

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const duration = scene.duration || 3.0; // 사전에 구동한 재생 시간값 활용
    const startTime = currentTime;
    const endTime = currentTime + duration;

    srtContent += `${i + 1}\n`;
    srtContent += `${formatSRTTime(startTime)} --> ${formatSRTTime(endTime)}\n`;
    srtContent += `${scene.ttsText}\n\n`;

    currentTime = endTime;
  }

  fs.writeFileSync(subtitlePath, srtContent);
  console.log(`[SRT] Subtitle file created: ${subtitlePath}`);

  // 2. FFmpeg 자막 필터 실행
  return new Promise((resolve, reject) => {
    // 윈도우 환경 자막 필터 경로 기괴한 이스케이프 해결
    // subtitles 필터는 드라이브 문자(C:) 콜론 뒤에 이중 백슬래시 처리가 필수적입니다.
    // 예: C\:/tmp/video.srt 또는 C\:\\tmp\\video.srt 형태
    const absoluteSubPath = path.resolve(subtitlePath);
    const safeSubPath = absoluteSubPath.replace(/\\/g, '/').replace(':', '\\:');

    console.log(`[FFmpeg] Burning subtitles... Filter path: ${safeSubPath}`);

    ffmpeg(videoPath.replace(/\\/g, '/'))
      .outputOptions([
        `-vf subtitles='${safeSubPath}'`
      ])
      .save(outputPath.replace(/\\/g, '/'))
      .on('end', () => {
        console.log(`[FFmpeg] Final video with subtitles created: ${outputPath}`);
        resolve();
      })
      .on('error', (err) => {
        console.error(`❌ [FFmpeg] Burn subtitles error:`, err.message);
        reject(err);
      });
  });
}

module.exports = {
  getAudioDuration,
  createSceneVideo,
  concatVideos,
  buildSRTAndBurn
};
