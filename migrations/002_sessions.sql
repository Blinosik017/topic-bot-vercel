CREATE TABLE IF NOT EXISTS sessions (
    user_id BIGINT PRIMARY KEY,
    state TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'bot_sessions'
    ) THEN
        INSERT INTO sessions (user_id, state, payload, updated_at)
        SELECT telegram_id, state, data, updated_at
        FROM bot_sessions
        ON CONFLICT (user_id) DO NOTHING;

        DROP TABLE bot_sessions;
    END IF;
END $$;
