module.exports = {
  apps: [{
    name: 'luxon-bot',
    script: 'bot.py',
    interpreter: 'venv/bin/python',
    cwd: '/var/www/luxon/bot_new',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '500M',
    env: {
      NODE_ENV: 'production'
    },
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    time: true
  }]
};

