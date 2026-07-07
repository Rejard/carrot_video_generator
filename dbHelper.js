const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'video_generator.db');

let db = null;

function persist() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

async function initDB() {
  const SQL = await initSqlJs();

  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      prompt TEXT,
      sceneCount INTEGER,
      status TEXT,
      createdAt TEXT,
      updatedAt TEXT
    )
  `);

  db.run(`
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
  `);

  persist();
  console.log('✅ SQLite Database & Tables Initialized.');
}

async function createVideo(id, prompt, sceneCount) {
  const now = new Date().toISOString();
  db.run(
    `INSERT OR REPLACE INTO videos (id, prompt, sceneCount, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, prompt, sceneCount, 'planning', now, now]
  );
  persist();
  return { id, prompt, sceneCount, status: 'planning' };
}

async function getVideo(id) {
  const stmt = db.prepare(`SELECT * FROM videos WHERE id = ?`);
  stmt.bind([id]);
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return row;
}

async function updateVideoStatus(id, status) {
  const now = new Date().toISOString();
  db.run(`UPDATE videos SET status = ?, updatedAt = ? WHERE id = ?`, [status, now, id]);
  persist();
}

async function savePlannedScenes(videoId, scenes) {
  const now = new Date().toISOString();
  for (const scene of scenes) {
    db.run(
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
  persist();
}

async function getScenes(videoId) {
  const stmt = db.prepare(`SELECT * FROM scenes WHERE videoId = ? ORDER BY sceneNum ASC`);
  stmt.bind([videoId]);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

async function getScene(videoId, sceneNum) {
  const stmt = db.prepare(`SELECT * FROM scenes WHERE videoId = ? AND sceneNum = ?`);
  stmt.bind([videoId, sceneNum]);
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return row;
}

async function updateScene(videoId, sceneNum, updates) {
  const now = new Date().toISOString();
  const keys = Object.keys(updates);
  if (keys.length === 0) return;

  const setClause = keys.map(k => `${k} = ?`).join(', ');
  const params = keys.map(k => updates[k]);
  params.push(now, videoId, sceneNum);

  db.run(
    `UPDATE scenes SET ${setClause}, updatedAt = ? WHERE videoId = ? AND sceneNum = ?`,
    params
  );
  persist();
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
