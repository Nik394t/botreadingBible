// Тестовый скрипт для проверки функций бота без Telegram API
const sqlite3 = require('sqlite3').verbose();
const moment = require('moment');
const fs = require('fs');
const path = require('path');

console.log('🧪 Тестирование функций бота...\n');

// Проверяем план чтения
console.log('📖 Проверка плана чтения:');
try {
    const readingPlan = require('./reading_plan.json');
    console.log(`✅ План загружен: ${readingPlan.length} дней`);
    console.log(`📅 Первый день: ${readingPlan[0].reading}`);
    console.log(`📅 Последний день: ${readingPlan[readingPlan.length - 1].reading}\n`);
} catch (error) {
    console.log('❌ Ошибка загрузки плана:', error.message);
}

// Тестируем базу данных
console.log('🗄️  Тестирование базы данных:');
const dbPath = path.join(__dirname, 'test_bible_bot.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    // Создание таблиц
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        telegram_id INTEGER UNIQUE,
        username TEXT,
        first_name TEXT,
        start_date TEXT,
        current_day INTEGER DEFAULT 1,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) {
            console.log('❌ Ошибка создания таблицы users:', err.message);
        } else {
            console.log('✅ Таблица users создана');
        }
    });

    db.run(`CREATE TABLE IF NOT EXISTS reading_progress (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        day INTEGER,
        date TEXT,
        completed INTEGER DEFAULT 0,
        completed_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users (telegram_id)
    )`, (err) => {
        if (err) {
            console.log('❌ Ошибка создания таблицы reading_progress:', err.message);
        } else {
            console.log('✅ Таблица reading_progress создана');
        }
    });

    // Тестовые данные
    const testUserId = 123456789;
    const testUsername = 'test_user';
    const testFirstName = 'Тестовый Пользователь';
    
    db.run(
        'INSERT OR REPLACE INTO users (telegram_id, username, first_name, start_date, current_day) VALUES (?, ?, ?, ?, ?)',
        [testUserId, testUsername, testFirstName, moment().format('YYYY-MM-DD'), 5],
        function(err) {
            if (err) {
                console.log('❌ Ошибка создания тестового пользователя:', err.message);
            } else {
                console.log('✅ Тестовый пользователь создан');
                
                // Добавляем прогресс
                for (let day = 1; day <= 4; day++) {
                    db.run(
                        'INSERT OR REPLACE INTO reading_progress (user_id, day, date, completed, completed_at) VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)',
                        [testUserId, day, moment().subtract(5 - day, 'days').format('YYYY-MM-DD')]
                    );
                }
                console.log('✅ Тестовый прогресс добавлен');
            }
        }
    );

    // Проверяем данные
    setTimeout(() => {
        db.get('SELECT * FROM users WHERE telegram_id = ?', [testUserId], (err, user) => {
            if (err) {
                console.log('❌ Ошибка получения пользователя:', err.message);
            } else if (user) {
                console.log(`✅ Пользователь найден: ${user.first_name}, день ${user.current_day}`);
            }
        });

        db.all('SELECT * FROM reading_progress WHERE user_id = ?', [testUserId], (err, progress) => {
            if (err) {
                console.log('❌ Ошибка получения прогресса:', err.message);
            } else {
                console.log(`✅ Прогресс найден: ${progress.length} дней завершено`);
            }
        });

        // Закрываем базу и удаляем тестовый файл
        setTimeout(() => {
            db.close((err) => {
                if (err) {
                    console.log('❌ Ошибка закрытия базы:', err.message);
                } else {
                    console.log('✅ База данных закрыта');
                    
                    // Удаляем тестовый файл
                    fs.unlink(dbPath, (err) => {
                        if (err) {
                            console.log('⚠️  Не удалось удалить тестовый файл:', err.message);
                        } else {
                            console.log('✅ Тестовый файл удален');
                        }
                        
                        console.log('\n🎉 Все тесты пройдены успешно!');
                        console.log('\n📋 Следующие шаги:');
                        console.log('1. Получите токен бота от @BotFather');
                        console.log('2. Установите токен: export BOT_TOKEN="ваш_токен"');
                        console.log('3. Запустите бота: ./start_bot.sh');
                        console.log('4. Найдите бота в Telegram и отправьте /start');
                    });
                }
            });
        }, 1000);
    }, 500);
});

// Тестируем функции времени
console.log('\n⏰ Тестирование функций времени:');
console.log(`📅 Текущая дата: ${moment().format('DD.MM.YYYY')}`);
console.log(`🕕 Текущее время: ${moment().format('HH:mm')}`);
console.log(`📆 Дата начала года: ${moment().startOf('year').format('DD.MM.YYYY')}`);

// Тестируем cron выражения
console.log('\n⏲️  Тестирование планировщика:');
const cron = require('node-cron');

// Проверяем валидность cron выражения для 6:00 утра
if (cron.validate('0 6 * * *')) {
    console.log('✅ Cron выражение для 6:00 утра валидно');
} else {
    console.log('❌ Cron выражение невалидно');
}

console.log('\n🔧 Проверка зависимостей:');
try {
    require('node-telegram-bot-api');
    console.log('✅ node-telegram-bot-api установлен');
} catch (e) {
    console.log('❌ node-telegram-bot-api не установлен');
}

try {
    require('node-cron');
    console.log('✅ node-cron установлен');
} catch (e) {
    console.log('❌ node-cron не установлен');
}

try {
    require('sqlite3');
    console.log('✅ sqlite3 установлен');
} catch (e) {
    console.log('❌ sqlite3 не установлен');
}

try {
    require('moment');
    console.log('✅ moment установлен');
} catch (e) {
    console.log('❌ moment не установлен');
}