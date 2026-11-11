const { Pool } = require('pg');

function createPool() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
  const useSSL = process.env.PGSSL === 'true' || (!isLocal && process.env.PGSSL !== 'false');

  return new Pool({
    connectionString,
    max: Number(process.env.PG_POOL_MAX || 3),
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
    ssl: useSSL ? { rejectUnauthorized: false } : false,
  });
}

function getPool() {
  if (!global.__topicSlotsPool) {
    global.__topicSlotsPool = createPool();
    global.__topicSlotsPool.on('error', (error) => {
      console.error('Unexpected PostgreSQL pool error:', error);
    });
  }
  return global.__topicSlotsPool;
}

async function query(text, params) {
  return getPool().query(text, params);
}

async function closePool() {
  if (global.__topicSlotsPool) {
    const pool = global.__topicSlotsPool;
    global.__topicSlotsPool = null;
    await pool.end();
  }
}

async function upsertUser(user) {
  await query(
    `INSERT INTO users (id, username, first_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (id) DO UPDATE
     SET username = EXCLUDED.username,
         first_name = EXCLUDED.first_name`,
    [user.id, user.username || null, user.first_name || null],
  );
}

async function createAssignment({ title, deadline = null, createdBy }) {
  const result = await query(
    `INSERT INTO assignments (title, deadline, created_by)
     VALUES ($1, $2, $3)
     RETURNING id, title, deadline, created_at`,
    [title, deadline, createdBy],
  );
  return result.rows[0];
}

async function getActiveAssignments() {
  const result = await query(
    `SELECT a.id,
            a.title,
            a.deadline,
            a.file_id,
            a.created_at,
            COUNT(t.id)::int AS total_topics,
            COUNT(t.id) FILTER (WHERE t.status = 'free')::int AS free_topics
     FROM assignments a
     LEFT JOIN topics t ON t.assignment_id = a.id
     WHERE a.is_active = TRUE
     GROUP BY a.id
     ORDER BY a.created_at DESC`,
  );
  return result.rows;
}

async function getAssignment(assignmentId) {
  const result = await query(
    `SELECT id, title, deadline, teacher_contact, literature,
            file_id, file_name, created_by, created_at, is_active
     FROM assignments
     WHERE id = $1`,
    [assignmentId],
  );
  return result.rows[0] || null;
}

async function createAssignmentWithTopics({
  title,
  createdBy,
  fileId,
  fileName,
  topicsCount,
}) {
  const client = await getPool().connect();

  try {
    await client.query('BEGIN');

    const assignmentResult = await client.query(
      `INSERT INTO assignments (title, created_by, file_id, file_name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, title, deadline, teacher_contact, literature,
                 file_id, file_name, created_by, created_at, is_active`,
      [title, createdBy, fileId, fileName],
    );

    const assignment = assignmentResult.rows[0];

    const topicsResult = await client.query(
      `INSERT INTO topics (assignment_id, title)
       SELECT $1, 'Тема ' || g
       FROM generate_series(1, $2::int) AS g`,
      [assignment.id, topicsCount],
    );

    await client.query('COMMIT');

    return { assignment, topicsCount: topicsResult.rowCount };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function deleteAssignment(assignmentId) {
  const result = await query(
    `DELETE FROM assignments WHERE id = $1
     RETURNING id, title`,
    [assignmentId],
  );
  return result.rows[0] || null;
}

async function setAssignmentDeadline(assignmentId, deadline) {
  const result = await query(
    `UPDATE assignments SET deadline = $2 WHERE id = $1
     RETURNING id, title, deadline, teacher_contact, literature, is_active`,
    [assignmentId, deadline],
  );
  return result.rows[0] || null;
}

async function setAssignmentContact(assignmentId, contact) {
  const result = await query(
    `UPDATE assignments SET teacher_contact = $2 WHERE id = $1
     RETURNING id, title, deadline, teacher_contact, literature, is_active`,
    [assignmentId, contact],
  );
  return result.rows[0] || null;
}

async function setAssignmentLiterature(assignmentId, literature) {
  const result = await query(
    `UPDATE assignments SET literature = $2 WHERE id = $1
     RETURNING id, title, deadline, teacher_contact, literature, is_active`,
    [assignmentId, literature],
  );
  return result.rows[0] || null;
}

async function getAssignmentTopics(assignmentId) {
  const result = await query(
    `SELECT id, assignment_id, title, status, student_id, student_name, claimed_at
     FROM topics
     WHERE assignment_id = $1
     ORDER BY id`,
    [assignmentId],
  );
  return result.rows;
}

async function getTopic(topicId) {
  const result = await query(
    `SELECT id, assignment_id, title, status, student_id, student_name, claimed_at
     FROM topics
     WHERE id = $1`,
    [topicId],
  );
  return result.rows[0] || null;
}

async function addTopics(assignmentId, titles) {
  if (!titles.length) {
    return 0;
  }
  const result = await query(
    `INSERT INTO topics (assignment_id, title)
     SELECT $1, title FROM unnest($2::text[]) AS title`,
    [assignmentId, titles],
  );
  return result.rowCount;
}

async function addNumberedTopics(assignmentId, startNumber, count) {
  if (count <= 0) {
    return 0;
  }

  const result = await query(
    `INSERT INTO topics (assignment_id, title)
     SELECT $1, 'Тема ' || g
     FROM generate_series($2::int, $3::int) AS g`,
    [assignmentId, startNumber, startNumber + count - 1],
  );

  return result.rowCount;
}

async function updateTopicTitle(topicId, title) {
  const result = await query(
    `UPDATE topics SET title = $2 WHERE id = $1
     RETURNING id, assignment_id`,
    [topicId, title],
  );
  return result.rows[0] || null;
}

async function deleteTopic(topicId) {
  const result = await query(
    `DELETE FROM topics WHERE id = $1
     RETURNING id, assignment_id, title, status, student_name`,
    [topicId],
  );
  return result.rows[0] || null;
}

async function deleteAllTopics(assignmentId) {
  const result = await query(
    'DELETE FROM topics WHERE assignment_id = $1',
    [assignmentId],
  );
  return result.rowCount;
}

async function bookTopic(topicId, studentId, studentName) {
  const result = await query(
    `UPDATE topics
     SET status = 'booked',
         student_id = $1,
         student_name = $2,
         claimed_at = NOW()
     WHERE id = $3 AND status = 'free'
     RETURNING id, assignment_id`,
    [studentId, studentName, topicId],
  );
  return result.rows[0] || null;
}

async function unbookTopic(topicId, studentId) {
  const result = await query(
    `UPDATE topics
     SET status = 'free',
         student_id = NULL,
         student_name = NULL,
         claimed_at = NULL
     WHERE id = $1 AND student_id = $2
     RETURNING id, assignment_id`,
    [topicId, studentId],
  );
  return result.rows[0] || null;
}

async function getMyTopics(studentId) {
  const result = await query(
    `SELECT t.id,
            t.title,
            t.claimed_at,
            a.id AS assignment_id,
            a.title AS assignment_title
     FROM topics t
     JOIN assignments a ON a.id = t.assignment_id
     WHERE t.student_id = $1 AND t.status = 'booked'
     ORDER BY a.created_at DESC, t.id`,
    [studentId],
  );
  return result.rows;
}

async function setSession(userId, state, payload = {}) {
  await query(
    `INSERT INTO sessions (user_id, state, payload, updated_at)
     VALUES ($1, $2, $3::jsonb, NOW())
     ON CONFLICT (user_id) DO UPDATE
     SET state = EXCLUDED.state,
         payload = EXCLUDED.payload,
         updated_at = NOW()`,
    [userId, state, JSON.stringify(payload)],
  );
}

async function getSession(userId) {
  const result = await query(
    `SELECT user_id, state, payload, updated_at
     FROM sessions
     WHERE user_id = $1
       AND updated_at > NOW() - INTERVAL '1 hour'`,
    [userId],
  );
  return result.rows[0] || null;
}

async function clearSession(userId) {
  await query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

module.exports = {
  query,
  getPool,
  closePool,
  upsertUser,
  createAssignment,
  createAssignmentWithTopics,
  getActiveAssignments,
  getAssignment,
  deleteAssignment,
  setAssignmentDeadline,
  setAssignmentContact,
  setAssignmentLiterature,
  getAssignmentTopics,
  getTopic,
  addTopics,
  addNumberedTopics,
  updateTopicTitle,
  deleteTopic,
  deleteAllTopics,
  bookTopic,
  unbookTopic,
  getMyTopics,
  setSession,
  getSession,
  clearSession,
};
