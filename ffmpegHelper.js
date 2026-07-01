const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const fs = require('fs');
const path = require('path');


ffmpeg.setFfmpegPath(ffmpegInstaller.path);


const ffprobePath = ffmpegInstaller.path.replace('ffmpeg.exe', 'ffprobe.exe').replace('ffmpeg', 'ffprobe');
if (fs.existsSync(ffprobePath)) {
  ffmpeg.setFfprobePath(ffprobePath);
}


function getAudioDuration(audioPath, text) {
  return new Promise((resolve) => {
    if (!fs.existsSync(ffprobePath)) {

      const sec = Math.max(3.0, (text || "").length * 0.25 + 1.0);
      return resolve(sec);
    }

    ffmpeg.ffprobe(audioPath, (err, metadata) => {
      if (err || !metadata || !metadata.format || !metadata.format.duration) {

        const sec = Math.max(3.0, (text || "").length * 0.25 + 1.0);
        return resolve(sec);
      }
      resolve(parseFloat(metadata.format.duration));
    });
  });
}


function createSceneVideo(imagePath, audioPath, outputPath, duration) {
  return new Promise((resolve, reject) => {

    const safeImg = imagePath.replace(/\\/g, '/');
    const safeAud = audioPath.replace(/\\/g, '/');
    const safeOut = outputPath.replace(/\\/g, '/');


    const frames = Math.ceil(duration * 25);

    ffmpeg()
      .input(safeImg)

      .input(safeAud)
      .outputOptions([
        '-c:v libx264',

        '-vf', `zoompan=z='min(zoom+0.001,1.3)':x='iw/2-(iw/zoom)/2':y='ih/2-(ih/zoom)/2':d=${frames}:s=1280x720,fade=t=in:st=0:d=0.5,fade=t=out:st=${duration - 0.5}:d=0.5`,
        '-c:a aac',
        '-b:a 192k',
        '-pix_fmt yuv420p',

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


function concatVideos(videoPaths, outputPath) {
  return new Promise((resolve, reject) => {
    const listPath = path.join(path.dirname(outputPath), 'concat_list.txt');

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


function formatSRTTime(seconds) {
  const date = new Date(0);
  date.setSeconds(seconds);
  const ms = Math.floor((seconds % 1) * 1000).toString().padStart(3, '0');
  const timeStr = date.toISOString().substr(11, 8);
  return `${timeStr},${ms}`;
}

async function buildSRTAndBurn(videoPath, scenes, outputPath, subtitlePath) {

  let srtContent = '';
  let currentTime = 0;

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const duration = scene.duration || 3.0;
    const startTime = currentTime;
    const endTime = currentTime + duration;

    srtContent += `${i + 1}\n`;
    srtContent += `${formatSRTTime(startTime)} --> ${formatSRTTime(endTime)}\n`;
    srtContent += `${scene.ttsText}\n\n`;

    currentTime = endTime;
  }

  fs.writeFileSync(subtitlePath, srtContent);
  console.log(`[SRT] Subtitle file created: ${subtitlePath}`);


  return new Promise((resolve, reject) => {

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
