#!/usr/bin/env node

const process = require('node:process');
const fs = require('node:fs');
const util = require('node:util');
const ffmpeg = require('fluent-ffmpeg');
const { opus } = require('prism-media');
const { Client } = require('discord.js-selfbot-v13');
const { Streamer, VideoStream, AudioStream, H264NalSplitter } = require('@dank074/discord-video-stream');
const { StreamOutput } = require('@dank074/fluent-ffmpeg-multistream-ts');

const readFile = util.promisify(fs.readFile);

for (const sig of ['SIGINT', 'SIGTERM', 'SIGQUIT', 'SIGUSR1', 'SIGUSR2']) {
  process.on(sig, () => {
    console.log(`got ${sig} signal - exiting...`)
    process.exit(0)
  })
}

(async function main() {
  const config = await readConfig();
  const client = new Client({
    checkUpdate: false,
  });
  const streamer = new Streamer(client);    
  console.log('logging in...')
  await client.login(config.token);
  console.log('joining voice...')
  await streamer.joinVoice(config.guildId, config.channelId); 
  process.on('exit', () => {
    console.log('leaving voice...')
    streamer.leaveVoice();
  })

  console.log('starting stream...')
  const udpMediaStream = await streamer.createStream();
  udpMediaStream.mediaConnection.setVideoStatus(true);
  try {
      const res = await streamVideo("/dev/video0", udpMediaStream);
      console.log("finished playing video: " + res);
  } catch (e) {
      console.error(e);
  } finally {
      udpMediaStream.mediaConnection.setVideoStatus(false);
      process.exit(0)
  }
})()

function streamVideo(input, udpMediaStream) {
  return new Promise((resolve, reject) => {
      try {
        const command = ffmpeg();
        command
          .on('start', function(commandLine) {
            console.log('spawned ffmpeg with command: ' + commandLine);
          })
          .on('end', () => {
              resolve("video ended")
          })
          .on("error", (err, stdout, stderr) => {
              reject('cannot play video ' + err.message)
          })
          .on('stderr', console.error);

        const videoStream = new VideoStream(udpMediaStream, 30);
        const videoOutput = new H264NalSplitter()
        command
          .input(input)
          .inputFormat('v4l2')
          .inputOptions([
            // '-input_format mjpeg',
            // '-video_size 1280x720',
            // '-pix_fmt yuvj422p',
            '-input_format yuyv422',
            '-video_size 720x480',
            '-framerate 30',
            '-thread_queue_size 15000',
          ])
          .output(StreamOutput(videoOutput).url, { end: false })
          .noAudio()
          .size('1280x720')
          .fpsOutput(30)
          .videoBitrate('3000k')
          .format('h264')
          .outputOptions([
              '-tune zerolatency',
              '-pix_fmt yuv420p',
              '-preset ultrafast',
              '-profile:v baseline',
              `-g 30`,
              `-x264-params keyint=30:min-keyint=30`,
              '-bsf:v h264_metadata=aud=insert'
          ]);
          videoOutput.pipe(videoStream, { end: false });
          
          const audioStream = new AudioStream(udpMediaStream);
          const audioOutput = new opus.Encoder({ channels: 2, rate: 48000, frameSize: 960 });      
          command
            .input('default')
            .inputFormat('pulse')
            .inputOption(`-thread_queue_size 15000`)
            .output(StreamOutput(audioOutput).url, { end: false })
            .noVideo()
            .audioChannels(2)
            .audioFrequency(48000)
            .format('s16le');
          audioOutput.pipe(audioStream, { end: false });
        
          command.inputOption('-hwaccel', 'auto');          
          command.run();
      } catch(e) {
          reject("cannot play video " + e.message);
      }
  })
}

async function readConfig() {
  const args = process.argv.slice(2)
  let config = {}
  if (args.length > 0) {
    const configPath = args[0];
    const configFileContent = await readFile(configPath)
    config = JSON.parse(configFileContent)
  }
  config.token ??= process.env.TOKEN;
  config.guildId ??= process.env.GUILD_ID;
  config.channelId ??= process.env.CHANNEL_ID;

  if (!config.token) throw new Error("token is required")
  if (!config.guildId) throw new Error("guild ID is required")
  if (!config.channelId) throw new Error("channel ID is required")

  return config;
}
