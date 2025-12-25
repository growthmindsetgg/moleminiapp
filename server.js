import express from "express";
import sqlite3 from "sqlite3";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

// ---------- DATABASE ----------

const db = new sqlite3.Database("./scores.db");

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fid TEXT,
      username TEXT,
      score INTEGER,
      date TEXT,
      created_at INTEGER
    )
  `);
});

// ---------- CONFIG ----------

const MAX_SCORE = 300;          // sanity cap
const SUBMIT_COOLDOWN_MS = 10_000;

// in-memory rate limit (fine for v1)
const lastSubmit = new Map();

// ---------- HELPERS ----------

function today() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

// ---------- ROUTES ----------

/**
 * POST /submit-score
 * body: { fid, username, score }
 */
app.post("/submit-score", (req, res) => {
  const { fid, username, score } = req.body;

  if (!fid || typeof score !== "number") {
    return res.status(400).json({ error: "invalid payload" });
  }

  if (score < 0 || score > MAX_SCORE) {
    return res.status(400).json({ error: "invalid score" });
  }

  const now = Date.now();
  const last = lastSubmit.get(fid) || 0;

  if (now - last < SUBMIT_COOLDOWN_MS) {
    return res.status(429).json({ error: "too fast" });
  }

  lastSubmit.set(fid, now);

  const date = today();

  // keep only BEST score per user per day
  db.get(
    `
    SELECT id, score FROM scores
    WHERE fid = ? AND date = ?
    `,
    [fid, date],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: "db error" });
      }

      if (!row) {
        db.run(
          `
          INSERT INTO scores (fid, username, score, date, created_at)
          VALUES (?, ?, ?, ?, ?)
          `,
          [fid, username || "anon", score, date, now]
        );
      } else if (score > row.score) {
        db.run(
          `
          UPDATE scores
          SET score = ?, created_at = ?
          WHERE id = ?
          `,
          [score, now, row.id]
        );
      }

      res.json({ ok: true });
    }
  );
});

/**
 * GET /leaderboard
 * query: ?date=YYYY-MM-DD (optional)
 */
app.get("/leaderboard", (req, res) => {
  const date = req.query.date || today();

  db.all(
    `
    SELECT username, MAX(score) as score
    FROM scores
    WHERE date = ?
    GROUP BY fid
    ORDER BY score DESC
    LIMIT 10
    `,
    [date],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: "db error" });
      }
      res.json(rows);
    }
  );
});

// ---------- START ----------

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`mole backend running on http://localhost:${PORT}`);
});
