CREATE TABLE IF NOT EXISTS users (
    id BIGINT PRIMARY KEY,
    username TEXT,
    first_name TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assignments (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    deadline TIMESTAMP,
    teacher_contact TEXT,
    literature TEXT,
    file_id TEXT,
    file_name TEXT,
    created_by BIGINT REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS topics (
    id SERIAL PRIMARY KEY,
    assignment_id INTEGER REFERENCES assignments(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    status TEXT DEFAULT 'free',
    student_id BIGINT REFERENCES users(id),
    student_name TEXT,
    claimed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
    user_id BIGINT PRIMARY KEY,
    state TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_topics_assignment_id ON topics(assignment_id);
CREATE INDEX IF NOT EXISTS idx_topics_status ON topics(status);
CREATE INDEX IF NOT EXISTS idx_topics_student_id ON topics(student_id);
CREATE INDEX IF NOT EXISTS idx_assignments_is_active ON assignments(is_active);
