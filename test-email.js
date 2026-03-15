import http from 'http';

const data = JSON.stringify({
  to: 'test@example.com',
  subject: 'Test',
  body: 'Hello'
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/send-email',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => console.log(res.statusCode, body));
});

req.on('error', (e) => console.error(e));
req.write(data);
req.end();
