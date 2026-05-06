@echo off
setlocal

echo Starting HTTPS tunnel for DPvision AI on http://localhost:3001
echo Keep this window open while using Twilio callbacks.
echo.

ssh -o StrictHostKeyChecking=no -o ServerAliveInterval=30 -R 80:localhost:3001 nokey@localhost.run

endlocal
