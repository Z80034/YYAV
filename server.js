const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Hello from yyav-backend');
});

app.listen(port, '0.0.0.0', () => {
  console.log(`🚀 服务已启动: http://0.0.0.0:${port}`);
});