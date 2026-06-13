@echo off
echo Starting MyKolong2 Hub Server...
start http://localhost:8000/signin.html
python -m http.server 8000
