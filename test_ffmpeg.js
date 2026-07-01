const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const fs = require('fs');
const path = require('path');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const imgPath = path.join(__dirname, 'public', 'dummy.jpg');
const audPath = path.join(__dirname, 'public', 'dummy.mp3');
const outPath = path.join(__dirname, 'test_output.mp4');

const duration = 5.0;
const frames = Math.ceil(duration * 25);

console.log('Testing FFmpeg zoompan + fade filter...');

ffmpeg()
  .input(imgPath)
  .loop(duration)
  .input(audPath)
  .outputOptions([
    '-c:v libx264',
    '-vf', `zoompan=z='min(zoom+0.001,1.3)':x='iw/2-(iw/zoom)/2':y='ih/2-(ih/zoom)/2':d=${frames}:s=1280x720,fade=t=in:st=0:d=0.5,fade=t=out:st=${duration - 0.5}:d=0.5`,
    '-c:a aac',
    '-b:a 192k',
    '-pix_fmt yuv420p',
    '-t', duration.toString()
  ])
  .save(outPath)
  .on('start', (cmd) => console.log('Spawned cmd:', cmd))
  .on('end', () => {
    console.log('Success! test_output.mp4 created.');
    process.exit(0);
  })
  .on('error', (err) => {
    console.error('Error:', err.message);
    process.exit(1);
  });
