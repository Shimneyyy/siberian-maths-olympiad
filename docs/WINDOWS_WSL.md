# Локальный запуск из Windows через WSL/Ubuntu

Учебный сервер проекта использует Linux-контур. Edge остаётся в Windows;
сервер Node.js запускается в Ubuntu. Нативная поддержка Windows ACL для ключей,
приватных файлов и backups не реализована; PDF-парсер также требует Linux prlimit.
Не обходите проверки 0600/0700 и не удаляйте ключи ради регистрации.

## 1. Подготовить Ubuntu и Docker Desktop

Если Ubuntu ещё нет, откройте PowerShell от администратора:

```powershell
wsl --install -d Ubuntu
```

Если Windows попросит перезагрузку, выполните её. Откройте Ubuntu и завершите
создание Linux-пользователя. В Docker Desktop включите **Use the WSL 2 based engine**
и **Settings → Resources → WSL Integration → Ubuntu**, примените настройки.
Docker Desktop должен быть запущен. В терминале Ubuntu установите обычные
инструменты, если их ещё нет:

```bash
sudo apt update
sudo apt install -y git curl ca-certificates
```

Остановите старый Windows `npm run dev` через Ctrl+C: порт 3000 должен освободиться.
Контейнеры/тома БД удалять не надо. В частности, не выполняйте compose down -v,
prisma migrate reset и не создавайте новый BETTER_AUTH_SECRET.

## 2. Перенести checkout, сохранив .env и ключи

Откройте **обычный PowerShell в папке существующего Windows-проекта** и выполните:

```powershell
wsl -d Ubuntu --cd "$PWD"
```

Теперь команды ниже выполняются **в Ubuntu**, а начальная текущая папка — ваш
Windows-проект. Сначала запомните её, затем создайте отдельный checkout в Linux:

```bash
set -e
SMO_WINDOWS_SOURCE="$PWD"
test -f "$SMO_WINDOWS_SOURCE/.env"
mkdir -p ~/projects
git clone --branch work https://github.com/Shimneyyy/siberian-maths-olympiad.git ~/projects/siberian-maths-olympiad
cd ~/projects/siberian-maths-olympiad
install -m 600 "$SMO_WINDOWS_SOURCE/.env" .env
if [ -d "$SMO_WINDOWS_SOURCE/.local" ]; then
  cp -R "$SMO_WINDOWS_SOURCE/.local" .
  chmod -R go-rwx .local
fi
set +e
```

Если папка назначения уже существует, clone остановится: используйте существующий
Linux-checkout или новое имя, не удаляйте его автоматически. При запросе доступа к
GitHub авторизуйтесь обычным способом; токены и секреты в чат не отправляются.
Не копируйте Windows node_modules/.next. Работайте именно из ~/projects/…;
запуск из /mnt/c/… не обеспечивает необходимые обычные Unix-права.

.env и весь .local сохраняются локально и игнорируются Git. Ключи переносятся,
а не генерируются взамен существующих. Если .env содержит абсолютные Windows-пути
к keyring/дипломам/backup, исправьте только пути на соответствующие Linux-копии.
Сохраните прежние BETTER_AUTH_SECRET, DATABASE_URL и ключи. Исходный Windows-каталог
остаётся на месте. Если ключ потерян при существующих шифрованных аккаунтах,
инициализация должна отказать: восстановите прежний ключ из своей защищённой копии.

## 3. Node.js 24 и запуск

Если в Ubuntu ещё нет Node.js 24, можно установить его через официальный nvm:

```bash
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm install 24
```

Затем в Linux-checkout:

```bash
node --version
npm ci
npm run dev:setup
docker compose up -d --wait
npm run db:generate
npm run db:migrate
npm run db:seed
npm run nsuhw:keys -- init
npm run dev
```

Нужен Node v24.x. Для учебной регистрации в .env должны быть
`DEMO_REGISTRATION="true"` и `BETTER_AUTH_URL="http://localhost:3000"`.
После изменения .env перезапускайте dev-сервер. dev:setup сохраняет прежний непустой
секрет. Compose проекта smo-dev использует существующий PostgreSQL-том того же
Docker Desktop engine; миграции deploy и seed не сбрасывают БД. Если в Windows
использовалась другая БД/другой Docker engine, сохраните к ней прежнее подключение
или сначала организуйте согласованный перенос; не выдавайте пустую БД за прежние аккаунты.

Успех keys init: `Existing demo keyring preserved.` либо, только для нового контура,
`Demo keyring created; key values are not displayed.` Если команда отказала,
не удаляйте ключ или записи БД. Проверьте учебный флаг, доступность БД и перенос .local.

В Edge откройте **http://localhost:3000**. Почтовая песочница — **http://localhost:8025**.
/register создаёт аккаунт студента и готовит отдельные данные nsuhw; это ещё не
заявка на олимпиаду и не создание аккаунта на внешнем сайте. После подтверждения
email и входа подайте заявку отдельно в «Моё участие в олимпиаде».
Используйте только вымышленные данные и адрес @example.test.

Эта инструкция не является подтверждением прогона на пользовательской Windows-машине.
Автоматические проверки выполняются в Linux; результат переноса и входа проверяется
на конкретном WSL/Docker Desktop пользователя.
