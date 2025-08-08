#!/bin/bash

echo "🚀 Развертывание Bible Reading Bot на сервере"
echo "=============================================="

# Проверяем Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js не установлен!"
    echo "📥 Установите Node.js:"
    echo "   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -"
    echo "   sudo apt-get install -y nodejs"
    exit 1
fi

echo "✅ Node.js найден: $(node --version)"
echo "✅ NPM версия: $(npm --version)"

# Устанавливаем зависимости
echo ""
echo "📦 Установка зависимостей..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Ошибка установки зависимостей!"
    exit 1
fi

# Делаем скрипты исполняемыми
echo ""
echo "🔧 Настройка прав доступа..."
chmod +x start_bot.sh
chmod +x deploy.sh

# Проверяем конфигурацию
echo ""
echo "⚙️ Проверка конфигурации..."

if [ ! -f "config.js" ]; then
    echo "⚠️ Файл config.js не найден!"
    echo "📝 Создайте config.js с вашими данными:"
    echo ""
    cat << 'EOF'
module.exports = {
    BOT_TOKEN: 'ваш_токен_от_BotFather',
    GROUP_CHAT_ID: 'id_вашей_группы'
};
EOF
    echo ""
    echo "💡 Или скопируйте из примера:"
    echo "   cp config.js.example config.js"
    echo "   nano config.js"
    exit 1
fi

# Тестируем компоненты
echo ""
echo "🧪 Тестирование компонентов..."
node test_bot.js

if [ $? -ne 0 ]; then
    echo "❌ Тесты не пройдены!"
    exit 1
fi

# Проверяем PM2
if command -v pm2 &> /dev/null; then
    echo ""
    echo "🔄 PM2 найден. Настройка автозапуска..."
    
    # Останавливаем предыдущие процессы
    pm2 delete bible-bot 2>/dev/null || true
    
    # Запускаем через PM2
    pm2 start bot.js --name "bible-bot"
    pm2 save
    
    echo "✅ Бот запущен через PM2!"
    echo ""
    echo "📊 Управление ботом:"
    echo "   pm2 status"
    echo "   pm2 logs bible-bot"
    echo "   pm2 restart bible-bot"
    echo "   pm2 stop bible-bot"
    
else
    echo ""
    echo "⚠️ PM2 не установлен. Рекомендуется для продакшена:"
    echo "   npm install -g pm2"
    echo ""
    echo "🚀 Запуск бота в обычном режиме..."
    ./start_bot.sh &
    
    echo "✅ Бот запущен!"
    echo ""
    echo "📊 Управление ботом:"
    echo "   pkill -f 'node bot.js'  # остановить"
    echo "   ./start_bot.sh          # запустить"
    echo "   tail -f bot.log         # логи"
fi

echo ""
echo "🎉 Развертывание завершено!"
echo ""
echo "📱 Следующие шаги:"
echo "1. Найдите вашего бота в Telegram"
echo "2. Отправьте команду /start"
echo "3. Следуйте инструкциям бота"
echo ""
echo "📞 Поддержка:"
echo "   tail -f bot.log  # просмотр логов"
echo "   node test_bot.js # тестирование"
echo ""
echo "🙏 Благословенного использования!"