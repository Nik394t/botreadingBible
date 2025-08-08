#!/bin/bash

echo "🤖 Запуск Telegram бота для чтения Библии"
echo "=" * 50

# Проверяем наличие токена
if [ -z "$BOT_TOKEN" ]; then
    echo "❌ Ошибка: Не установлен BOT_TOKEN"
    echo "📝 Для получения токена:"
    echo "   1. Напишите @BotFather в Telegram"
    echo "   2. Отправьте команду /newbot"
    echo "   3. Следуйте инструкциям"
    echo "   4. Скопируйте полученный токен"
    echo ""
    echo "🔧 Установите токен командой:"
    echo "   export BOT_TOKEN='ваш_токен_здесь'"
    echo "   ./start_bot.sh"
    exit 1
fi

# Проверяем наличие ID группы
if [ -z "$GROUP_CHAT_ID" ]; then
    echo "⚠️  Предупреждение: Не установлен GROUP_CHAT_ID"
    echo "📝 Для получения ID группы:"
    echo "   1. Добавьте бота в группу"
    echo "   2. Отправьте любое сообщение в группу"
    echo "   3. Перейдите по ссылке: https://api.telegram.org/bot<ВАШ_ТОКЕН>/getUpdates"
    echo "   4. Найдите chat.id в ответе"
    echo ""
    echo "🔧 Установите ID группы командой:"
    echo "   export GROUP_CHAT_ID='id_группы_здесь'"
    echo ""
    echo "▶️  Продолжаем запуск без группы..."
    export GROUP_CHAT_ID="YOUR_GROUP_CHAT_ID_HERE"
fi

# Переходим в директорию бота
cd "/Users/sergey_andrienkobk.ru/Desktop/ПЛАН ЧТЕНИЯ БИБЛИИ/telegram_bot"

# Останавливаем предыдущие процессы
echo "🛑 Остановка предыдущих процессов..."
pkill -f "node bot.js" 2>/dev/null || true
sleep 2

# Создаем временный файл с конфигурацией
cat > config.js << EOF
module.exports = {
    BOT_TOKEN: '$BOT_TOKEN',
    GROUP_CHAT_ID: '$GROUP_CHAT_ID'
};
EOF

# Обновляем bot.js для использования конфигурации
sed -i '' "s/const BOT_TOKEN = 'YOUR_BOT_TOKEN_HERE';/const config = require('.\/config.js'); const BOT_TOKEN = config.BOT_TOKEN;/" bot.js
sed -i '' "s/const GROUP_CHAT_ID = 'YOUR_GROUP_CHAT_ID_HERE';/const GROUP_CHAT_ID = config.GROUP_CHAT_ID;/" bot.js

# Запускаем бота
echo "🚀 Запуск бота..."
nohup node bot.js > bot.log 2>&1 &
BOT_PID=$!

# Ждем запуска
sleep 3

# Проверяем, что бот запустился
if ps -p $BOT_PID > /dev/null; then
    echo "✅ Бот успешно запущен!"
    echo ""
    echo "📊 Информация о боте:"
    echo "   🆔 PID процесса: $BOT_PID"
    echo "   📝 Логи: bot.log"
    echo "   🗄️  База данных: bible_bot.db"
    echo ""
    echo "🔧 Управление ботом:"
    echo "   Остановить: pkill -f 'node bot.js'"
    echo "   Просмотр логов: tail -f bot.log"
    echo "   Перезапуск: ./start_bot.sh"
    echo ""
    echo "📱 Использование:"
    echo "   1. Найдите вашего бота в Telegram"
    echo "   2. Отправьте команду /start"
    echo "   3. Следуйте инструкциям бота"
    echo ""
    echo "🎉 Бот готов к работе!"
    
    # Показываем последние логи
    echo ""
    echo "📋 Последние логи:"
    tail -10 bot.log
    
else
    echo "❌ Ошибка запуска бота!"
    echo "🔍 Проверьте логи:"
    cat bot.log
    exit 1
fi