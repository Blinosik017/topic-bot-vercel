# TopicSlotsBot

GitHub: [Blinosik017/topic-bot-vercel](https://github.com/Blinosik017/topic-bot-vercel)

Telegram bot for a student group. The group leader creates assignments, attaches a file with the topic list, and the bot generates numbered booking slots. Students book topics atomically, so two people cannot take the same topic.

This README is available in two languages:

- [Русская инструкция](#русская-инструкция)
- [English guide](#english-guide)

---

# Русская инструкция

## Что умеет бот

- Создание задания в диалоговом режиме: название, количество тем, файл.
- Файл на шаге создания необязателен: его можно прикрепить или пропустить кнопкой `Пропустить` / командой `/skip`.
- Автоматическая генерация тем `Тема 1`, `Тема 2`, ..., `Тема N`.
- Прикрепление файла любого формата: PDF, DOCX, JPG и т.д. Ограничение — 20 МБ.
- Атомарное бронирование тем: один слот может занять только один студент.
- Отмена брони студентом.
- Редактирование задания старостой:
  - дедлайн;
  - контакты преподавателя;
  - список литературы;
  - добавление тем по количеству;
  - переименование и удаление отдельных тем;
  - удаление всех тем;
  - удаление задания целиком;
  - просмотр прикреплённого файла.
- Экспорт списка тем и броней в CSV.
- Работа в serverless-среде Vercel: состояния FSM хранятся в PostgreSQL, а не в памяти процесса.

## Стек

- Node.js 18+
- Telegraf
- PostgreSQL (`pg`)
- Vercel Serverless Functions

## Структура проекта

```text
.
├── api/
│   └── webhook.js          # Vercel webhook endpoint
├── handlers/
│   ├── admin.js            # админские FSM-сценарии и меню
│   └── student.js          # /topics, /my, бронирование
├── migrations/
│   ├── 001_init.sql
│   ├── 002_sessions.sql
│   ├── 003_assignment_details.sql
│   └── 004_assignment_file.sql
├── scripts/
│   ├── dev.js              # локальный polling-запуск
│   ├── migrate.js          # применение миграций
│   └── set-webhook.js      # установка Telegram webhook
├── bot.js                  # инициализация Telegraf
├── db.js                   # пул PostgreSQL и запросы
├── files.js                # отправка файлов заданий
├── menu.js                 # reply-клавиатура и тексты
├── utils.js                # форматирование и вспомогательные функции
├── vercel.json
├── package.json
└── .env.example
```

## Переменные окружения

Создайте файл `.env` на основе `.env.example`:

```bash
cp .env.example .env
```

| Переменная | Обязательна | Назначение |
|---|---|---|
| `BOT_TOKEN` | Да | Токен Telegram-бота от BotFather |
| `DATABASE_URL` | Да | Строка подключения к PostgreSQL |
| `ADMIN_ID` | Да | Telegram ID старосты. Можно несколько ID через запятую |
| `PGSSL` | Нет | `true`/`false` для принудительного включения/отключения SSL. По умолчанию SSL включается для удалённых хостов |
| `PG_POOL_MAX` | Нет | Максимум соединений в пуле, по умолчанию `3` |
| `TZ` | Нет | Часовой пояс, например `Europe/Moscow` |
| `WEBHOOK_SECRET` | Нет | Секрет для проверки заголовка Telegram webhook |
| `WEBHOOK_URL` | Нет | Полный URL webhook для `npm run set:webhook` |
| `VERCEL_URL` | Нет | Домен Vercel без `https://`; используется как fallback для установки webhook |

Файл `.env` нельзя коммитить в GitHub. Он уже добавлен в `.gitignore`.

## Локальный запуск

1. Клонируйте репозиторий и перейдите в папку проекта:

```bash
git clone https://github.com/Blinosik017/topic-bot-vercel.git
cd topic-bot-vercel
```

2. Установите зависимости:

```bash
npm install
```

3. Заполните `.env` на основе `.env.example`.

4. Примените миграции:

```bash
npm run db:migrate
```

5. Запустите бота в режиме polling:

```bash
npm run dev
```

`npm run dev` удаляет webhook и запускает локальный polling. Для production используется webhook.

## Миграции

Все SQL-файлы находятся в `migrations/` и применяются по порядку:

```bash
npm run db:migrate
```

Скрипт выполняет все файлы `.sql` в алфавитном порядке. Миграции написаны идемпотентно (`IF NOT EXISTS`, проверки существования таблиц), поэтому повторный запуск безопасен.

Если вы изменили схему БД, добавьте новый файл с номером, например `005_something.sql`, и снова запустите `npm run db:migrate`.

## Деплой на Vercel

1. Установите Vercel CLI и войдите в аккаунт:

```bash
npm install -g vercel
vercel login
```

2. Привяжите проект:

```bash
vercel link
```

3. Добавьте переменные окружения в Vercel:

```bash
vercel env add BOT_TOKEN production
vercel env add DATABASE_URL production
vercel env add ADMIN_ID production
```

При необходимости добавьте `TZ`, `WEBHOOK_SECRET`, `PGSSL`, `PG_POOL_MAX`.

4. Задеплойте:

```bash
vercel --prod
```

5. Установите webhook.

Через скрипт:

```bash
WEBHOOK_URL=https://your-project.vercel.app/api/webhook npm run set:webhook
```

Или откройте в браузере ссылку, заменив `<BOT_TOKEN>` на токен бота:

```text
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://your-project.vercel.app/api/webhook
```

Проверить webhook:

```text
https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo
```

Ожидаемый ответ: `"ok": true`, правильный `url`, `pending_update_count: 0`.

## Использование бота

### Студент

- `/start` — приветствие и меню.
- `Список тем` или `/topics` — активные задания.
- `Мои брони` или `/my` — забронированные темы и кнопки отмены.
- `/cancel` — отменить текущее действие.

При открытии задания бот отправляет прикреплённый файл и показывает inline-кнопки `Занять` для свободных тем.

### Староста

Меню:

- `Новое задание` — название → количество тем → файл или `Пропустить`.
- `Добавить темы` — выбрать задание → указать количество → бот создаст следующие по номеру темы.
- `Редактировать` — выбрать задание и изменить:
  - дедлайн;
  - контакты преподавателя;
  - список литературы;
  - темы;
  - прикреплённый файл (просмотр);
  - удалить все темы или задание.

Команды:

- `/export <ID>` — CSV со списком тем, статусами и студентами.
- `/skip` — пропустить шаг с файлом.
- `/cancel` — сбросить текущее состояние.

### Кнопки и действия

#### Постоянная клавиатура

| Кнопка | Кому доступна | Что делает |
|---|---|---|
| `Список тем` | Всем | Показывает активные задания. При открытии задания бот отправляет прикреплённый файл и показывает темы с кнопками бронирования |
| `Мои брони` | Всем | Показывает темы, которые забронировал текущий пользователь, и кнопки освобождения |
| `Новое задание` | Старосте | Запускает диалог: название → количество тем → файл или `Пропустить`. После создания генерирует `Тема 1…Тема N` и показывает меню редактирования |
| `Добавить темы` | Старосте | Показывает список активных заданий. После выбора задания нужно указать количество, и бот добавит следующие по номеру темы |
| `Редактировать` | Старосте | Показывает список активных заданий. После выбора открывает меню редактирования задания |

#### Меню редактирования задания

| Кнопка | Что делает |
|---|---|
| `Дедлайн` | Позволяет указать дату в формате `ДД.ММ.ГГГГ` или `ГГГГ-ММ-ДД`. Чтобы удалить дедлайн, отправьте `-` |
| `Контакты` | Позволяет указать почту и/или телефон преподавателя одним сообщением. Чтобы удалить, отправьте `-` |
| `Литература` | Позволяет вставить список литературы текстом, каждый источник с новой строки. Чтобы удалить, отправьте `-` |
| `Добавить темы` | Добавляет указанное количество тем, продолжая нумерацию |
| `Редактировать темы` | Открывает список тем с кнопками переименования и удаления. Внутри также есть удаление всех тем |
| `Показать файл` | Повторно отправляет прикреплённый к заданию файл. Кнопка видна, если файл есть |
| `Удалить все темы` | Удаляет все темы задания после подтверждения. Кнопка видна, если темы есть |
| `Удалить задание` | Удаляет задание, все его темы и брони после подтверждения |
| `К заданию` | Возвращает к обычному просмотру задания |

#### Кнопки внутри задания

| Кнопка | Что делает |
|---|---|
| `Занять №N` | Атомарно бронирует свободную тему за текущим студентом |
| `Освободить №N` | Снимает бронь текущего студента с темы |
| `Список литературы` | Показывает полный список литературы отдельным сообщением |
| `Показать файл` | Повторно отправляет файл задания |
| `Редактировать` | Открывает меню редактирования задания (только старосте) |
| `Назад` / `Вперёд` | Переключает страницы списка тем |
| `К заданиям` | Возвращает к списку активных заданий |
| `Обновить` | Обновляет список активных заданий |

#### Шаг с файлом

| Кнопка / команда | Что делает |
|---|---|
| `Пропустить` | Создаёт задание без файла, генерирует темы и завершает диалог |
| `/skip` | То же самое, но текстовой командой |
| `/cancel` | Отменяет текущий диалог на любом шаге |

#### Команды

| Команда | Кому доступна | Что делает |
|---|---|---|
| `/start` | Всем | Показывает приветствие и постоянную клавиатуру |
| `/topics` | Всем | Открывает список активных заданий |
| `/my` | Всем | Открывает мои брони |
| `/cancel` | Всем | Сбрасывает текущее состояние FSM |
| `/skip` | Старосте | Пропускает необязательный шаг с файлом |
| `/export <ID>` | Старосте | Отправляет CSV с темами, статусами и студентами |

## Безопасность

- Не публикуйте `.env`, токен бота и строку подключения к БД.
- Используйте переменные окружения Vercel для production-секретов.
- Если задан `WEBHOOK_SECRET`, Telegram будет присылать его в заголовке, а webhook endpoint проверит запрос.
- Не передавайте файл `.vercel/project.json` посторонним.

## Частые проблемы

### Telegram API возвращает 404

Обычно это значит, что в ссылке неправильный токен или остался текст `<BOT_TOKEN>`. Скопируйте только значение токена, без пробелов и слова `BOT_TOKEN=`.

### Webhook не отвечает

Проверьте:

```bash
curl https://your-project.vercel.app/api/webhook
```

Для `GET` endpoint должен вернуть текст `TopicSlotsBot webhook is running`.

Также убедитесь, что переменные окружения добавлены именно в Production.

### Ошибка часового пояса

На Vercel переменная `TZ` может приходить как `:UTC`. Код нормализует её автоматически. Если задаёте своё значение, используйте корректный идентификатор, например `Europe/Moscow`.

### Файл не отображается

Файл хранится в Telegram по `file_id` и отправляется отдельным сообщением. В меню редактирования используйте кнопку `Показать файл`. Максимальный размер — 20 МБ.

### Слишком много тем

Темы выводятся постранично. Для больших списков используйте кнопки навигации под заданием.

---

# English guide

## What the bot does

- Dialog-based assignment creation: title, number of topics, optional file.
- The file is optional and can be skipped with the `Skip` button or `/skip`.
- Automatically generates topics named `Topic 1`, `Topic 2`, ..., `Topic N`.
- Accepts files of any format: PDF, DOCX, JPG, etc. Maximum size: 20 MB.
- Atomic topic booking: only one student can claim a slot.
- Students can release their bookings.
- Admin can edit an assignment:
  - deadline;
  - teacher contact details;
  - reading list;
  - add more numbered topics;
  - rename or delete individual topics;
  - delete all topics;
  - delete the whole assignment;
  - view the attached file.
- CSV export of topics and bookings.
- Designed for Vercel serverless: FSM state is stored in PostgreSQL instead of process memory.

## Tech stack

- Node.js 18+
- Telegraf
- PostgreSQL (`pg`)
- Vercel Serverless Functions

## Project structure

```text
.
├── api/
│   └── webhook.js          # Vercel webhook endpoint
├── handlers/
│   ├── admin.js            # admin FSM scenarios and menus
│   └── student.js          # /topics, /my, booking flow
├── migrations/
│   ├── 001_init.sql
│   ├── 002_sessions.sql
│   ├── 003_assignment_details.sql
│   └── 004_assignment_file.sql
├── scripts/
│   ├── dev.js              # local polling mode
│   ├── migrate.js          # migration runner
│   └── set-webhook.js      # Telegram webhook setup
├── bot.js                  # Telegraf initialization
├── db.js                   # PostgreSQL pool and queries
├── files.js                # assignment file delivery
├── menu.js                 # reply keyboard and UI texts
├── utils.js                # formatting and helper functions
├── vercel.json
├── package.json
└── .env.example
```

## Environment variables

Create `.env` from `.env.example`:

```bash
cp .env.example .env
```

| Variable | Required | Purpose |
|---|---|---|
| `BOT_TOKEN` | Yes | Telegram bot token from BotFather |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `ADMIN_ID` | Yes | Telegram ID of the group leader. Multiple IDs can be comma-separated |
| `PGSSL` | No | Force SSL on/off. SSL is enabled by default for remote hosts |
| `PG_POOL_MAX` | No | Maximum PostgreSQL pool size, default `3` |
| `TZ` | No | Time zone, for example `Europe/Moscow` |
| `WEBHOOK_SECRET` | No | Secret token for Telegram webhook verification |
| `WEBHOOK_URL` | No | Full webhook URL used by `npm run set:webhook` |
| `VERCEL_URL` | No | Vercel domain without `https://`; fallback for webhook setup |

Never commit `.env` to GitHub. It is already excluded by `.gitignore`.

## Local development

1. Clone the repository and enter the project directory:

```bash
git clone https://github.com/Blinosik017/topic-bot-vercel.git
cd topic-bot-vercel
```

2. Install dependencies:

```bash
npm install
```

3. Fill in `.env` based on `.env.example`.

4. Apply database migrations:

```bash
npm run db:migrate
```

5. Start the bot in polling mode:

```bash
npm run dev
```

`npm run dev` removes the webhook and starts local polling. Production uses a webhook.

## Migrations

All SQL files live in `migrations/` and are applied in order:

```bash
npm run db:migrate
```

The script executes every `.sql` file in alphabetical order. Migrations are written to be idempotent (`IF NOT EXISTS`, table existence checks), so re-running them is safe.

If you change the schema, add a new numbered file, for example `005_something.sql`, and run `npm run db:migrate` again.

## Deploying to Vercel

1. Install Vercel CLI and log in:

```bash
npm install -g vercel
vercel login
```

2. Link the project:

```bash
vercel link
```

3. Add environment variables in Vercel:

```bash
vercel env add BOT_TOKEN production
vercel env add DATABASE_URL production
vercel env add ADMIN_ID production
```

Add `TZ`, `WEBHOOK_SECRET`, `PGSSL`, and `PG_POOL_MAX` if needed.

4. Deploy:

```bash
vercel --prod
```

5. Set the webhook.

Using the script:

```bash
WEBHOOK_URL=https://your-project.vercel.app/api/webhook npm run set:webhook
```

Or open this URL in a browser, replacing `<BOT_TOKEN>` with the real bot token:

```text
https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://your-project.vercel.app/api/webhook
```

Check the webhook:

```text
https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo
```

Expected result: `"ok": true`, the correct `url`, and `pending_update_count: 0`.

## Using the bot

### Student

- `/start` — welcome message and menu.
- `Topic list` or `/topics` — active assignments.
- `My bookings` or `/my` — booked topics with release buttons.
- `/cancel` — cancel the current action.

When a student opens an assignment, the bot sends the attached file first and then shows inline `Book` buttons for free topics.

### Group leader (admin)

Menu:

- `New assignment` — title → number of topics → file or `Skip`.
- `Add topics` — choose an assignment → enter the number of extra topics.
- `Edit` — choose an assignment and update:
  - deadline;
  - teacher contact details;
  - reading list;
  - topics;
  - view the attached file;
  - delete all topics or the whole assignment.

Commands:

- `/export <ID>` — CSV with topics, statuses, and students.
- `/skip` — skip the optional file step.
- `/cancel` — reset the current FSM state.

### Buttons and actions

#### Persistent reply keyboard

| Button | Available to | What it does |
|---|---|---|
| `Topic list` | Everyone | Shows active assignments. When an assignment is opened, the bot sends the attached file and displays topics with booking buttons |
| `My bookings` | Everyone | Shows topics booked by the current user with release buttons |
| `New assignment` | Admin | Starts the dialog: title → number of topics → file or `Skip`. After creation it generates `Topic 1…Topic N` and opens the edit menu |
| `Add topics` | Admin | Shows active assignments. After selecting one, enter the number of extra topics to append |
| `Edit` | Admin | Shows active assignments. After selecting one, opens the assignment edit menu |

#### Assignment edit menu

| Button | What it does |
|---|---|
| `Deadline` | Sets a deadline in `DD.MM.YYYY` or `YYYY-MM-DD` format. Send `-` to remove it |
| `Contacts` | Sets teacher email and/or phone in one message. Send `-` to remove it |
| `Reading list` | Accepts a multiline reading list, one source per line. Send `-` to remove it |
| `Add topics` | Adds the specified number of topics, continuing the numbering |
| `Edit topics` | Opens a topic list with rename and delete buttons. Also allows deleting all topics |
| `Show file` | Resends the attached file. Visible only when a file exists |
| `Delete all topics` | Deletes every topic in the assignment after confirmation. Visible when topics exist |
| `Delete assignment` | Deletes the assignment, all its topics, and bookings after confirmation |
| `Back to assignment` | Returns to the regular assignment view |

#### Buttons inside an assignment

| Button | What it does |
|---|---|
| `Book #N` | Atomically books a free topic for the current student |
| `Release #N` | Releases the current student's booking |
| `Reading list` | Shows the full reading list in a separate message |
| `Show file` | Resends the assignment file |
| `Edit` | Opens the assignment edit menu (admin only) |
| `Back` / `Next` | Switches pages in the topic list |
| `Back to assignments` | Returns to the active assignments list |
| `Refresh` | Refreshes the active assignments list |

#### File step

| Button / command | What it does |
|---|---|
| `Skip` | Creates the assignment without a file, generates topics, and finishes the dialog |
| `/skip` | Same as the button, but sent as a text command |
| `/cancel` | Cancels the current dialog at any step |

#### Commands

| Command | Available to | What it does |
|---|---|---|
| `/start` | Everyone | Shows the welcome message and persistent keyboard |
| `/topics` | Everyone | Opens the active assignments list |
| `/my` | Everyone | Opens the current user's bookings |
| `/cancel` | Everyone | Resets the current FSM state |
| `/skip` | Admin | Skips the optional file step |
| `/export <ID>` | Admin | Sends a CSV with topics, statuses, and students |

## Security

- Never publish `.env`, the bot token, or the database connection string.
- Use Vercel environment variables for production secrets.
- If `WEBHOOK_SECRET` is set, Telegram sends it in a header and the webhook endpoint validates it.
- Do not share `.vercel/project.json` with third parties.

## Troubleshooting

### Telegram API returns 404

This usually means the token in the URL is wrong or the `<BOT_TOKEN>` placeholder was not replaced. Copy only the token value, without spaces or the `BOT_TOKEN=` prefix.

### Webhook is not responding

Check:

```bash
curl https://your-project.vercel.app/api/webhook
```

A `GET` request should return `TopicSlotsBot webhook is running`.

Also make sure the environment variables were added to the Production environment.

### Time zone error

On Vercel, `TZ` may be provided as `:UTC`. The code normalizes it automatically. If you set your own value, use a valid identifier such as `Europe/Moscow`.

### The file is not visible

The file is stored as a Telegram `file_id` and sent as a separate message. Use the `Show file` button in the edit menu. Maximum size is 20 MB.

### Too many topics

Topics are paginated. Use the navigation buttons below the assignment.
