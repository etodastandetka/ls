module.exports = {
  apps: [{
    name: 'bot-moderator',
    cwd: '/var/www/luxon/bot_moderator',
    script: 'venv/bin/python',
    args: 'bot.py',
    interpreter: 'none',
    env: {
      PYTHONUNBUFFERED: '1'
    },
    error_file: '/var/log/pm2/bot-moderator-error.log',
    out_file: '/var/log/pm2/bot-moderator-out.log',
    log_file: '/var/log/pm2/bot-moderator.log',
    time: true,
    autorestart: true,
    watch: false,
    max_memory_restart: '200M',
    restart_delay: 5000,
    max_restarts: 10,
    min_uptime: '10s'
  }]
};

