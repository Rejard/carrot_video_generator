const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'video_generator.db');

// DB 인스턴스 싱글톤
let db = null;

function getDB() {
  if (!db) {
    db = new sqlite3.Database(dbPath);
  }
  return db;
}

// 프로미스 래퍼 함수들
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDB().run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDB().all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDB().get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

// 데이터베이스 테이블 초기화
async function initDB() {
  const createVideosTable = `
    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      prompt TEXT,
      sceneCount INTEGER,
      status TEXT,
      createdAt TEXT,
      updatedAt TEXT
    )
  `;

  const createScenesTable = `
    CREATE TABLE IF NOT EXISTS scenes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      videoId TEXT,
      sceneNum INTEGER,
      visualDescription TEXT,
      ttsText TEXT,
      characterDetails TEXT,
      imageUrl TEXT,
      audioUrl TEXT,
      duration REAL,
      status TEXT,
      createdAt TEXT,
      updatedAt TEXT,
      UNIQUE(videoId, sceneNum)
    )
  `;

  await run(createVideosTable);
  await run(createScenesTable);
  console.log('✅ SQLite Database & Tables Initialized.');
}

async function createVideo(id, prompt, sceneCount) {
  const now = new Date().toISOString();
  await run(
    `INSERT OR REPLACE INTO videos (id, prompt, sceneCount, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, prompt, sceneCount, 'planning', now, now]
  );
  return { id, prompt, sceneCount, status: 'planning' };
}

async function getVideo(id) {
  return await get(`SELECT * FROM videos WHERE id = ?`, [id]);
}

async function updateVideoStatus(id, status) {
  const now = new Date().toISOString();
  await run(`UPDATE videos SET status = ?, updatedAt = ? WHERE id = ?`, [status, now, id]);
}

async function savePlannedScenes(videoId, scenes) {
  const now = new Date().toISOString();
  for (const scene of scenes) {
    await run(
      `INSERT OR REPLACE INTO scenes (videoId, sceneNum, visualDescription, ttsText, characterDetails, imageUrl, audioUrl, duration, status, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        videoId,
        scene.sceneNum,
        scene.visualDescription,
        scene.ttsText,
        scene.characterDetails || '',
        '',
        '',
        0.0,
        'pending',
        now,
        now
      ]
    );
  }
}

async function getScenes(videoId) {
  return await all(`SELECT * FROM scenes WHERE videoId = ? ORDER BY sceneNum ASC`, [videoId]);
}

async function getScene(videoId, sceneNum) {
  return await get(`SELECT * FROM scenes WHERE videoId = ? AND sceneNum = ?`, [videoId, sceneNum]);
}

async function updateScene(videoId, sceneNum, updates) {
  const now = new Date().toISOString();
  const keys = Object.keys(updates);
  if (keys.length === 0) return;

  const setClause = keys.map(k => `${k} = ?`).join(', ');
  const params = keys.map(k => updates[k]);
  params.push(now, videoId, sceneNum);

  await run(
    `UPDATE scenes SET ${setClause}, updatedAt = ? WHERE videoId = ? AND sceneNum = ?`,
    params
  );
}

module.exports = {
  initDB,
  createVideo,
  getVideo,
  updateVideoStatus,
  savePlannedScenes,
  getScenes,
  getScene,
  updateScene
};
