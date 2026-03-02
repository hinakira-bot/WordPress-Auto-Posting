module.exports = {
  apps: [
    {
      name: 'wp-tool',
      script: 'server.mjs',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 3002,
      },
    },
  ],
};
