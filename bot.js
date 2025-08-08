const TelegramBot = require('node-telegram-bot-api');
const cron = require('node-cron');
const sqlite3 = require('sqlite3').verbose();
const moment = require('moment');
const fs = require('fs');
const path = require('path');

// Конфигурация
const config = require('./config.js');
const BOT_TOKEN = config.BOT_TOKEN;
const GROUP_CHAT_ID = config.GROUP_CHAT_ID;

// Создаем бота
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Инициализация базы данных
const dbPath = path.join(__dirname, 'bible_bot.db');
const db = new sqlite3.Database(dbPath);

// План чтения на 365 дней
const readingPlan = require('./reading_plan.json');

// Создание таблиц
db.serialize(() => {
    // Таблица пользователей
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        telegram_id INTEGER UNIQUE,
        username TEXT,
        first_name TEXT,
        start_date TEXT,
        current_day INTEGER DEFAULT 1,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Таблица прогресса чтения
    db.run(`CREATE TABLE IF NOT EXISTS reading_progress (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        day INTEGER,
        date TEXT,
        completed INTEGER DEFAULT 0,
        completed_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users (telegram_id)
    )`);

    // Таблица настроек уведомлений
    db.run(`CREATE TABLE IF NOT EXISTS notification_settings (
        user_id INTEGER PRIMARY KEY,
        morning_time TEXT DEFAULT '06:00',
        timezone TEXT DEFAULT 'Europe/Moscow',
        enabled INTEGER DEFAULT 1,
        FOREIGN KEY (user_id) REFERENCES users (telegram_id)
    )`);
});

// Клавиатуры
const mainKeyboard = {
    reply_markup: {
        keyboard: [
            ['📖 Сегодняшнее чтение', '✅ Отметить прочитанным'],
            ['📊 Мой прогресс', '⚙️ Настройки'],
            ['👥 Прогресс группы', '❓ Помощь']
        ],
        resize_keyboard: true,
        one_time_keyboard: false
    }
};

const settingsKeyboard = {
    reply_markup: {
        keyboard: [
            ['🔔 Время уведомлений', '🌍 Часовой пояс'],
            ['🔄 Сбросить прогресс', '🔙 Назад']
        ],
        resize_keyboard: true,
        one_time_keyboard: false
    }
};

// Функции для работы с базой данных
function getUser(telegramId) {
    return new Promise((resolve, reject) => {
        db.get('SELECT * FROM users WHERE telegram_id = ?', [telegramId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function createUser(telegramId, username, firstName, startDay = 1) {
    return new Promise((resolve, reject) => {
        const startDate = moment().format('YYYY-MM-DD');
        db.run(
            'INSERT OR REPLACE INTO users (telegram_id, username, first_name, start_date, current_day, is_active) VALUES (?, ?, ?, ?, ?, 1)',
            [telegramId, username, firstName, startDate, startDay],
            function(err) {
                if (err) reject(err);
                else {
                    // Создаем настройки уведомлений
                    db.run('INSERT OR REPLACE INTO notification_settings (user_id) VALUES (?)', [telegramId]);
                    
                    // Если пользователь начинает не с первого дня, создаем записи прогресса для предыдущих дней
                    if (startDay > 1) {
                        const completedDays = startDay - 1;
                        for (let day = 1; day <= completedDays; day++) {
                            const dayDate = moment().subtract(completedDays - day, 'days').format('YYYY-MM-DD');
                            db.run(
                                'INSERT OR REPLACE INTO reading_progress (user_id, day, date, completed, completed_at) VALUES (?, ?, ?, 1, ?)',
                                [telegramId, day, dayDate, moment().subtract(completedDays - day, 'days').format('YYYY-MM-DD HH:mm:ss')]
                            );
                        }
                    }
                    
                    resolve(this.lastID);
                }
            }
        );
    });
}

function updateUserProgress(telegramId, day) {
    return new Promise((resolve, reject) => {
        const today = moment().format('YYYY-MM-DD');
        db.run(
            'INSERT OR REPLACE INTO reading_progress (user_id, day, date, completed, completed_at) VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)',
            [telegramId, day, today],
            function(err) {
                if (err) reject(err);
                else {
                    // Обновляем текущий день пользователя
                    db.run('UPDATE users SET current_day = ? WHERE telegram_id = ?', [day + 1, telegramId]);
                    resolve(this.changes);
                }
            }
        );
    });
}

function getUserProgress(telegramId) {
    return new Promise((resolve, reject) => {
        db.all(
            'SELECT * FROM reading_progress WHERE user_id = ? ORDER BY day',
            [telegramId],
            (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            }
        );
    });
}

function getAllUsersProgress() {
    return new Promise((resolve, reject) => {
        db.all(`
            SELECT u.first_name, u.username, u.current_day, u.start_date,
                   COUNT(rp.completed) as completed_days
            FROM users u
            LEFT JOIN reading_progress rp ON u.telegram_id = rp.user_id AND rp.completed = 1
            WHERE u.is_active = 1
            GROUP BY u.telegram_id
            ORDER BY completed_days DESC, u.current_day DESC
        `, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// Обработчики команд
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const username = msg.from.username || '';
    const firstName = msg.from.first_name || 'Пользователь';

    try {
        const existingUser = await getUser(telegramId);
        
        if (existingUser) {
            bot.sendMessage(chatId, 
                `Добро пожаловать обратно, ${firstName}! 🙏\n\n` +
                `Вы находитесь на ${existingUser.current_day} дне плана чтения.\n` +
                `Продолжайте свое духовное путешествие! 📖`,
                mainKeyboard
            );
        } else {
            // Новый пользователь
            bot.sendMessage(chatId,
                `Добро пожаловать в бот для чтения Библии! 📖🙏\n\n` +
                `Этот бот поможет вам читать Священное Писание каждый день по специальному плану.\n\n` +
                `Вы новичок в чтении Библии или уже начали изучение?`,
                {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🆕 Я новичок, начну с первого дня', callback_data: 'start_new' }],
                            [{ text: '📚 Уже читаю, укажу свой прогресс', callback_data: 'start_existing' }]
                        ]
                    }
                }
            );
        }
    } catch (error) {
        console.error('Ошибка при обработке /start:', error);
        bot.sendMessage(chatId, 'Произошла ошибка. Попробуйте позже.');
    }
});

// Обработка callback кнопок
bot.on('callback_query', async (callbackQuery) => {
    const message = callbackQuery.message;
    const chatId = message.chat.id;
    const telegramId = callbackQuery.from.id;
    const data = callbackQuery.data;
    const firstName = callbackQuery.from.first_name || 'Пользователь';
    const username = callbackQuery.from.username || '';

    try {
        if (data === 'start_new') {
            await createUser(telegramId, username, firstName, 1);
            bot.editMessageText(
                `Отлично! Вы начинаете свое путешествие с первого дня! 🌟\n\n` +
                `Каждый день в 6:00 утра я буду напоминать вам о чтении.\n` +
                `Вы можете изменить время в настройках.\n\n` +
                `Давайте начнем! 📖`,
                {
                    chat_id: chatId,
                    message_id: message.message_id,
                    reply_markup: { inline_keyboard: [] }
                }
            );
            
            // Показываем главное меню
            setTimeout(() => {
                bot.sendMessage(chatId, 'Выберите действие:', mainKeyboard);
            }, 1000);
            
        } else if (data === 'start_existing') {
            bot.editMessageText(
                `Укажите, сколько дней плана вы уже прочитали (от 1 до 365):\n\n` +
                `Например, если вы прочитали 30 дней, напишите: 30`,
                {
                    chat_id: chatId,
                    message_id: message.message_id,
                    reply_markup: { inline_keyboard: [] }
                }
            );
            
            // Устанавливаем состояние ожидания числа
            bot.once('message', async (msg) => {
                if (msg.from.id === telegramId && msg.chat.id === chatId) {
                    const dayNumber = parseInt(msg.text);
                    if (dayNumber >= 1 && dayNumber <= 365) {
                        await createUser(telegramId, username, firstName, dayNumber + 1);
                        bot.sendMessage(chatId,
                            `Отлично! Вы продолжите с ${dayNumber + 1} дня плана. 📖\n\n` +
                            `Каждый день в 6:00 утра я буду напоминать вам о чтении.\n` +
                            `Время можно изменить в настройках.`,
                            mainKeyboard
                        );
                    } else {
                        bot.sendMessage(chatId, 
                            'Пожалуйста, укажите число от 1 до 365.',
                            mainKeyboard
                        );
                    }
                }
            });
            
        } else if (data === 'confirm_reset') {
            try {
                await resetUserProgress(telegramId, username, firstName);
                
                bot.editMessageText(
                    `✅ Прогресс успешно сброшен!\n\n` +
                    `🆕 Теперь выберите, как начать заново:`,
                    {
                        chat_id: chatId,
                        message_id: message.message_id,
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: '🌟 Начать с первого дня', callback_data: 'reset_start_new' }],
                                [{ text: '📚 У меня есть прогресс', callback_data: 'reset_start_existing' }]
                            ]
                        }
                    }
                );
                
            } catch (error) {
                console.error('Ошибка при сбросе прогресса:', error);
                bot.editMessageText(
                    '❌ Произошла ошибка при сбросе прогресса. Попробуйте позже.',
                    {
                        chat_id: chatId,
                        message_id: message.message_id,
                        reply_markup: { inline_keyboard: [] }
                    }
                );
            }
            
        } else if (data === 'cancel_reset') {
            bot.editMessageText(
                '❌ Сброс прогресса отменен.\n\nВаши данные сохранены.',
                {
                    chat_id: chatId,
                    message_id: message.message_id,
                    reply_markup: { inline_keyboard: [] }
                }
            );
            
            // Показываем настройки
            setTimeout(() => {
                bot.sendMessage(chatId, 'Настройки:', settingsKeyboard);
            }, 1000);
            
        } else if (data.startsWith('mark_read_')) {
            const dayToMark = parseInt(data.replace('mark_read_', ''));
            const user = await getUser(telegramId);
            
            if (user && dayToMark === user.current_day) {
                await updateUserProgress(telegramId, dayToMark);
                
                bot.editMessageText(
                    `✅ Отлично! День ${dayToMark} отмечен как прочитанный!\n\n` +
                    `🌟 Продолжайте в том же духе! Завтра вас ждет день ${dayToMark + 1}.\n\n` +
                    `🙏 Благословений вам в изучении Слова Божьего!`,
                    {
                        chat_id: chatId,
                        message_id: message.message_id,
                        reply_markup: { inline_keyboard: [] }
                    }
                );
                
                // Уведомление в группу
                if (GROUP_CHAT_ID && GROUP_CHAT_ID !== 'YOUR_GROUP_CHAT_ID_HERE') {
                    const groupMessage = 
                        `📖 ${firstName} завершил(а) чтение дня ${dayToMark}!\n` +
                        `🎉 Поддержим друг друга в изучении Писания!`;
                    
                    bot.sendMessage(GROUP_CHAT_ID, groupMessage);
                }
            } else {
                bot.editMessageText(
                    '❌ Этот день уже отмечен или не соответствует вашему текущему прогрессу.',
                    {
                        chat_id: chatId,
                        message_id: message.message_id,
                        reply_markup: { inline_keyboard: [] }
                    }
                );
            }
            
        } else if (data === 'reset_start_new') {
            await createUser(telegramId, username, firstName, 1);
            bot.editMessageText(
                `🌟 Отлично! Вы начинаете свое новое путешествие с первого дня!\n\n` +
                `📅 Дата начала: ${moment().format('DD.MM.YYYY')}\n` +
                `🔔 Каждый день в 6:00 утра я буду напоминать вам о чтении.\n` +
                `⚙️ Время можно изменить в настройках.\n\n` +
                `📖 Давайте начнем изучение Священного Писания!`,
                {
                    chat_id: chatId,
                    message_id: message.message_id,
                    reply_markup: { inline_keyboard: [] }
                }
            );
            
            // Показываем главное меню
            setTimeout(() => {
                bot.sendMessage(chatId, 'Выберите действие:', mainKeyboard);
            }, 1000);
            
        } else if (data === 'reset_start_existing') {
            bot.editMessageText(
                `📚 Укажите, сколько дней плана вы уже прочитали (от 1 до 365):\n\n` +
                `Например, если вы прочитали 50 дней, напишите: 50\n\n` +
                `💡 Это поможет правильно настроить ваш прогресс после сброса.`,
                {
                    chat_id: chatId,
                    message_id: message.message_id,
                    reply_markup: { inline_keyboard: [] }
                }
            );
            
            // Устанавливаем состояние ожидания числа для сброшенного пользователя
            bot.once('message', async (msg) => {
                if (msg.from.id === telegramId && msg.chat.id === chatId) {
                    const dayNumber = parseInt(msg.text);
                    if (dayNumber >= 1 && dayNumber <= 365) {
                        await createUser(telegramId, username, firstName, dayNumber + 1);
                        bot.sendMessage(chatId,
                            `✅ Отлично! Ваш прогресс восстановлен!\n\n` +
                            `📊 Прочитано дней: ${dayNumber}\n` +
                            `📖 Продолжите с ${dayNumber + 1} дня плана\n` +
                            `📅 Дата начала: ${moment().format('DD.MM.YYYY')}\n\n` +
                            `🔔 Каждый день в 6:00 утра я буду напоминать вам о чтении.\n` +
                            `⚙️ Время можно изменить в настройках.\n\n` +
                            `🙏 Благословений в изучении Слова Божьего!`,
                            mainKeyboard
                        );
                    } else {
                        bot.sendMessage(chatId, 
                            '❌ Пожалуйста, укажите число от 1 до 365.\n\n' +
                            'Попробуйте еще раз или используйте кнопки меню.',
                            mainKeyboard
                        );
                    }
                }
            });
        }
    } catch (error) {
        console.error('Ошибка при обработке callback:', error);
        bot.sendMessage(chatId, 'Произошла ошибка. Попробуйте позже.');
    }
    
    bot.answerCallbackQuery(callbackQuery.id);
});

// Обработка текстовых сообщений
bot.on('message', async (msg) => {
    if (msg.text && !msg.text.startsWith('/')) {
        const chatId = msg.chat.id;
        const telegramId = msg.from.id;
        const text = msg.text;

        try {
            const user = await getUser(telegramId);
            if (!user) {
                bot.sendMessage(chatId, 'Пожалуйста, начните с команды /start');
                return;
            }

            switch (text) {
                case '📖 Сегодняшнее чтение':
                    await handleTodayReading(chatId, user);
                    break;
                    
                case '✅ Отметить прочитанным':
                    await handleMarkAsRead(chatId, telegramId, user);
                    break;
                    
                case '📊 Мой прогресс':
                    await handleMyProgress(chatId, telegramId);
                    break;
                    
                case '👥 Прогресс группы':
                    await handleGroupProgress(chatId);
                    break;
                    
                case '⚙️ Настройки':
                    bot.sendMessage(chatId, 'Настройки:', settingsKeyboard);
                    break;
                    
                case '🔙 Назад':
                    bot.sendMessage(chatId, 'Главное меню:', mainKeyboard);
                    break;
                    
                case '❓ Помощь':
                    await handleHelp(chatId);
                    break;
                    
                case '🔄 Сбросить прогресс':
                    await handleResetProgress(chatId, telegramId);
                    break;
                    
                default:
                    bot.sendMessage(chatId, 'Используйте кнопки меню для навигации.', mainKeyboard);
            }
        } catch (error) {
            console.error('Ошибка при обработке сообщения:', error);
            bot.sendMessage(chatId, 'Произошла ошибка. Попробуйте позже.');
        }
    }
});

// Функции обработчики
async function handleTodayReading(chatId, user) {
    const currentDay = user.current_day;
    
    if (currentDay > 365) {
        bot.sendMessage(chatId, 
            '🎉 Поздравляем! Вы завершили годовой план чтения Библии!\n\n' +
            'Вы можете начать заново или продолжить изучение по своему усмотрению.',
            {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🔄 Начать заново', callback_data: 'restart_plan' }]
                    ]
                }
            }
        );
        return;
    }

    const todayReading = readingPlan[currentDay - 1];
    if (todayReading) {
        const message = 
            `📖 День ${currentDay} из 365\n\n` +
            `📅 ${todayReading.date}\n\n` +
            `📚 Сегодняшнее чтение:\n` +
            `${todayReading.reading}\n\n` +
            `💭 ${todayReading.theme || 'Размышление о прочитанном'}\n\n` +
            `🙏 Не забудьте помолиться и провести время с Богом, чтобы наполнить день Его присутствием и любовью!`;
            
        bot.sendMessage(chatId, message, {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '✅ Отметить как прочитанное', callback_data: `mark_read_${currentDay}` }]
                ]
            }
        });
    } else {
        bot.sendMessage(chatId, 'Ошибка загрузки плана чтения. Попробуйте позже.');
    }
}

async function handleMarkAsRead(chatId, telegramId, user) {
    const currentDay = user.current_day;
    
    if (currentDay > 365) {
        bot.sendMessage(chatId, 'Вы уже завершили годовой план чтения! 🎉');
        return;
    }

    try {
        await updateUserProgress(telegramId, currentDay);
        
        const message = 
            `✅ Отлично! День ${currentDay} отмечен как прочитанный!\n\n` +
            `🌟 Продолжайте в том же духе! Завтра вас ждет день ${currentDay + 1}.\n\n` +
            `🙏 Благословений вам в изучении Слова Божьего!`;
            
        bot.sendMessage(chatId, message);
        
        // Уведомление в группу
        if (GROUP_CHAT_ID && GROUP_CHAT_ID !== 'YOUR_GROUP_CHAT_ID_HERE') {
            const groupMessage = 
                `📖 ${user.first_name} завершил(а) чтение дня ${currentDay}!\n` +
                `🎉 Поддержим друг друга в изучении Писания!`;
            
            bot.sendMessage(GROUP_CHAT_ID, groupMessage);
        }
        
    } catch (error) {
        console.error('Ошибка при отметке прогресса:', error);
        bot.sendMessage(chatId, 'Ошибка при сохранении прогресса. Попробуйте позже.');
    }
}

async function handleMyProgress(chatId, telegramId) {
    try {
        const user = await getUser(telegramId);
        const progress = await getUserProgress(telegramId);
        
        const totalDays = progress.length;
        const currentDay = user.current_day;
        const percentage = Math.round((totalDays / 365) * 100);
        
        const startDate = moment(user.start_date);
        const daysSinceStart = moment().diff(startDate, 'days') + 1;
        
        let message = 
            `📊 Ваш прогресс чтения Библии\n\n` +
            `👤 ${user.first_name}\n` +
            `📅 Начали: ${startDate.format('DD.MM.YYYY')}\n` +
            `📖 Текущий день: ${currentDay > 365 ? '365 (завершено!)' : currentDay}\n` +
            `✅ Прочитано дней: ${totalDays}\n` +
            `📈 Прогресс: ${percentage}%\n` +
            `⏱️ Дней с начала: ${daysSinceStart}\n\n`;
            
        // Прогресс-бар
        const progressBar = '█'.repeat(Math.floor(percentage / 5)) + '░'.repeat(20 - Math.floor(percentage / 5));
        message += `[${progressBar}] ${percentage}%\n\n`;
        
        if (currentDay <= 365) {
            const remaining = 365 - totalDays;
            message += `🎯 Осталось дней: ${remaining}\n`;
            
            if (daysSinceStart > totalDays) {
                const behind = daysSinceStart - totalDays;
                message += `⚠️ Отставание: ${behind} дней\n`;
            } else if (totalDays > daysSinceStart) {
                const ahead = totalDays - daysSinceStart;
                message += `🚀 Опережение: ${ahead} дней\n`;
            } else {
                message += `✅ Вы идете по плану!\n`;
            }
        } else {
            message += `🎉 План завершен! Поздравляем!\n`;
        }
        
        bot.sendMessage(chatId, message);
        
    } catch (error) {
        console.error('Ошибка при получении прогресса:', error);
        bot.sendMessage(chatId, 'Ошибка при загрузке прогресса. Попробуйте позже.');
    }
}

async function handleGroupProgress(chatId) {
    try {
        const allProgress = await getAllUsersProgress();
        
        if (allProgress.length === 0) {
            bot.sendMessage(chatId, 'Пока нет данных о прогрессе группы.');
            return;
        }
        
        let message = '👥 Прогресс группы по чтению Библии\n\n';
        
        allProgress.forEach((user, index) => {
            const percentage = Math.round((user.completed_days / 365) * 100);
            const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '📖';
            
            message += 
                `${medal} ${user.first_name}\n` +
                `   📊 ${user.completed_days}/365 дней (${percentage}%)\n` +
                `   📅 День плана: ${user.current_day > 365 ? '365 ✅' : user.current_day}\n\n`;
        });
        
        message += '🙏 Поддерживайте друг друга в изучении Слова Божьего!';
        
        bot.sendMessage(chatId, message);
        
    } catch (error) {
        console.error('Ошибка при получении прогресса группы:', error);
        bot.sendMessage(chatId, 'Ошибка при загрузке прогресса группы. Попробуйте позже.');
    }
}

async function handleHelp(chatId) {
    const helpMessage = 
        `❓ Помощь по использованию бота\n\n` +
        `📖 Сегодняшнее чтение - показывает план на сегодня\n` +
        `✅ Отметить прочитанным - отмечает день как завершенный\n` +
        `📊 Мой прогресс - показывает вашу статистику\n` +
        `👥 Прогресс группы - статистика всех участников\n` +
        `⚙️ Настройки - изменение времени уведомлений\n\n` +
        `🔔 Уведомления приходят каждый день в 6:00\n` +
        `🌍 Время можно изменить в настройках\n\n` +
        `📚 План рассчитан на 365 дней\n` +
        `🙏 Каждый день включает чтение и молитву\n\n` +
        `❓ Если есть вопросы, обратитесь к администратору.`;
        
    bot.sendMessage(chatId, helpMessage);
}

async function handleResetProgress(chatId, telegramId) {
    try {
        const user = await getUser(telegramId);
        if (!user) {
            bot.sendMessage(chatId, 'Пользователь не найден. Начните с команды /start');
            return;
        }

        bot.sendMessage(chatId, 
            `⚠️ Вы уверены, что хотите сбросить весь прогресс?\n\n` +
            `Это действие:\n` +
            `• Удалит всю историю чтения\n` +
            `• Сбросит текущий день на 1\n` +
            `• Установит новую дату начала\n\n` +
            `❗ Это действие нельзя отменить!`,
            {
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '✅ Да, сбросить', callback_data: 'confirm_reset' },
                            { text: '❌ Отмена', callback_data: 'cancel_reset' }
                        ]
                    ]
                }
            }
        );
    } catch (error) {
        console.error('Ошибка при сбросе прогресса:', error);
        bot.sendMessage(chatId, 'Произошла ошибка. Попробуйте позже.');
    }
}

function resetUserProgress(telegramId, username, firstName) {
    return new Promise((resolve, reject) => {
        db.serialize(() => {
            // Удаляем весь прогресс чтения
            db.run('DELETE FROM reading_progress WHERE user_id = ?', [telegramId], (err) => {
                if (err) {
                    console.error('Ошибка при удалении прогресса:', err);
                    reject(err);
                    return;
                }
                console.log(`Прогресс чтения пользователя ${telegramId} удален`);
            });

            // Помечаем пользователя как неактивного (временно)
            // Он будет переактивирован при выборе нового старта
            db.run(
                'UPDATE users SET is_active = 0 WHERE telegram_id = ?',
                [telegramId],
                function(err) {
                    if (err) {
                        console.error('Ошибка при обновлении пользователя:', err);
                        reject(err);
                    } else {
                        console.log(`Пользователь ${telegramId} подготовлен к сбросу`);
                        resolve(this.changes);
                    }
                }
            );
        });
    });
}

// Ежедневные уведомления
cron.schedule('0 6 * * *', async () => {
    console.log('Отправка ежедневных уведомлений...');
    
    try {
        db.all('SELECT * FROM users WHERE is_active = 1', async (err, users) => {
            if (err) {
                console.error('Ошибка при получении пользователей:', err);
                return;
            }
            
            for (const user of users) {
                try {
                    const currentDay = user.current_day;
                    
                    if (currentDay <= 365) {
                        const todayReading = readingPlan[currentDay - 1];
                        
                        const message = 
                            `🌅 Доброе утро, ${user.first_name}!\n\n` +
                            `📖 Не забудьте сегодня почитать Писание и помолиться!\n` +
                            `🙏 Проведите время с Богом, чтобы наполнить день Его присутствием и любовью, чтобы передать её тем, кто рядом.\n\n` +
                            `📚 День ${currentDay}: ${todayReading ? todayReading.reading : 'План чтения'}\n\n` +
                            `✨ Благословенного дня!`;
                            
                        await bot.sendMessage(user.telegram_id, message, {
                            reply_markup: {
                                inline_keyboard: [
                                    [{ text: '📖 Открыть чтение', callback_data: 'today_reading' }],
                                    [{ text: '✅ Отметить прочитанным', callback_data: `mark_read_${currentDay}` }]
                                ]
                            }
                        });
                    }
                    
                    // Небольшая задержка между отправками
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                } catch (error) {
                    console.error(`Ошибка при отправке уведомления пользователю ${user.telegram_id}:`, error);
                }
            }
        });
    } catch (error) {
        console.error('Ошибка при отправке ежедневных уведомлений:', error);
    }
});

// Обработка ошибок
bot.on('error', (error) => {
    console.error('Ошибка бота:', error);
});

bot.on('polling_error', (error) => {
    console.error('Ошибка polling:', error);
});

console.log('🤖 Bible Reading Bot запущен!');
console.log('📖 Готов помогать в изучении Священного Писания!');