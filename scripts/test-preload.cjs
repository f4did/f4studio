const os = require('node:os');
try {
  os.userInfo();
} catch {
  os.userInfo = () => ({ username: process.env.USERNAME || 'codex' });
}
