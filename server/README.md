faster whisper model for transcribing. Server built on python.

Make sure you have python version 3.14.6
pip 26.1.2

run this command to download packages from pip:

py -m venv venv
venv\Scripts\activate

pip install faster-whisper fastapi uvicorn python-multipart dotenv

set up your venv and run uvicorn main:app --reload