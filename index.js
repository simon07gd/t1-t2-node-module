const express = require('express')
const app = express()
const cors = require('cors')
const { Database } = require('sqlite-async')
require('dotenv').config()

app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(express.static('public'))
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/views/index.html')
});

let db;

(async () => {
  try {
    db = await Database.open(process.env.DB_FILE || 'tracker.db');
    console.log("Connected to database");

    await db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE
      )
    `);
    await db.run(`
      CREATE TABLE IF NOT EXISTS exercises (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId INTEGER NOT NULL,
        description TEXT NOT NULL,
        duration INTEGER NOT NULL,
        date TEXT NOT NULL,
        FOREIGN KEY (userId) REFERENCES users(id)
      )
    `);
    console.log("Created tables");
  } catch (err) {
    console.error('Error during database creation: ', err)
  }
})();

app.post('/api/users', async(req, res) => {
  const { username } = req.body;
  if (!username) {
    return res.status(400).send('Username is required');
  }

  try {
    const result = await db.run('INSERT INTO users (username) VALUES (?)', [username]);
    const newUser = await db.get('SELECT username, id as _id FROM users WHERE id = ?', [result.lastID]);
    res.json(newUser);
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      return res.status(400).send('Username already taken');
    }
    res.status(500).send('Server error');
  }
});

app.get('/api/users', async (req, res) => {
  try {
    const users = await db.all('SELECT id as _id, username FROM users');
    res.json(users);
  } catch (err) {
    res.status(500).send('Server error');
  }
});

app.post('/api/users/:_id/exercises', async (req, res) => {
  const { _id } = req.params;
  const { description, duration } = req.body;
  let { date } = req.body;

  if (!description || !duration) {
    return res.status(400).send('Description and duration are required.');
  }

  try {
    const user = await db.get('SELECT id as _id, username FROM users WHERE id = ?', [_id]);
    if (!user) {
      return res.status(404).send('User not found');
    }

    // If date is not provided, use today's date.
    // Store as ISO string for proper sorting in database.
    const exerciseDate = date ? new Date(date) : new Date();

    const sql = 'INSERT INTO exercises (userId, description, duration, date) VALUES (?, ?, ?, ?)';
    await db.run(sql, [user._id, description, parseInt(duration), exerciseDate.toISOString()]);
    
    res.json({
      _id: user._id,
      username: user.username,
      description: description,
      duration: parseInt(duration),
      date: exerciseDate.toDateString()
    });

  } catch (err) {
    console.error(err);
    res.status(500).send('Server error while saving exercise');
  }
});

app.get('/api/users/:_id/logs', async (req, res) => {
  const { _id } = req.params;
  const { from, to, limit } = req.query;

  try {
    const user = await db.get('SELECT id as _id, username FROM users WHERE id = ?', [_id]);
    if (!user) {
      return res.status(404).send('User not found');
    }

    let sql = 'SELECT description, duration, date FROM exercises WHERE userId = ?';
    const params = [_id];

    if (from) {
      sql += ' AND date >= ?';
      params.push(new Date(from).toISOString());
    }
    if (to) {
      sql += ' AND date <= ?';
      params.push(new Date(to).toISOString());
    }

    const countSql = `SELECT COUNT(*) as count FROM (${sql.replace('description, duration, date', '*')})`;
    const { count } = await db.get(countSql, params);

    if (limit) {
      sql += ' LIMIT ?';
      params.push(parseInt(limit));
    }

    const exercises = await db.all(sql, params);

    const log = exercises.map(e => ({
      description: e.description,
      duration: e.duration,
      date: new Date(e.date).toDateString()
    }));

    res.json({
      ...user,
      count: count,
      log: log
    });

  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
});

const listener = app.listen(process.env.PORT || 3000, () => {
  console.log('Your app is listening on port ' + listener.address().port)
})
